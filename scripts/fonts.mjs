#!/usr/bin/env node
/**
 * The font pipeline: source rows in → committed WOFF2 subsets, metadata and licences out.
 * Every rule of PLAN §5.5 is enforced here and every one of them is a hard failure.
 *
 *   node scripts/fonts.mjs                    every row in fonts/sources (one <id>.json each)
 *   node scripts/fonts.mjs --archetype A,F    rows whose `archetype` lists any of these letters
 *                                             (A–F, or X for the unbuilt rows; repeatable or
 *                                             comma-separated)
 *   node scripts/fonts.mjs --seed             the eight rows marked `"seed": true`
 *   node scripts/fonts.mjs --id pacifico      some fonts (repeatable or comma-separated)
 *   node scripts/fonts.mjs --check            rebuild into memory and byte-compare with disk;
 *                                             list what is changed, missing or stale, exit 1
 *   node scripts/fonts.mjs --traits           measure the geometric traits, build nothing
 *   node scripts/fonts.mjs --root <dir>       read and write <dir>/fonts instead of ./fonts
 *
 * Nothing is ever written outside `fonts/`, and `--check` and `--traits` write nothing there
 * either. Upstream originals are cached in the OS temp directory, keyed by their sha256, so a
 * re-run is offline and cannot be poisoned.
 *
 * The three deliberate choices worth knowing before changing anything here:
 *
 *  - The Google `css2` API is never a source. It silently strips `ssNN`, `salt`, `swsh` and
 *    `dlig` from what it serves (google/fonts#1335), which is exactly the material this site
 *    randomises over. Sources are raw files at an immutable commit, or a direct file URL plus
 *    a copy committed under `fonts/upstream/` when the upstream has no VCS at all.
 *  - A feature is "effective" only if shaping the two real words with it on differs from
 *    shaping them with it off. GSUB coverage tables over-report badly — they list every glyph
 *    a lookup *could* touch, including alternates of letters we do not ship.
 *  - Every shipped file is a fully pinned static instance. A variable font that keeps its
 *    `gvar` costs several times the budget, and pinning also lets the renderer avoid
 *    `font-variation-settings` entirely.
 */
import { hash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
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
} from "./sfnt.mjs";
import { decode, encode } from "./woff2.mjs";
import {
  assertUniqueIds,
  BASE_FEATURES,
  BUDGET_BYTES,
  CASE_FEATURES,
  casesFor,
  FEATURE_DENY,
  LETTERS,
  MEASURED_TRAITS,
  MAX_VARIANTS,
  pinnedToCommit,
  RowError,
  stopsOf,
  TEXT,
  upstreamPaths,
  validateRow,
  WORDS,
} from "./fonts/rules.js";
import {
  assertCopyright,
  changeNotice,
  licenseFile,
  lintNames,
  neutralName,
  renameRecords,
  reservedFontNames,
  upstreamVersion,
} from "./fonts/licence.js";
import { drawn, inkBox, openFont, outlineOf, shape } from "./fonts/shape.js";
import { measureCrossbar, measureStem, measureTraits, reconcileTraits } from "./fonts/measure.js";

// The schema and constants moved to `fonts/rules.js`, the licence handling to
// `fonts/licence.js` and the outline geometry to `fonts/measure.js`; the tests still import
// them from here.
export {
  ARCHETYPES,
  assertUniqueIds,
  BUDGET_BYTES,
  CASES,
  LETTERS,
  LICENSE_IDS,
  MAX_STOPS,
  MAX_VARIANTS,
  MEASURED_TRAITS,
  pinnedToCommit,
  RowError,
  TEXT,
  TRAITS,
  upstreamPaths,
  validateRow,
  WORDS,
} from "./fonts/rules.js";
export {
  changeNotice,
  lintNames,
  neutralName,
  renameRecords,
  reservedFontNames,
  squash,
} from "./fonts/licence.js";
export {
  measureCrossbar,
  measureStem,
  reconcileTraits,
  traitDisagreements,
} from "./fonts/measure.js";

