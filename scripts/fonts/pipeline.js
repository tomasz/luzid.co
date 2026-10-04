/**
 * The font pipeline proper: one source row, its upstream original and its licence in; the
 * WOFF2 subsets, the meta and the licence file out. Every rule of PLAN §5.5 after rule 1 is
 * enforced here and every one of them is a hard failure. No files and no network (subset-font
 * loads its own wasm on first use): the CLI reads the inputs through `fetch.js` and decides
 * what to do with the outputs.
 *
 * Two deliberate choices worth knowing before changing anything here:
 *
 *  - A feature is "effective" only if shaping the two real words with it on differs from
 *    shaping them with it off. GSUB coverage tables over-report badly — they list every glyph
 *    a lookup *could* touch, including alternates of letters we do not ship.
 *  - Every shipped file is a fully pinned static instance. A variable font that keeps its
 *    `gvar` costs several times the budget, and pinning also lets the renderer avoid
 *    `font-variation-settings` entirely.
 */
import { hash } from "node:crypto";
import subsetFont from "subset-font";
import {
  build,
  deriveMetrics,
  hasOverlapFlags,
  normalizeMetrics,
  parse,
  readMetrics,
  readNames,
  readWeightClass,
  setOverlapFlags,
  writeNames,
} from "../sfnt.mjs";
import { decode, encode } from "../woff2.mjs";
import {
  BASE_FEATURES,
  BUDGET_BYTES,
  casesFor,
  LETTERS,
  RowError,
  stopsOf,
  TEXT,
  WORDS,
} from "./rules.js";
import {
  assertCopyright,
  changeNotice,
  licenseFile,
  lintNames,
  neutralName,
  renameRecords,
  reservedFontNames,
  upstreamVersion,
} from "./licence.js";
import { inkBox, openFont, shape } from "./shape.js";
import { measureCrossbar, measureStem, measureTraits, reconcileTraits } from "./measure.js";
import {
  BudgetError,
  candidateFeatures,
  dedupeCombos,
  effectiveFeatures,
  planVariants,
  shedToBudget,
} from "./variants.js";

const sha256 = (data) => hash("sha256", data);
const fail = (id, message) => {
  throw new RowError(id, message);
};

/** PLAN §5.5 rule 7. The response budget (§9.1) is the final gate; this is the per-file one. */
export function checkBudget(id, bytes) {
  if (bytes > BUDGET_BYTES)
    throw new BudgetError(id, `${bytes} B is over the ${BUDGET_BYTES} B budget`);
  return bytes;
}

/** PLAN §5.5 rule 2. The `latin-ext` subset label is ignored: it is wrong in both directions. */
export function checkCoverage(id, { face, font }) {
  for (const ch of LETTERS) {
    const gid = font.nominalGlyph(ch.codePointAt(0));
    if (gid === undefined) fail(id, `no glyph for "${ch}"`);
    const e = font.glyphExtents(gid);
    if (!e || e.width <= 0 || Math.abs(e.height) <= 0)
      fail(id, `"${ch}" maps to a glyph with no ink`);
  }
  const space = font.nominalGlyph(0x20);
  if (space === undefined) fail(id, "no space glyph");
  if (font.glyphHAdvance(space) <= 0) fail(id, "the space glyph has no advance");
  const gid = (ch) => font.nominalGlyph(ch.codePointAt(0));
  if (gid("Ł") === gid("L")) fail(id, "Ł is the same glyph as L");
  if (gid("ł") === gid("l")) fail(id, "ł is the same glyph as l");
  const covered = face.collectUnicodes().length;
  return covered;
}

/**
 * Subset one stop, normalize it, set the overlap flags and pack it. Returns the WOFF2.
 *
 * `rename` is `{name, version}` for a font whose licence reserves its name and `null` for
 * one that does not — a font with no Reserved Font Name keeps its own name table untouched.
 * The rename happens after subsetting rather than before: hb-subset can only choose which
 * name records to *keep*, so the table has to be rebuilt either way, and rebuilding the
 * short one costs less than rebuilding the upstream's hundred records.
 */
async function subsetStop({ original, axes, keepFeatures, rename }) {
  const sfnt = await subsetFont(original, TEXT, {
    targetFormat: "sfnt",
    noHinting: true,
    preserveNameIds: [13, 14],
    dropTables: ["STAT", "MVAR"],
    ...(Object.keys(axes).length > 0 ? { variationAxes: axes } : {}),
    keepFeatures,
  });
  const parsed = parse(sfnt);
  setOverlapFlags(parsed.tables);
  if (rename) writeNames(parsed.tables, renameRecords(readNames(parsed.tables), rename));
  // The ink has to be measured before the metrics can be derived, and the metrics have to
  // be written before the file can be weighed, so the subset is handed back in between.
  return { parsed, sfnt: build(parsed) };
}

/** Write the derived metrics into a subset, pack it, and weigh it against rule 7's budget. */
function packStop(id, parsed, metrics) {
  normalizeMetrics(parsed.tables, metrics);
  const finished = build(parsed);
  const woff2 = encode(finished);
  checkBudget(id, woff2.length);
  return { sfnt: finished, woff2 };
}

