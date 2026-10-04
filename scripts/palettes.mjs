/**
 * Regenerates the committed palette data: runs every adapter in `scripts/palette-sources/`,
 * assigns roles with `roles.mjs`, and writes `data/palettes/<source>.json`.
 *
 *   node scripts/palettes.mjs [--source <id>] [--check]
 *
 * `--check` writes nothing and fails if a file on disk differs from what this run produces,
 * which is what `test/palettes.test.js` and CI rely on. The roles are committed inside each
 * row on purpose (PLAN §5.4): a deploy never runs colour maths.
 *
 * Row shape:
 *
 *   {id, odds?, names[], namesJa[]?, hex[], roles[{o, dark}]}
 *
 * Only what cannot be derived is written. The catalog build fills the rest (§5.4): `src` is
 * the file name, `tier` the adapter's, `odds` defaults to 4, and each role set's `colors`
 * and `ground` come from its `o`.
 *
 * `hex` holds the palette's own colours first, `names` names them one for one. A row whose
 * combination has no pair reaching 3:1 gets both derived grounds appended after them, always
 * in this order, so the four-character `o` of a role set resolves without any colour maths:
 *
 *   digit → hex[digit]      w → hex[names.length]      k → hex[names.length + 1]
 *   o[2] === '-' → --a1 is var(--fg)   ·   o[3] === '-' → --a2 is var(--bg)
 *
 * An adapter is a module whose default export is `{id, tier, rows()}`; `rows()` returns rows
 * of `{id, names, namesJa?, hex, odds?}` and does its own count assertions. Adding a source is
 * adding a file — this driver needs no edit. The driver checks the adapter and every row
 * before it writes anything, so a broken adapter can never leave a half-valid file behind.
 */
import { glob, mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { grounds, roleSets } from "./roles.mjs";

const ROOT = new URL("../", import.meta.url);
const SOURCES = new URL("palette-sources/", import.meta.url);
const TIERS = ["historical", "editorial", "era-approx"];
const HEX = /^#[0-9a-f]{6}$/;

/** Runs the generator; resolves to the exit code. Throws on a bad adapter, row or argument. */
export async function main(argv) {
  const { values } = parseArgs({
    // `pnpm run palettes -- --check` forwards the separator itself, so drop it.
    args: argv.slice(2).filter((a) => a !== "--"),
    options: { source: { type: "string" }, check: { type: "boolean", default: false } },
  });

  const files = (await Array.fromAsync(glob("*.mjs", { cwd: SOURCES }))).sort();
  const adapters = [];
  for (const file of files) {
    const adapter = (await import(new URL(file, SOURCES).href)).default;
    checkAdapter(adapter, file);
    adapters.push(adapter);
  }
  const chosen = adapters.filter((a) => !values.source || a.id === values.source);
  if (chosen.length === 0) {
    const ids = adapters.map((a) => a.id).join(", ");
    throw new Error(`unknown --source "${values.source}"; known sources: ${ids}`);
  }

  // Build every chosen source in memory first, so a bad row stops the run before any write.
  const outputs = [];
  for (const adapter of chosen) outputs.push(await generate(adapter));

  let failed = false;
  for (const { id, json } of outputs) {
    const out = new URL(`data/palettes/${id}.json`, ROOT);
    if (values.check) {
      const have = await readFile(out, "utf8").catch(() => "");
      if (have !== json) {
        console.error(`${id}: data/palettes/${id}.json is stale — run \`pnpm run palettes\``);
        failed = true;
      }
    } else {
      await mkdir(new URL("data/palettes/", ROOT), { recursive: true });
      await writeFile(out, json);
    }
  }
  return failed ? 1 : 0;
}

async function generate({ id, rows: source }) {
  const input = await source();
  if (!Array.isArray(input)) throw new Error(`${id}: rows() must return an array`);
  const rows = input.map((row) => {
    checkRow(row, id);
    const roles = roleSets(row.hex);
    if (roles.length === 0)
      throw new Error(`${row.id}: no role set — roles.mjs must always emit one`);
    const hex = roles.some(onGround) ? [...row.hex, ...grounds(row.hex)] : row.hex;
    return {
      id: row.id,
      ...(row.odds !== undefined ? { odds: row.odds } : {}),
      names: row.names,
      ...(row.namesJa ? { namesJa: row.namesJa } : {}),
      hex,
      roles,
    };
  });
  const ids = new Set(rows.map((r) => r.id));
  if (ids.size !== rows.length) throw new Error(`${id}: duplicate row id`);

  // One row per line: a diff then shows exactly which combinations moved.
  const json = `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`;

  const sets = rows.flatMap((r) => r.roles);
  const derived = sets.filter(onGround);
  const combos = rows.filter((r) => r.roles.some(onGround)).length;
  console.log(
    `${id}: ${rows.length} combos → ${sets.length} role sets, ` +
      `${derived.length} on a derived ground (${combos} combos, ` +
      `${derived.filter((r) => r.o[0] === "w").length} washi / ` +
      `${derived.filter((r) => r.o[0] === "k").length} sumi), ` +
      `${sets.filter((r) => r.dark).length} dark · ${json.length} B`,
  );
  return { id, json };
}

/** A role set sits on a derived ground when its bg is `w` or `k`. */
const onGround = (role) => role.o[0] === "w" || role.o[0] === "k";

function checkAdapter(adapter, file) {
  const fail = (what) => {
    throw new Error(`palette-sources/${file}: ${what}`);
  };
  if (!adapter) fail("needs a default export {id, tier, rows}");
  // The id names the output file, so keep it to a plain path segment.
  if (typeof adapter.id !== "string" || !/^[a-z0-9]+$/.test(adapter.id))
    fail(`id must match /^[a-z0-9]+$/, got ${JSON.stringify(adapter.id)}`);
  if (!TIERS.includes(adapter.tier))
    fail(`tier must be one of ${TIERS.join(", ")}, got ${JSON.stringify(adapter.tier)}`);
  if (typeof adapter.rows !== "function") fail("rows must be a function");
}

function checkRow(row, src) {
  const where = `${src}: row ${JSON.stringify(row?.id)}`;
  const fail = (what) => {
    throw new Error(`${where}: ${what}`);
  };
  if (typeof row?.id !== "string" || !row.id.startsWith(`${src}-`))
    fail(`id must start with "${src}-"`);
  const n = row.names?.length;
  if (!Array.isArray(row.names) || n < 2 || n > 4) fail("needs 2–4 names");
  if (!row.names.every((s) => typeof s === "string" && s.length > 0)) fail("empty name");
  if (!Array.isArray(row.hex) || row.hex.length !== n) fail("needs one hex per name");
  if (!row.hex.every((h) => HEX.test(h))) fail("hex must be lowercase #rrggbb");
  if (row.namesJa !== undefined && (!Array.isArray(row.namesJa) || row.namesJa.length !== n))
    fail("namesJa must name every colour");
  if (row.odds !== undefined && !(Number.isInteger(row.odds) && row.odds >= 0))
    fail("odds must be a non-negative integer");
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
