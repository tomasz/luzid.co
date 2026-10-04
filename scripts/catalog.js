/**
 * Globs the data directories into one `build/catalog.js` module.
 *
 * It does no maths and no network: fonts and palettes arrive already measured and
 * role-assigned from `scripts/fonts.js` and `scripts/palettes.js`, so a deploy never
 * runs the font or colour toolchain. A font's curated facts are joined in from its source
 * row, so changing its buckets, traits or odds never needs that toolchain either. The one
 * thing it computes is base64 — doing that per request would burn CPU on every visit.
 *
 * Effects are JS modules with functions in them, so they are re-exported by a static
 * import rather than serialized; Rolldown inlines them when `vp build` bundles the Worker.
 * It runs in three steps, `readCatalog` → `checkCatalog` → `catalogModule`, which
 * `writeCatalog` (alias `build`, what the `catalog` plugin in vite.config.js calls) chains
 * and `loadCatalog` reuses for every reader that wants the catalog without a file. The CLI
 * is for fixtures:
 *
 *   node scripts/catalog.js [--root <dir>] [--out <file>]
 *
 * The counts and effective sizes it prints are informational. This script never fails a
 * build over taste; it fails only when a data file breaks the contract, with
 * `<file>: /<pointer>: <message>` (the rules are in `scripts/catalog/check.js`).
 */
import { glob, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { CASE_TRAITS, checkCatalog, effectDefaults, PALETTE_ODDS } from "./catalog/check.js";

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * @param {string} root
 * @param {string} pattern
 */
async function find(root, pattern) {
  const out = [];
  for await (const hit of glob(pattern, { cwd: root })) out.push(hit);
  return out.sort();
}

/**
 * @param {string} file
 */
async function json(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    throw new Error(`${file}: ${err.message}`, { cause: err });
  }
}

/**
 * Inverse Simpson index: how many items the axis behaves like, given its odds. It is the
 * number that collapses when a weights file over-boosts one item, so it is worth printing
 * even though nothing gates on it.
 *
 * @param {readonly number[]} odds
 */
function effective(odds) {
  const total = odds.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const sum = odds.reduce((a, o) => a + (o / total) ** 2, 0);
  return sum === 0 ? 0 : 1 / sum;
}

/**
 * Reads every data file under `root`, as `{file, data}` with `file` relative to the root,
 * which is what every check message names. I/O only: nothing here judges what it read,
 * except that every JSON file must parse. Effects are imported, so their metadata can be
 * checked; the module still re-exports them by path.
 *
 * `deny` and `weights` are `null` when the file is absent, which means "no rules". A file
 * that is present but broken fails the build instead of silently dropping every rule in it.
 *
 * @param {string} root
 * @param {boolean} [fresh] bypass Node's module cache for effects (the dev watcher)
 */
export async function readCatalog(root, fresh = false) {
  root = resolve(root);
  const read = async (pattern) =>
    Promise.all(
      (await find(root, pattern)).map(async (file) => ({
        file,
        data: await json(resolve(root, file)),
      })),
    );
  const optional = async (file) =>
    (await find(root, file)).length ? { file, data: await json(resolve(root, file)) } : null;

  const effects = await Promise.all(
    (await find(root, "effects/*.js")).map(async (file) => ({
      file,
      data: (
        await import(pathToFileURL(resolve(root, file)).href + (fresh ? `?t=${Date.now()}` : ""))
      ).default,
    })),
  );
  const woff2 = new Map();
  for (const file of await find(root, "fonts/files/*.woff2"))
    woff2.set(file, await readFile(resolve(root, file)));

  // A palette file's tier is its source's, and the source's adapter is where it is stated
  // (§5.4). A file with no adapter (the hand-written qa.json, the fixtures) has no tier.
  const palettes = await Promise.all(
    (await read("data/palettes/*.json")).map(async (entry) => {
      const adapter = `scripts/palettes/sources/${basename(entry.file, ".json")}.js`;
      if ((await find(root, adapter)).length === 0) return entry;
      const { tier } = (await import(pathToFileURL(resolve(root, adapter)).href)).default;
      return { ...entry, tier };
    }),
  );

  return {
    root,
    fonts: await read("fonts/meta/*.json"),
    sources: await read("fonts/sources/*.json"),
    palettes,
    presets: await read("presets/*.json"),
    effects,
    deny: await optional("data/deny.json"),
    weights: await optional("data/weights.json"),
    woff2,
  };
}