/** PLAN §5.5 rule 7. The response budget (§9.1) is the final gate; this is the per-file one. */
export function checkBudget(id, bytes) {
  if (bytes > BUDGET_BYTES)
    throw new BudgetError(id, `${bytes} B is over the ${BUDGET_BYTES} B budget`);
  return bytes;
}

// ---------------------------------------------------------------- small helpers

/** Rule 7's failure, the one the ladder in `shedToBudget` may recover from. */
export class BudgetError extends RowError {}

const sha256 = (data) => hash("sha256", data);
const fail = (id, message) => {
  throw new RowError(id, message);
};

// ---------------------------------------------------------------- gates

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

// ---------------------------------------------------------------- features

/**
 * PLAN §5.5 rule 4. Shape both words with the tag off and with it on; keep the tag only if
 * the glyph and position stream really differs. Case-like tags additionally have to change
 * every letter, Ł and ł included, or they are a partial small-caps that looks like a bug.
 */
export function effectiveFeatures(font, caseName, candidates) {
  const kept = [];
  for (const tag of candidates) {
    let differs = false;
    let everyLetter = true;
    for (const word of WORDS[caseName]) {
      const before = shape(font, word);
      const after = shape(font, word, [tag]);
      if (drawn(font, word) !== drawn(font, word, [tag])) differs = true;
      if (before.length !== after.length) {
        everyLetter = false;
      } else {
        for (let i = 0; i < before.length; i++) {
          const same = outlineOf(font, before[i].codepoint) === outlineOf(font, after[i].codepoint);
          if (same) everyLetter = false;
        }
      }
    }
    if (!differs) continue;
    if (CASE_FEATURES.includes(tag) && !everyLetter) continue;
    kept.push(tag);
  }
  return kept;
}

/**
 * Drop feature tags whose variant would shape the two words exactly like a variant that is
 * already being kept. Rule 4's on-versus-off test only ever compares a tag against plain
 * text, which lets three kinds of duplicate through, all of them seen in the batches:
 *
 *  - alias tags. `salt` and `ss01` are the same substitution in Playball, Moon Dance,
 *    Tagger and four of batch A, so both passed the on-versus-off test and shipped
 *    byte-identical files under two names;
 *  - a tag that only repeats what `text-transform` has already done;
 *  - `uppercase` + `c2sc` against `lowercase` + `smcp`, which arrive at the same small
 *    caps from opposite directions, so any font carrying both shipped a guaranteed pair;
 *  - and a feature that selects the same glyphs with the same advances and only moves them
 *    with a GPOS placement, which is the same question with the position dropped.
 *
 * That last one is why `drawn` leaves placement out. The fit normalises to the ink box —
 * the box top is pinned to the block top, the box width sets the font size — so moving the
 * whole word up, down or sideways is normalised straight back out, and what survives is at
 * most a per-glyph jitter nobody asked for.
 *
 * Bungee's `ss12` is the case that proved it: identical glyph ids, identical outlines and
 * identical advances to `ss01`, differing only by a y-placement of about -0.208 em. It
 * shipped as a separate variant that renders the same as `ss01` once fitted — and engines
 * disagree about it. Measuring the ink top of line 1 against the box top at 390x844 gives
 * -0.10 px on Firefox and Darwin WebKit, -1.11 px on Chromium, and -27.11 px on Linux
 * WebKit. That is 2.025x the shift, not the 1.0x of ignoring it: Linux WebKit applies the
 * placement with the opposite sign, and the name lands 12 px off centre there.
 *
 * x and y are treated alike, which is a choice rather than an assumption about symmetry.
 * Under the fit they really are symmetric — `W` is an ink width exactly as `top` is an ink
 * top, so both normalise away the absolute offset and expose only the relative arrangement.
 * What is not symmetric is the risk: a y-placement is the rare path engines get wrong, an
 * x-placement is the everyday kerning path they agree on. Rejecting both is the
 * conservative reading and costs nothing measurable — across the 692 variants in the
 * library there is exactly one placement-only pair, Bungee's, and no x-only pair at all.
 *
 * The plain variant of every case is seeded first and therefore always wins. After that the
 * order follows `planVariants` — round by round, cases in their given order — so the tag
 * that survives a collision is the one whose variant would have come first anyway.
 */
