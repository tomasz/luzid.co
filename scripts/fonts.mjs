#!/usr/bin/env node
/**
 * The command line of the font pipeline. `fonts/fetch.js` reads the inputs, `fonts/pipeline.js`
 * builds each row, and this file selects the rows and writes or compares what comes out.
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
 * The rules themselves, and the choices behind them, are documented in `fonts/pipeline.js`
 * (rules 2–8) and `fonts/fetch.js` (rule 1).
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  assertUniqueIds,
  MEASURED_TRAITS,
  pinnedToCommit,
  stopsOf,
  upstreamPaths,
  validateRow,
} from "./fonts/rules.js";
import { openFont } from "./fonts/shape.js";
import { measureTraits, reconcileTraits } from "./fonts/measure.js";
import { readLicense, readUpstream } from "./fonts/fetch.js";
import { buildFont, checkCoverage } from "./fonts/pipeline.js";

// The tests import the pipeline's pure parts from here, as they did before the split.
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
export {
  BudgetError,
  dedupeCombos,
  effectiveFeatures,
  planVariants,
  shedToBudget,
} from "./fonts/variants.js";
export { checkBudget, checkCoverage } from "./fonts/pipeline.js";

/**
 * `--traits`: download every selected source, measure the five geometric traits and diff
 * them against what the rows declare. It never subsets and never writes, so a whole batch
 * of curated lists can be checked in a couple of minutes before the build agents start.
 */
async function auditTraits(rows, sources, log) {
  const disagreements = [];
  const unreadable = [];
  const added = new Map();
  for (const row of rows) {
    let opened = null;
    try {
      opened = openFont(await readUpstream(row, { ...sources, writeRepo: false }));
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
  { path: join(dirs.licenses, `${row.id}.txt`), data: `${out.licenseText.trimEnd()}\n` },
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
  const sources = { upstreamDir: dirs.upstream, cacheDir: join(tmpdir(), "luzid-fonts") };
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
    if (picked(row) && (!wanted || wanted.has(row.id))) rows.push(row);
  }
  // Every row, not just the selected ones: two files with one id would still collide.
  assertUniqueIds(all);
  if (rows.length === 0) throw new Error("no source rows selected");

  const log = (line) => console.log(line);
  if (values.traits) return await auditTraits(rows, sources, log);
  const writeRepo = !values.check;
  const filled = new Map();
  // A row that cannot be built is still a hard failure — nothing is written for it and the
  // run exits non-zero — but the rest of the batch is built anyway. A curator needs the
  // whole list of fonts to replace, not just the first one that stopped the run.
  const refused = [];
  const drift = [];
  for (const row of rows) {
    let out;
    try {
      const upstream = await readUpstream(row, { ...sources, writeRepo });
      const { license, extras } = await readLicense(row, sources);
      out = await buildFont({ row, upstream, license, extras, log });
    } catch (error) {
      refused.push(error.message);
      log(`${error.message}`);
      continue;
    }
    if (!row.sha256) filled.set(row.id, out.meta.src.sha256);
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