// Throws `<file>: /<pointer>: <message>` on the first broken data file and returns the
// warnings that are not errors yet. Never over taste.
export { checkCatalog };

/**
 * The rows `build/catalog.js` exports, with every default the contract allows a file to
 * omit filled in, so the engine never guesses. Effects are left out: the module imports
 * them, and `effectDefaults` fills them where they are emitted.
 *
 * @param {Awaited<ReturnType<typeof readCatalog>>} cat
 */
function rows(cat) {
  const sources = new Map(cat.sources.map((e) => [e.data.id, e.data]));
  // §5.5: the curated facts come from the source row, the measured ones from the meta. The
  // traits are the row's plus what the pipeline measured, as `reconcileTraits` merges them:
  // a row that names one of the two case labels keeps its word for it.
  const fonts = cat.fonts.map(({ data: meta }) => {
    const row = sources.get(meta.id);
    const named = row.traits.some((t) => CASE_TRAITS.includes(t));
    const measured = meta.measured.filter((t) => !(named && CASE_TRAITS.includes(t)));
    return {
      id: meta.id,
      family: row.family,
      src: { url: row.url, sha256: row.sha256 },
      licenseId: row.licenseId,
      copyright: row.copyright,
      rfn: meta.rfn,
      archetype: row.archetype,
      traits: [...new Set([...row.traits, ...measured])].sort((a, b) => (a < b ? -1 : 1)),
      odds: row.odds,
      upm: meta.upm,
      files: meta.files.map((f) => ({
        ...f,
        b64: cat.woff2.get(`fonts/files/${meta.id}.${f.id}.woff2`).toString("base64"),
      })),
      variants: meta.variants,
    };
  });
  // §5.4: what a palette file never stores. The source is the file name; a role set's
  // `colors` is the number of distinct slots its `o` fills, and its `ground` the derived
  // washi or sumi it sits on.
  const palettes = cat.palettes.flatMap((e) =>
    e.data.map((row) => ({
      ...row,
      src: basename(e.file, ".json"),
      ...(e.tier ? { tier: e.tier } : {}),
      odds: row.odds ?? PALETTE_ODDS,
      roles: row.roles.map((r) => ({
        ...r,
        colors: new Set(r.o.replaceAll("-", "")).size,
        ground: r.o[0] === "w" || r.o[0] === "k" ? r.o[0] : null,
      })),
    })),
  );
  return {
    fonts: fonts.sort(byId),
    palettes: palettes.sort(byId),
    presets: cat.presets.map((e) => e.data).sort(byId),
    deny: cat.deny?.data.deny ?? [],
    weights: cat.weights?.data ?? {},
  };
}

/** The keys an effect left out, with their defaults; `{}` when it states all of them. */
function missing(fx) {
  return Object.fromEntries(Object.entries(effectDefaults(fx)).filter(([k]) => !(k in fx)));
}

/**
 * The `build/catalog.js` source for a module written into `outDir`.
 *
 * @param {Awaited<ReturnType<typeof readCatalog>>} cat
 * @param {string} outDir
 */
export function catalogModule(cat, outDir) {
  const imports = cat.effects.map(({ file, data }, i) => {
    const spec = relative(outDir, resolve(cat.root, file)).split("\\").join("/");
    // An effect that states every key is exported as is; one that leaves some out gets
    // them appended, so the module and `loadCatalog` hand the engine the same object.
    const fill = JSON.stringify(missing(data)).slice(1, -1);
    const value = fill ? `{...fx${i},${fill}}` : `fx${i}`;
    return { name: `fx${i}`, spec: spec.startsWith(".") ? spec : `./${spec}`, value };
  });
  const r = rows(cat);
  return (
    `// Generated by scripts/catalog.js from ${relative(process.cwd(), cat.root) || "."}.\n` +
    "// Do not edit; do not commit. Regenerate with: node scripts/catalog.js\n" +
    `${imports.map((i) => `import ${i.name} from '${i.spec}'`).join("\n")}\n` +
    "export default {\n" +
    ` fonts: ${JSON.stringify(r.fonts)},\n` +
    ` palettes: ${JSON.stringify(r.palettes)},\n` +
    ` effects: [${imports.map((i) => i.value).join(", ")}],\n` +
    ` presets: ${JSON.stringify(r.presets)},\n` +
    ` deny: ${JSON.stringify(r.deny)},\n` +
    ` weights: ${JSON.stringify(r.weights)},\n` +
    "}\n"
  );
}