export function dedupeCombos(font, cases, featuresByCase) {
  const shaped = (caseName, feats) =>
    WORDS[caseName].map((word) => drawn(font, word, feats)).join(" | ");
  const seen = new Set(cases.map((c) => shaped(c, [])));
  const kept = Object.fromEntries(cases.map((c) => [c, []]));
  const rounds = Math.max(0, ...cases.map((c) => featuresByCase[c].length));
  for (let round = 0; round < rounds; round++) {
    for (const caseName of cases) {
      const tag = featuresByCase[caseName][round];
      if (tag === undefined) continue;
      const key = shaped(caseName, [tag]);
      if (seen.has(key)) continue;
      seen.add(key);
      kept[caseName].push(tag);
    }
  }
  return kept;
}

/** GSUB tags this font actually has, minus the base set and the junk list. */
function candidateFeatures(face, allowed) {
  const tags = [...new Set(face.getTableFeatureTags("GSUB"))]
    .filter((t) => !BASE_FEATURES.includes(t) && !FEATURE_DENY.has(t))
    .sort();
  return allowed ? tags.filter((t) => allowed.includes(t)) : tags;
}

// ---------------------------------------------------------------- fetching

const cacheDir = join(tmpdir(), "luzid-fonts");

async function fetchBinary(url) {
  // A stalled host would otherwise hang the whole batch with no error at all.
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`GET ${url} → ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Upstream original, from `fonts/upstream` when committed, else from a sha-keyed cache.
 * The temp cache is always written. The repository is written only when `writeRepo` says so:
 * `--check` and `--traits` must leave the tree exactly as they found it.
 */
async function source(row, dirs, { writeRepo }) {
  if (!pinnedToCommit(row.url)) {
    const path = join(dirs.upstream, upstreamPaths(row).original);
    const buffer = await readFile(path).catch(() => null);
    if (buffer) return buffer;
    const fetched = await fetchBinary(row.url);
    if (!writeRepo) return fetched;
    await mkdir(dirs.upstream, { recursive: true });
    await writeFile(path, fetched);
    return fetched;
  }
  await mkdir(cacheDir, { recursive: true });
  if (row.sha256) {
    const cached = await readFile(join(cacheDir, `${row.sha256}.bin`)).catch(() => null);
    if (cached && sha256(cached) === row.sha256) return cached;
  }
  const fetched = await fetchBinary(row.url);
  await writeFile(join(cacheDir, `${sha256(fetched)}.bin`), fetched);
  return fetched;
}

async function licenseText(row, dirs) {
  await mkdir(cacheDir, { recursive: true });
  const parts = [];
  for (const url of [row.licenseUrl]) {
    const key = join(cacheDir, `${sha256(url)}.txt`);
    let text = await readFile(key, "utf8").catch(() => null);
    if (text === null) {
      text = (await fetchBinary(url)).toString("utf8");
      await writeFile(key, text);
    }
    parts.push(text.replace(/\r\n/g, "\n").trimEnd());
  }
  // Rule 8 wants the upstream MANIFEST appended for GUST fonts. It is committed rather
  // than fetched: CTAN has no immutable URLs, so a build must not depend on reaching it.
  const notice = await readFile(join(dirs.upstream, upstreamPaths(row).notice), "utf8").catch(
    () => null,
  );
  if (notice) parts.push(notice.replace(/\r\n/g, "\n").trimEnd());
  return parts;
}

// ---------------------------------------------------------------- the pipeline

const CASE_SHORT = { none: "n", uppercase: "u", lowercase: "l" };

/**
 * Case × effective feature sets × stops, capped at `MAX_VARIANTS`. Built round by round so
 * that trimming loses the most decorated variants first and every case keeps its plain one.
 */
export function planVariants({ cases, featuresByCase, stops }) {
  const rounds = Math.max(...cases.map((c) => featuresByCase[c].length + 1));
  const out = [];
  for (let round = 0; round < rounds; round++) {
    for (const caseName of cases) {
      const feats = round === 0 ? [] : featuresByCase[caseName].slice(round - 1, round);
      if (round > 0 && feats.length === 0) continue;
      for (const [index, stop] of stops.entries()) {
        if (out.length >= MAX_VARIANTS) return out;
        out.push({
          id: `${CASE_SHORT[caseName]}-${feats.length ? feats.join("-") : "base"}-${stop.id}`,
          case: caseName,
          feats,
          stop: index,
        });
      }
    }
  }
  return out;
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

/**
 * PLAN §5.5 rule 7's ladder. Run `attempt`; if it comes back over budget, shed the last
 * effective feature of every case, then whole stops, then give up and let the font be
 * dropped. Anything that is not a budget failure propagates untouched.
 *
 * `attempt` has to be the *whole* build, down to weighing the packed file, or the ladder
 * never runs: the budget is only knowable at the last step, so a build that stops short of
 * it and weighs the file afterwards throws from outside the `try` and takes the batch down
 * with it. That is precisely what used to happen, and it is why this is one function with
 * the attempt passed in rather than a loop wrapped around part of the work.
 */
export async function shedToBudget({ id, cases, featuresByCase, stops, log = () => {} }, attempt) {
  const state = { featuresByCase: { ...featuresByCase }, stops };
  for (;;) {
    try {
      return await attempt(state);
    } catch (error) {
      if (!(error instanceof BudgetError)) throw error;
      const over = error.reason;
      if (cases.some((c) => state.featuresByCase[c].length > 0)) {
        for (const c of cases) state.featuresByCase[c] = state.featuresByCase[c].slice(0, -1);
        log(`${id}: ${over}; dropped the last effective feature`);
        continue;
      }
      if (state.stops.length > 1) {
        state.stops = state.stops.slice(0, -1);
        log(`${id}: ${over}; dropped a stop`);
        continue;
      }
      fail(id, `${over} with nothing left to trim — drop the font`);
    }
  }
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

async function processRow(row, dirs, log, { writeRepo }) {
  const id = row.id;
  const original = await source(row, dirs, { writeRepo });
  const digest = sha256(original);
  if (row.sha256 && row.sha256 !== digest)
    fail(id, `sha256 mismatch: row says ${row.sha256}, file is ${digest}`);
  const filled = row.sha256 ? null : digest;

  const upstream = openFont(original);
  let result;
  try {
    checkCoverage(id, upstream);

    // Licence gate, PLAN §5.5 rule 3.
    const [license, ...notices] = await licenseText(row, dirs);
    const name0 = upstream.face.getName(0, "en");
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
    const version = upstreamVersion(upstream.face.getName(5, "en"));
    // The lint list, and the rename, are only built for a font that reserves something: a
    // font with no Reserved Font Name keeps its own name table, byte for byte.
    const forbidden = rfn.length > 0 ? [row.family, ...rfn] : [];
    const rename = rfn.length > 0 ? { name: neutralName(id, forbidden), version } : null;
    if (rename)
      log(`${id}: reserves ${rfn.map((n) => `"${n}"`).join(", ")} — shipping as ${rename.name}`);

    // Every axis has to be pinned, not just the ones we vary, so all of them are read.
    const axes = Object.values(upstream.face.getAxisInfos());
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
    const measured = measureTraits(upstream, stops[0].axes);
    const traits = reconcileTraits(id, row.traits, measured);
    const cases = casesFor(row, measured);

    const candidates = candidateFeatures(upstream.face, row.features);
    // Rule 4 keeps a tag that changes the words; the dedupe then drops the ones that all
    // change them the same way. Both are needed: the first is per tag, the second per pair.
    const featuresByCase = dedupeCombos(
      upstream.font,
      cases,
      Object.fromEntries(cases.map((c) => [c, effectiveFeatures(upstream.font, c, candidates)])),
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
          ...(await subsetStop({ original, axes: stop.axes, keepFeatures, rename })),
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
        src: { url: row.url, sha256: digest },
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
      license: licenseFile({ notice, name0, license, extras: notices }),
      files: files.map((f) => ({ name: `${id}.${f.stop.id}.woff2`, data: f.woff2 })),
      filled,
    };
  } finally {
    upstream.close();
  }
  return result;
}

/**
 * `--traits`: download every selected source, measure the five geometric traits and diff
 * them against what the rows declare. It never subsets and never writes, so a whole batch
 * of curated lists can be checked in a couple of minutes before the build agents start.
 */
async function auditTraits(rows, dirs, log) {
  const disagreements = [];
  const unreadable = [];
  const added = new Map();
  for (const { row } of rows) {
    let opened = null;
    try {
      const original = await source(row, dirs, { writeRepo: false });
      const digest = sha256(original);
      if (row.sha256 && row.sha256 !== digest)
        throw new Error(`sha256 mismatch, file is ${digest}`);
      opened = openFont(original);
      checkCoverage(row.id, opened);
      const measured = measureTraits(opened, stopsOf(row)[0].axes);
      // Deliberately the same call the build makes, so the audit cannot drift away from it.
      try {
        reconcileTraits(row.id, row.traits, measured);
      } catch (error) {
        disagreements.push({ id: row.id, why: error.reason ?? error.message });
      }
      for (const trait of MEASURED_TRAITS) {
        if (!row.traits.includes(trait) && measured[trait])
          added.set(trait, (added.get(trait) ?? 0) + 1);
      }
    } catch (error) {
      unreadable.push({ id: row.id, why: error.reason ?? error.message });
    } finally {
      opened?.close();
    }
  }

  log(`\nChecked ${rows.length} rows.`);
  log(`Traits the rows declare and the outlines disagree with: ${disagreements.length}`);
  for (const d of disagreements) log(`  ${d.id}: ${d.why}`);
  log(
    `Traits the rows leave out and the pipeline fills in: ${[...added].map(([t, n]) => `${t} ${n}`).join(", ")}`,
  );
  if (unreadable.length > 0) {
    log(`Rows that could not be read at all: ${unreadable.length}`);
    for (const u of unreadable) log(`  ${u.id}: ${u.why}`);
  }
  return disagreements.length > 0 || unreadable.length > 0 ? 1 : 0;
}

// ---------------------------------------------------------------- entry point

/**
 * The files one built row owns: its woff2 files, its meta and its licence, exactly as they
 * are written. `--check` compares this list with the disk, so the two modes cannot disagree.
 */
const outputsOf = (dirs, row, out) => [
  ...out.files.map((file) => ({ path: join(dirs.files, file.name), data: file.data })),
  { path: join(dirs.meta, `${row.id}.json`), data: `${JSON.stringify(out.meta, null, 1)}\n` },
  { path: join(dirs.licenses, `${row.id}.txt`), data: `${out.license.trimEnd()}\n` },
];

/** Runs the pipeline; resolves to the exit code. Throws on a bad argument or source row. */
export async function main(argv) {
  const { values } = parseArgs({
    // `pnpm run fonts -- --check` forwards the separator itself, so drop it.
    args: argv.slice(2).filter((a) => a !== "--"),
    options: {
      root: { type: "string", default: "." },
      archetype: { type: "string", multiple: true },
      seed: { type: "boolean", default: false },
      id: { type: "string", multiple: true },
      check: { type: "boolean", default: false },
      traits: { type: "boolean", default: false },
    },
  });
  const root = resolve(values.root);
  const dirs = {
    sources: join(root, "fonts/sources"),
    files: join(root, "fonts/files"),
    meta: join(root, "fonts/meta"),
    licenses: join(root, "fonts/licenses"),
    upstream: join(root, "fonts/upstream"),
  };
  const list = (option) => (option?.length ? new Set(option.flatMap((v) => v.split(","))) : null);
  const archetypes = list(values.archetype);
  const wanted = list(values.id);
  // `--archetype` and `--seed` add to each other; `--id` narrows whatever they selected.
  const picked = (row) =>
    (!archetypes && !values.seed) ||
    (archetypes && row.archetype.some((a) => archetypes.has(a))) ||
    (values.seed && row.seed === true);
  const files = (await readdir(dirs.sources)).filter((f) => f.endsWith(".json"));
  const all = [];
  const rows = [];
  for (const file of files.sort()) {
    const row = validateRow(JSON.parse(await readFile(join(dirs.sources, file), "utf8")));
    if (file !== `${row.id}.json`) throw new Error(`fonts/sources/${file} holds row ${row.id}`);
    all.push(row);
    if (picked(row) && (!wanted || wanted.has(row.id))) rows.push({ row });
  }
  // Every row, not just the selected ones: two files with one id would still collide.
  assertUniqueIds(all);
  if (rows.length === 0) throw new Error("no source rows selected");

  const log = (line) => console.log(line);
  if (values.traits) return await auditTraits(rows, dirs, log);
  const writeRepo = !values.check;
  const filled = new Map();
  // A row that cannot be built is still a hard failure — nothing is written for it and the
  // run exits non-zero — but the rest of the batch is built anyway. A curator needs the
  // whole list of fonts to replace, not just the first one that stopped the run.
  const refused = [];
  const drift = [];
  for (const { row } of rows) {
    let out;
    try {
      out = await processRow(row, dirs, log, { writeRepo });
    } catch (error) {
      refused.push(error.message);
      log(`${error.message}`);
      continue;
    }
    if (out.filled) filled.set(row.id, out.filled);
    const sizes = out.meta.files.map((f) => `${f.id} ${f.bytes} B`).join(" · ");
    log(
      `${row.id}: ${out.meta.files.length} file(s), ${out.meta.variants.length} variants — ${sizes}`,
    );
    const outputs = outputsOf(dirs, row, out);
    const stale = (await readdir(dirs.files).catch(() => []))
      .filter((f) => f.startsWith(`${row.id}.`) && !out.files.some((w) => w.name === f))
      .map((f) => join(dirs.files, f));
    if (values.check) {
      const where = (path) => relative(root, path);
      for (const { path, data } of outputs) {
        const disk = await readFile(path).catch(() => null);
        if (disk === null) drift.push(`missing ${where(path)}`);
        else if (!disk.equals(Buffer.from(data))) drift.push(`changed ${where(path)}`);
      }
      for (const path of stale) drift.push(`stale   ${where(path)}`);
      // The build read the original without committing it; a clean tree has to carry it.
      if (!pinnedToCommit(row.url)) {
        const path = join(dirs.upstream, upstreamPaths(row).original);
        if (!(await readFile(path).catch(() => null))) drift.push(`missing ${where(path)}`);
      }
      continue;
    }
    for (const dir of [dirs.files, dirs.meta, dirs.licenses]) await mkdir(dir, { recursive: true });
    for (const path of stale) await rm(path);
    for (const { path, data } of outputs) await writeFile(path, data);
  }
  if (filled.size > 0) {
    log("\nFill these sha256 values into the source rows and commit them:");
    for (const [id, digest] of filled) log(`  ${id}  ${digest}`);
  }
  if (drift.length > 0) {
    log(`\n--check: ${drift.length} paths differ from a fresh build — run \`pnpm run fonts\`:`);
    for (const line of drift) log(`  ${line}`);
  }
  if (refused.length > 0) {
    log(`\n${refused.length} of ${rows.length} rows were refused:`);
    for (const why of refused) log(`  ${why}`);
  }
  return drift.length > 0 || refused.length > 0 ? 1 : 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