/**
 * Re-open what will actually ship and prove it, rather than trusting the encoder.
 * `forbidden` is rule 3's lint list — the upstream family plus every reserved name — and is
 * empty for a font that reserves nothing and therefore keeps its own name table.
 */
function verifyFile(id, woff2, metrics, forbidden = []) {
  const sfnt = decode(woff2);
  const { tables } = parse(sfnt);
  const written = readMetrics(tables);
  if (written.ascender !== metrics.asc || written.descender !== -metrics.desc) {
    fail(id, "the re-parsed file does not carry the metrics that were written");
  }
  const overlap = hasOverlapFlags(tables);
  if (overlap.glyphs !== overlap.flagged) fail(id, "the re-parsed file lost its overlap flags");
  const names = readNames(tables);
  lintNames(id, names, forbidden);
  const opened = openFont(sfnt);
  try {
    const covered = checkCoverage(id, opened);
    if (covered !== 23) fail(id, `the shipped file maps ${covered} code points, expected 23`);
    return { glyphs: covered, overlap, names, upm: opened.upem };
  } finally {
    opened.close();
  }
}

/**
 * Build one row. `upstream` is the original as a Buffer, already checked against
 * `row.sha256`; `license` and `extras` are what `readLicense` returned. Resolves to the meta,
 * the WOFF2 files as `{name, data}` and the licence file's text; a refusal throws `RowError`.
 */
