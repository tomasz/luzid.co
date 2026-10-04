/**
 * Globs the data directories into one `build/catalog.js` module.
 *
 * It does no maths and no network: fonts and palettes arrive already measured and
 * role-assigned from `scripts/fonts.mjs` and `scripts/palettes.mjs`, so a deploy never
 * runs the font or colour toolchain. The one thing it computes is base64 — doing that per
 * request would burn CPU on every visit.
 *
 * Effects are JS modules with functions in them, so they are re-exported by a static
 * import rather than serialized; Rolldown inlines them when `vp build` bundles the Worker.
 * It runs in three steps, `readCatalog` → `checkCatalog` → `catalogModule`, which
 * `writeCatalog` (alias `build`, what the `catalog` plugin in vite.config.js calls) chains
 * and `loadCatalog` reuses for every reader that wants the catalog without a file. The CLI
 * is for fixtures:
 *
 *   node scripts/build.mjs [--root <dir>] [--out <file>]
 *
 * The counts and effective sizes it prints are informational. This script never fails a
 * build over taste; it fails only when the catalog is internally broken (a font meta whose
 * woff2 is missing or disagrees with its declared size or hash, a duplicate id, malformed
 * JSON).
 */
import { createHash } from "node:crypto";
import { glob, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

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
 * Like `json`, but a missing file gives `fallback`. Only a missing one: a present file
 * that fails to read or parse still throws.
 *
 * @param {string} file
 * @param {unknown} fallback
 */
async function optional(file, fallback) {
  try {
    return await json(file);
  } catch (err) {
    if (err.cause?.code === "ENOENT") return fallback;
    throw err;
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

/** @param {readonly {id: string}[]} items */
function assertUnique(items, kind) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`duplicate ${kind} id: ${item.id}`);
    seen.add(item.id);
  }
}

/**
 * Reads every data file under `root`. I/O only: nothing here judges what it read, except
 * that a woff2 a meta names must exist and every JSON file must parse.
 *
 * Fonts come back as they ship, each file with its base64 attached; `bytes` is filled from
 * the file only where the meta does not declare it (the test fixtures), and `checkCatalog`
 * holds every declared size and hash to the file. Effects come back as root-relative paths,
 * because the module re-exports them by import while `loadCatalog` imports them itself.
 *
 * @param {string} root
 */
export async function readCatalog(root) {
  root = resolve(root);

  const fonts = [];
  for (const rel of await find(root, "fonts/meta/*.json")) {
    const meta = await json(resolve(root, rel));
    const files = [];
    for (const file of meta.files ?? []) {
      const path = resolve(root, `fonts/files/${meta.id}.${file.id}.woff2`);
      let bytes;
      try {
        bytes = await readFile(path);
      } catch {
        throw new Error(`${rel} names ${meta.id}.${file.id}, but ${path} is missing`);
      }
      files.push({ ...file, bytes: file.bytes ?? bytes.length, b64: bytes.toString("base64") });
    }
    fonts.push({ ...meta, files });
  }
  fonts.sort(byId);

  const palettes = [];
  for (const rel of await find(root, "data/palettes/*.json"))
    palettes.push(...(await json(resolve(root, rel))));
  palettes.sort(byId);

  const presets = [];
  for (const rel of await find(root, "presets/*.json"))
    presets.push(await json(resolve(root, rel)));
  presets.sort(byId);

  const effects = await find(root, "effects/*.js");

  // Absent means "no rules". A file that is present but broken must fail the build, not
  // silently drop every rule in it.
  const deny = (await optional(resolve(root, "data/deny.json"), { deny: [] })).deny ?? [];
  const weights = await optional(resolve(root, "data/weights.json"), {});

  return { root, fonts, palettes, effects, presets, deny, weights };
}

/**
 * Throws if the catalog is internally broken: a duplicate id, or a font file whose size or
 * hash disagrees with its meta. Never over taste.
 *
 * @param {Awaited<ReturnType<typeof readCatalog>>} cat
 */
export function checkCatalog(cat) {
  assertUnique(cat.fonts, "font");
  assertUnique(cat.palettes, "palette");
  assertUnique(cat.presets, "preset");
  for (const font of cat.fonts) {
    for (const file of font.files) {
      const bytes = Buffer.from(file.b64, "base64");
      const name = `fonts/files/${font.id}.${file.id}.woff2`;
      if (file.bytes !== bytes.length)
        throw new Error(`${name} is ${bytes.length} bytes; its meta says ${file.bytes}`);
      if (file.sha256 !== undefined) {
        const sha = createHash("sha256").update(bytes).digest("hex");
        if (sha !== file.sha256)
          throw new Error(`${name} has sha256 ${sha}; its meta says ${file.sha256}`);
      }
    }
  }
}

/**
 * The `build/catalog.js` source for a module written into `outDir`.
 *
 * @param {Awaited<ReturnType<typeof readCatalog>>} cat
 * @param {string} outDir
 */
export function catalogModule(cat, outDir) {
  const imports = cat.effects.map((rel, i) => {
    const spec = relative(outDir, resolve(cat.root, rel)).split("\\").join("/");
    return { name: `fx${i}`, spec: spec.startsWith(".") ? spec : `./${spec}` };
  });
  return (
    `// Generated by scripts/build.mjs from ${relative(process.cwd(), cat.root) || "."}.\n` +
    "// Do not edit; do not commit. Regenerate with: node scripts/build.mjs\n" +
    `${imports.map((i) => `import ${i.name} from '${i.spec}'`).join("\n")}\n` +
    "export default {\n" +
    ` fonts: ${JSON.stringify(cat.fonts)},\n` +
    ` palettes: ${JSON.stringify(cat.palettes)},\n` +
    ` effects: [${imports.map((i) => i.name).join(", ")}],\n` +
    ` presets: ${JSON.stringify(cat.presets)},\n` +
    ` deny: ${JSON.stringify(cat.deny)},\n` +
    ` weights: ${JSON.stringify(cat.weights)},\n` +
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
  const effects = await Promise.all(
    cat.effects.map(
      async (rel) => (await import(pathToFileURL(resolve(cat.root, rel)).href)).default,
    ),
  );
  const { fonts, palettes, presets, deny, weights } = cat;
  return { fonts, palettes, effects, presets, deny, weights };
}

/**
 * Reads, checks and writes `out` plus its `.d.ts`. The `catalog` plugin in vite.config.js
 * calls this as `build()`.
 *
 * @param {{root?: string, out?: string, quiet?: boolean}} [opts]
 */
export async function writeCatalog(opts = {}) {
  const out = resolve(opts.out ?? "build/catalog.js");
  const cat = await readCatalog(opts.root ?? ".");
  checkCatalog(cat);

  // The type check reads this declaration instead of the module, whose inferred type would
  // be a literal of every row and every base64 font, rebuilt on each check.
  const types = relative(dirname(out), fileURLToPath(new URL("../src/types.js", import.meta.url)));
  const declaration =
    "// Generated by scripts/build.mjs. Do not edit; do not commit.\n" +
    `declare const catalog: import("${types.split("\\").join("/")}").Catalog;\n` +
    "export default catalog;\n";

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, catalogModule(cat, dirname(out)));
  await writeFile(`${out.replace(/\.js$/, "")}.d.ts`, declaration);

  if (!opts.quiet) report(cat, out);
  return { out, ...cat };
}

export { writeCatalog as build };

/** Informational only: counts and the effective size (1/Σp²) per axis. */
function report(c, out) {
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