/**
 * The catalog as `build/catalog.js` exports it, without writing anything: for the e2e
 * specs, the contact sheets and the unit tests, which must not depend on `build/`.
 *
 * @param {string} [root]
 */
export async function loadCatalog(root = ".") {
  const cat = await readCatalog(root);
  checkCatalog(cat);
  const { fonts, palettes, presets, deny, weights } = rows(cat);
  const effects = cat.effects.map(({ data }) => {
    const fill = missing(data);
    return Object.keys(fill).length ? { ...data, ...fill } : data;
  });
  return { fonts, palettes, effects, presets, deny, weights };
}

/**
 * Reads, checks and writes `out` plus its `.d.ts`. The `catalog` plugin in vite.config.js
 * calls this as `build()`.
 *
 * @param {{root?: string, out?: string, quiet?: boolean, fresh?: boolean}} [opts]
 */
export async function writeCatalog(opts = {}) {
  const out = resolve(opts.out ?? "build/catalog.js");
  const cat = await readCatalog(opts.root ?? ".", opts.fresh);
  const warnings = checkCatalog(cat);

  // The type check reads this declaration instead of the module, whose inferred type would
  // be a literal of every row and every base64 font, rebuilt on each check.
  const types = relative(dirname(out), fileURLToPath(new URL("../src/types.js", import.meta.url)));
  const declaration =
    "// Generated by scripts/catalog.js. Do not edit; do not commit.\n" +
    `declare const catalog: import("${types.split("\\").join("/")}").Catalog;\n` +
    "export default catalog;\n";

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, catalogModule(cat, dirname(out)));
  await writeFile(`${out.replace(/\.js$/, "")}.d.ts`, declaration);

  if (!opts.quiet) report({ ...rows(cat), effects: cat.effects }, out, warnings);
  return { out, warnings };
}

export { writeCatalog as build };

/** Informational only: counts, the effective size (1/Σp²) per axis, and the warnings. */
function report(c, out, warnings) {
  const w = c.weights ?? {};
  const odds = (items, table, fallback = 4) =>
    items.map((x) => Math.max(0, Math.min(16, Math.floor(table?.[x.id] ?? x.odds ?? fallback))));

  const variants = c.fonts.flatMap((f) => f.variants ?? []);
  const roles = c.palettes.flatMap((p) => (p.roles ?? []).map((r) => ({ id: r.o, odds: r.odds })));
  const bytes = c.fonts.flatMap((f) => f.files.map((x) => x.bytes));

  const rows = [
    ["fonts", c.fonts.length, effective(odds(c.fonts, w.f))],
    ["variants", variants.length, effective(odds(variants, null))],
    ["palettes", c.palettes.length, effective(odds(c.palettes, w.p))],
    ["role sets", roles.length, effective(odds(roles, null))],
    ["effects", c.effects.length, null],
    ["presets", c.presets.length, effective(odds(c.presets, w.preset))],
    ["deny rules", c.deny.length, null],
  ];

  const where = relative(process.cwd(), out) || out;
  console.log(`catalog → ${where}`);
  for (const [name, n, eff] of rows) {
    console.log(
      `  ${name.padEnd(11)} ${String(n).padStart(4)}${eff ? `   effective ${eff.toFixed(1)}` : ""}`,
    );
  }
  if (bytes.length > 0) {
    const max = Math.max(...bytes);
    const mean = Math.round(bytes.reduce((a, b) => a + b, 0) / bytes.length);
    console.log(`  font bytes  mean ${mean} · max ${max}`);
  }
  for (const w of warnings) console.warn(`  warning: ${w}`);
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      root: { type: "string", default: "." },
      out: { type: "string", default: "build/catalog.js" },
    },
  });
  await writeCatalog(values);
}