export async function buildFont({ row, upstream, license, extras, log }) {
  const id = row.id;
  const opened = openFont(upstream);
  let result;
  try {
    checkCoverage(id, opened);

    // Licence gate, PLAN §5.5 rule 3.
    const name0 = opened.face.getName(0, "en");
    assertCopyright(id, license, name0);

    // A Reserved Font Name is no longer a refusal. The OFL does not forbid using the font;
    // it forbids a Modified Version — which a 23-glyph subset is (OFL FAQ 2.2, 2.5, 2.6) —
    // from carrying the reserved name. So the subset ships under a neutral internal name and
    // the attribution stays exactly where it was: name ID 0, the licence file, the change
    // notice and the source URL are all untouched, and the colophon still credits `family`.
    let rfn;
    try {
      rfn = reservedFontNames(license, name0);
    } catch (error) {
      fail(id, error.message);
    }
    const version = upstreamVersion(opened.face.getName(5, "en"));
    // The lint list, and the rename, are only built for a font that reserves something: a
    // font with no Reserved Font Name keeps its own name table, byte for byte.
    const forbidden = rfn.length > 0 ? [row.family, ...rfn] : [];
    const rename = rfn.length > 0 ? { name: neutralName(id, forbidden), version } : null;
    if (rename)
      log(`${id}: reserves ${rfn.map((n) => `"${n}"`).join(", ")} — shipping as ${rename.name}`);

    // Every axis has to be pinned, not just the ones we vary, so all of them are read.
    const axes = Object.values(opened.face.getAxisInfos());
    const stops = stopsOf(row);
    if (axes.length > 0 && !row.stops) fail(id, "a variable font must list its static stops");
    for (const stop of stops) {
      const pinned = Object.keys(stop.axes).sort().join(",");
      const wanted = axes
        .map((a) => a.tag)
        .sort()
        .join(",");
      if (pinned !== wanted)
        fail(id, `stop ${stop.id} pins {${pinned}}, the font has axes {${wanted}}`);
      for (const a of axes) {
        if (stop.axes[a.tag] < a.min || stop.axes[a.tag] > a.max) {
          fail(id, `stop ${stop.id}: ${a.tag}=${stop.axes[a.tag]} is outside [${a.min}, ${a.max}]`);
        }
      }
    }

    // Measured traits and the cases that are worth randomising over.
    // Traits describe the font as it ships, so they are measured at its first stop.
    const measured = measureTraits(opened, stops[0].axes);
    const traits = reconcileTraits(id, row.traits, measured);
    const cases = casesFor(row, measured);

    const candidates = candidateFeatures(opened.face, row.features);
    // Rule 4 keeps a tag that changes the words; the dedupe then drops the ones that all
    // change them the same way. Both are needed: the first is per tag, the second per pair.
    const featuresByCase = dedupeCombos(
      opened.font,
      cases,
      Object.fromEntries(cases.map((c) => [c, effectiveFeatures(opened.font, c, candidates)])),
    );

    /**
     * One full attempt: subset every stop, measure the ink on those subsets, derive the
     * metrics from those measurements, write them back and weigh the result.
     *
     * It is one function because rule 7's budget is only knowable at the very last step —
     * the file cannot be weighed until the metrics are in it — and the ladder below has to
     * be able to catch that and try again with less.
     */
    const attempt = async (state) => {
      const tags = [...new Set(cases.flatMap((c) => state.featuresByCase[c]))].sort();
      const keepFeatures = [...BASE_FEATURES, ...tags];
      const plan = planVariants({
        cases,
        featuresByCase: state.featuresByCase,
        stops: state.stops,
      });
      const used = [...new Set(plan.map((v) => v.stop))].sort((a, b) => a - b);
      const built = [];
      const measured = new Map();

      for (const index of used) {
        const stop = state.stops[index];
        const file = {
          index,
          stop,
          ...(await subsetStop({ original: upstream, axes: stop.axes, keepFeatures, rename })),
        };
        const instance = openFont(file.sfnt);
        try {
          for (const variant of plan.filter((v) => v.stop === index)) {
            const words = WORDS[variant.case].map((word) => {
              const box = inkBox(instance.font, shape(instance.font, word, variant.feats));
              if (!box) fail(id, `variant ${variant.id} shapes "${word}" to nothing`);
              return box;
            });
            measured.set(variant.id, { words, upem: instance.upem });
          }
          file.upem = instance.upem;
          // Stroke widths are read off the shipped instance, so a pinned wght is included.
          file.stroke = { stem: measureStem(instance), crossbar: measureCrossbar(instance) };
          file.weight = readWeightClass(file.parsed.tables);
        } finally {
          instance.close();
        }
        built.push(file);
      }

      // PLAN §5.2: one pair of metrics per file, over every variant that uses it.
      for (const file of built) {
        const mine = plan.filter((v) => v.stop === file.index).map((v) => measured.get(v.id));
        file.metrics = deriveMetrics({
          upm: file.upem,
          tops: mine.flatMap((m) => m.words.map((w) => w.top)),
          depths: mine.flatMap((m) => m.words.map((w) => -w.bottom)),
        });
        file.woff2 = packStop(id, file.parsed, file.metrics).woff2;
        file.checked = verifyFile(id, file.woff2, file.metrics, forbidden);
      }
      return { variants: plan, files: built, measurements: measured };
    };

    const { variants, files, measurements } = await shedToBudget(
      { id, cases, featuresByCase, stops, log },
      attempt,
    );

    // PLAN §5.2 converts the written asc/desc back to em, so the grid they are on is part of
    // the contract. It belongs to the face, not to a pinned instance: pinning an axis cannot
    // change it, and the renderer should never have to ask which file it is looking at.
    const upm = files[0].checked.upm;
    for (const file of files) {
      if (file.checked.upm !== upm)
        fail(id, `unitsPerEm differs between stops (${upm} and ${file.checked.upm})`);
      if (file.upem !== upm)
        fail(id, `unitsPerEm changed under subsetting (${file.upem} became ${upm})`);
    }

    const notice = changeNotice(row.family, version, row.url);
    const em = (value, upem) => Number((value / upem).toFixed(5));

    result = {
      meta: {
        id,
        family: row.family,
        src: { url: row.url, sha256: sha256(upstream) },
        licenseId: row.licenseId,
        copyright: row.copyright,
        // Rule 3: the names the licence reserves, `[]` when it reserves none. A non-empty
        // array means the shipped files carry `neutralName(id, [family, ...rfn])` in their
        // name table instead of `family`; `family` above is still the upstream face, which
        // is what the colophon and `fonts/licenses/<id>.txt` credit.
        rfn,
        archetype: row.archetype,
        traits,
        odds: row.odds,
        upm,
        files: files.map((f) => ({
          id: f.stop.id,
          axes: f.stop.axes,
          bytes: f.woff2.length,
          sha256: sha256(f.woff2),
          asc: f.metrics.asc,
          desc: f.metrics.desc,
          // Both in em, both per stop because pinning wght moves them a long way. `stem` is
          // the capital I; `crossbar` is the narrowest stroke in Ł and ł, which is what
          // decides whether a stroke or a hollow outline closes the letter into a blob.
          stem: f.stroke.stem === null ? null : Number(f.stroke.stem.toFixed(4)),
          crossbar: f.stroke.crossbar === null ? null : Number(f.stroke.crossbar.toFixed(4)),
          glyphs: f.checked.glyphs,
        })),
        variants: variants.map((v) => {
          const { words, upem } = measurements.get(v.id);
          const file = files.find((f) => f.index === v.stop);
          const word = (w) => ({
            W: em(w.right - w.left, upem),
            H: em(w.top - w.bottom, upem),
            X: em(w.left, upem),
            top: em(w.top, upem),
          });
          return {
            id: v.id,
            file: file.stop.id,
            case: v.case,
            css: {
              weight: file.stop.axes.wght ?? file.weight ?? 400,
              style: "normal",
              feat: v.feats.length ? v.feats.map((t) => `"${t}" 1`).join(",") : "normal",
            },
            w1: word(words[0]),
            w2: word(words[1]),
          };
        }),
      },
      licenseText: licenseFile({ notice, name0, license, extras }),
      files: files.map((f) => ({ name: `${id}.${f.stop.id}.woff2`, data: f.woff2 })),
    };
  } finally {
    opened.close();
  }
  return result;
}
