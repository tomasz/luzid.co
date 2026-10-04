/**
 * Validates every data file the catalog build reads (contracts §5.3–§5.6), so the engine can
 * trust the catalog's shape instead of guarding it.
 *
 * One function per file kind, each a list of plain `if (…) throw at(file, pointer, msg)`,
 * and every failure reads `<file>: /<json pointer>: <message>`. No schema library: the
 * rules are few, the messages are what a curator reads, and an `if` says exactly one thing.
 *
 * The cheap structural and cross-file checks live here and run inside every
 * `vp dev/build/preview/test`; the heavy binary ones (woff2 decode, HarfBuzz) stay in
 * `test/fonts.test.js`.
 */
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { LAYOUTS } from "../../src/layout.js";
import { BUCKET_ODDS } from "../../src/pick.js";

/** §5.5: closed enum. Adding one is a `contract` PR. */
export const TRAITS = new Set([
  "serif",
  "sans",
  "slab",
  "script",
  "brush",
  "blackletter",
  "deco",
  "rounded",
  "unicase",
  "mono",
  "fat",
  "hairline",
  "condensed",
  "wide",
  "inline",
  "shaded",
  "stencil",
  "soft",
  "groovy",
  "connected",
  "capsOnly",
  "overlap",
  "jp",
]);

export const ARCHETYPES = new Set(Object.keys(BUCKET_ODDS));
export const LICENSE_IDS = new Set(["OFL-1.1", "Apache-2.0", "GUST"]);
export const CASES = new Set(["none", "uppercase", "lowercase"]);

/** §5.6, in the order every effect file states them. */
export const EFFECT_KEYS = [
  "id",
  "family",
  "shape",
  "colors",
  "bg",
  "odds",
  "fonts",
  "palettes",
  "params",
  "bleed",
  "css",
  "hover",
  "motion",
];

/**
 * What the engine reads for each effect key the contract lets a file leave out. Filled at
 * the build, so `src/` never has to guess.
 */
export const effectDefaults = () => ({
  odds: 4,
  fonts: { deny: [], prefer: [] },
  palettes: { prefer: [] },
  hover: null,
});

/** The §5.4 palette default; role sets and variants carry no `odds` at all. */
export const PALETTE_ODDS = 4;

const DENY_KEYS = ["f", "v", "p", "r", "e", "l"];
const WEIGHT_KEYS = ["bucket", "f", "p", "e", "l", "v", "r", "mode", "preset"];
const PRESET_SHARE = 0.2;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HEX = /^#[0-9a-f]{6}$/;
const SHA256 = /^[0-9a-f]{64}$/;
// bg may sit on a derived ground (R4); fg is always one of the row's own colours; a1 and a2
// may alias with `-`.
const ORDER = /^[0-9wk][0-9][0-9-][0-9-]$/;

/** @param {string} file @param {string} pointer @param {string} msg */
const at = (file, pointer, msg) => new Error(`${file}: ${pointer || "/"}: ${msg}`);

const isObject = (x) => typeof x === "object" && x !== null && !Array.isArray(x);
const isOdds = (x) => Number.isInteger(x) && x >= 0 && x <= 16;
const show = (x) => JSON.stringify(x) ?? String(x);
const stem = (file) => basename(file).replace(/\.(json|js)$/, "");

function keys(file, ptr, obj, allowed, required = allowed) {
  if (!isObject(obj)) throw at(file, ptr, `must be an object, got ${show(obj)}`);
  for (const k of Object.keys(obj))
    if (!allowed.includes(k)) throw at(file, `${ptr}/${k}`, "unknown key");
  for (const k of required) if (!(k in obj)) throw at(file, `${ptr}/${k}`, "is required");
}

function strings(file, ptr, list, ok = (s) => typeof s === "string" && s.length > 0) {
  if (!Array.isArray(list)) throw at(file, ptr, `must be an array, got ${show(list)}`);
  list.forEach((s, i) => {
    if (!ok(s)) throw at(file, `${ptr}/${i}`, `${show(s)} is not allowed here`);
  });
}

function finite(file, ptr, obj, names) {
  keys(file, ptr, obj, names);
  for (const k of names)
    if (!Number.isFinite(obj[k])) throw at(file, `${ptr}/${k}`, `must be a finite number`);
}

/**
 * `effects/<id>.js`. Returns the warnings that are not yet errors.
 *
 * @param {string} file
 * @param {any} fx
 */
export function checkEffect(file, fx) {
  const required = ["id", "family", "shape", "colors", "bg", "params", "bleed", "css", "motion"];
  keys(file, "", fx, EFFECT_KEYS, required);
  const order = Object.keys(fx);
  const canonical = EFFECT_KEYS.filter((k) => k in fx);
  if (order.join() !== canonical.join())
    throw at(file, "", `keys must be in the order ${canonical.join(", ")}`);

  if (fx.id !== stem(file)) throw at(file, "/id", `must equal the file name, got ${show(fx.id)}`);
  if (!KEBAB.test(fx.family)) throw at(file, "/family", "must be kebab-case");
  if (fx.id !== fx.family && !fx.id.startsWith(`${fx.family}-`))
    throw at(file, "/id", "must be <family> or <family>-<slug>");
  if (!["A", "B"].includes(fx.shape)) throw at(file, "/shape", "must be A or B");
  if (![2, 3, 4].includes(fx.colors)) throw at(file, "/colors", "must be 2, 3 or 4");
  if (!["any", "dark", "light"].includes(fx.bg))
    throw at(file, "/bg", "must be any, dark or light");
  if ("odds" in fx && !isOdds(fx.odds)) throw at(file, "/odds", "must be an integer 0–16");

  if ("fonts" in fx) {
    keys(file, "/fonts", fx.fonts, ["deny", "prefer"]);
    for (const k of ["deny", "prefer"])
      strings(file, `/fonts/${k}`, fx.fonts[k], (t) => TRAITS.has(t));
  }
  if ("palettes" in fx) {
    keys(file, "/palettes", fx.palettes, ["prefer"]);
    strings(file, "/palettes/prefer", fx.palettes.prefer, (t) => KEBAB.test(t));
  }

  const warnings = [];
  if (!isObject(fx.params)) throw at(file, "/params", "must be an object");
  for (const [name, spec] of Object.entries(fx.params)) {
    const ptr = `/params/${name}`;
    if (!Array.isArray(spec) || spec.length !== 3 || !spec.every(Number.isFinite))
      throw at(file, ptr, "must be [min, max, step] of finite numbers");
    const [min, max, step] = spec;
    if (!(step > 0)) throw at(file, `${ptr}/2`, "step must be positive");
    if (!(max >= min)) throw at(file, `${ptr}/1`, "max must be ≥ min");
    // §5.3: an exact grid, so `max` is a grid point and `step()` can draw it.
    const n = (max - min) / step;
    if (Math.abs(n - Math.round(n)) >= 1e-9)
      throw at(
        file,
        ptr,
        `[${spec.join(",")}] is not an exact grid; (max - min) / step must be an integer`,
      );
  }

  for (const k of ["bleed", "css"])
    if (typeof fx[k] !== "function") throw at(file, `/${k}`, "must be a function");
  if (
    "hover" in fx &&
    fx.hover !== null &&
    typeof fx.hover !== "function" &&
    typeof fx.hover !== "string"
  )
    throw at(file, "/hover", "must be a function, a string or null");
  if (fx.motion !== null) throw at(file, "/motion", "must be null until Wave 4");
  return warnings;
}

/**
 * `fonts/meta/<id>.json`. The woff2 files themselves are held to it in `checkCatalog`.
 *
 * @param {string} file
 * @param {any} meta
 */
export function checkFontMeta(file, meta) {
  const all = [
    "id",
    "family",
    "src",
    "licenseId",
    "copyright",
    "rfn",
    "archetype",
    "traits",
    "odds",
    "upm",
    "files",
    "variants",
  ];
  // `rfn` is required by §5.5 but optional until D1 regenerates the metas that predate it.
  keys(
    file,
    "",
    meta,
    all,
    all.filter((k) => k !== "rfn"),
  );
  if (meta.id !== stem(file))
    throw at(file, "/id", `must equal the file name, got ${show(meta.id)}`);
  for (const k of ["family", "copyright"])
    if (typeof meta[k] !== "string" || !meta[k])
      throw at(file, `/${k}`, "must be a non-empty string");
  keys(file, "/src", meta.src, ["url", "sha256"]);
  if (typeof meta.src.url !== "string") throw at(file, "/src/url", "must be a string");
  if (typeof meta.src.sha256 !== "string") throw at(file, "/src/sha256", "must be a string");
  if (!LICENSE_IDS.has(meta.licenseId))
    throw at(file, "/licenseId", `must be one of ${[...LICENSE_IDS].join(", ")}`);
  if ("rfn" in meta) strings(file, "/rfn", meta.rfn);
  strings(file, "/archetype", meta.archetype, (a) => ARCHETYPES.has(a));
  if (meta.archetype.length === 0) throw at(file, "/archetype", "must name at least one bucket");
  strings(file, "/traits", meta.traits, (t) => TRAITS.has(t));
  if (!isOdds(meta.odds)) throw at(file, "/odds", "must be an integer 0–16");
  if (!Number.isInteger(meta.upm) || meta.upm <= 0)
    throw at(file, "/upm", "must be a positive integer");

  if (!Array.isArray(meta.files) || meta.files.length === 0)
    throw at(file, "/files", "must be a non-empty array");
  const fileIds = new Set();
  meta.files.forEach((f, i) => {
    const ptr = `/files/${i}`;
    const fields = ["id", "axes", "bytes", "sha256", "asc", "desc", "stem", "crossbar", "glyphs"];
    keys(file, ptr, f, fields);
    if (!KEBAB.test(f.id)) throw at(file, `${ptr}/id`, "must be kebab-case");
    if (fileIds.has(f.id)) throw at(file, `${ptr}/id`, `duplicate file id ${f.id}`);
    fileIds.add(f.id);
    if (!isObject(f.axes) || !Object.values(f.axes).every(Number.isFinite))
      throw at(file, `${ptr}/axes`, "must map each axis tag to a number");
    if (!Number.isInteger(f.bytes) || f.bytes <= 0)
      throw at(file, `${ptr}/bytes`, "must be a positive integer");
    if (!SHA256.test(f.sha256)) throw at(file, `${ptr}/sha256`, "must be 64 lowercase hex digits");
    for (const k of ["asc", "desc", "glyphs"])
      if (!Number.isInteger(f[k]))
        throw at(file, `${ptr}/${k}`, "must be an integer in font units");
    for (const k of ["stem", "crossbar"])
      if (!Number.isFinite(f[k])) throw at(file, `${ptr}/${k}`, "must be a finite number");
  });

  if (!Array.isArray(meta.variants) || meta.variants.length === 0)
    throw at(file, "/variants", "must be a non-empty array");
  const variantIds = new Set();
  meta.variants.forEach((v, i) => {
    const ptr = `/variants/${i}`;
    keys(file, ptr, v, ["id", "file", "case", "css", "w1", "w2"]);
    if (typeof v.id !== "string" || !v.id)
      throw at(file, `${ptr}/id`, "must be a non-empty string");
    if (variantIds.has(v.id)) throw at(file, `${ptr}/id`, `duplicate variant id ${v.id}`);
    variantIds.add(v.id);
    if (!fileIds.has(v.file))
      throw at(file, `${ptr}/file`, `names no entry of /files: ${show(v.file)}`);
    if (!CASES.has(v.case))
      throw at(file, `${ptr}/case`, `must be one of ${[...CASES].join(", ")}`);
    keys(file, `${ptr}/css`, v.css, ["weight", "style", "feat"]);
    if (!Number.isFinite(v.css.weight)) throw at(file, `${ptr}/css/weight`, "must be a number");
    for (const k of ["style", "feat"])
      if (typeof v.css[k] !== "string") throw at(file, `${ptr}/css/${k}`, "must be a string");
    for (const w of ["w1", "w2"]) finite(file, `${ptr}/${w}`, v[w], ["W", "H", "X", "top"]);
  });
}

/**
 * `data/palettes/<source>.json`: an array of rows. A row stores only what cannot be
 * derived; `src`, `tier`, each role set's `colors` and `ground` are filled by the build
 * (§5.4), so a file that stores them is rejected rather than trusted.
 *
 * @param {string} file
 * @param {any} rows
 */
export function checkPalette(file, rows) {
  if (!Array.isArray(rows)) throw at(file, "", "must be an array of palette rows");
  const all = ["id", "odds", "names", "namesJa", "hex", "roles"];
  rows.forEach((row, i) => {
    const ptr = `/${i}`;
    keys(
      file,
      ptr,
      row,
      all,
      all.filter((k) => k !== "odds" && k !== "namesJa"),
    );
    // Namespaced by the file it lives in, which is the source (§5.4: `wada1-176`).
    if (typeof row.id !== "string" || !row.id.startsWith(`${stem(file)}-`) || !KEBAB.test(row.id))
      throw at(file, `${ptr}/id`, `must be kebab-case and start with ${stem(file)}-`);
    if ("odds" in row && !isOdds(row.odds))
      throw at(file, `${ptr}/odds`, "must be an integer 0–16");
    strings(file, `${ptr}/names`, row.names);
    const n = row.names.length;
    if (n < 2 || n > 4) throw at(file, `${ptr}/names`, `must name 2–4 colours, got ${n}`);
    if ("namesJa" in row) {
      strings(file, `${ptr}/namesJa`, row.namesJa);
      if (row.namesJa.length !== n) throw at(file, `${ptr}/namesJa`, "must match names in length");
    }
    strings(file, `${ptr}/hex`, row.hex, (h) => HEX.test(h));
    // R4: up to two derived grounds follow the row's own colours, washi then sumi.
    if (row.hex.length < n || row.hex.length > n + 2)
      throw at(file, `${ptr}/hex`, `must hold the ${n} named colours plus at most 2 grounds`);
    const slot = { w: n, k: n + 1 };

    if (!Array.isArray(row.roles) || row.roles.length === 0)
      throw at(file, `${ptr}/roles`, "must be a non-empty array");
    const orders = new Set();
    row.roles.forEach((role, j) => {
      const rp = `${ptr}/roles/${j}`;
      keys(file, rp, role, ["o", "dark"]);
      if (typeof role.o !== "string" || !ORDER.test(role.o))
        throw at(file, `${rp}/o`, `${show(role.o)} is not a role order like 10-- or w012`);
      if (orders.has(role.o)) throw at(file, `${rp}/o`, `duplicate role order ${role.o}`);
      orders.add(role.o);
      for (const c of role.o) {
        const index = c === "-" ? -1 : (slot[c] ?? Number(c));
        if (index >= row.hex.length)
          throw at(file, `${rp}/o`, `${c} points past the end of hex (${row.hex.length})`);
      }
      if (typeof role.dark !== "boolean") throw at(file, `${rp}/dark`, "must be true or false");
    });
  });
}

/**
 * `data/deny.json`, against the catalog it names.
 *
 * @param {string} file
 * @param {any} data
 * @param {Index} ids
 */
export function checkDeny(file, data, ids) {
  keys(file, "", data, ["deny"]);
  if (!Array.isArray(data.deny)) throw at(file, "/deny", "must be an array of rules");
  data.deny.forEach((rule, i) => {
    const ptr = `/deny/${i}`;
    keys(file, ptr, rule, DENY_KEYS, []);
    if (Object.keys(rule).length === 0) throw at(file, ptr, "an empty rule would deny everything");
    // A bare variant or role-set id would match that id in every font or palette at once.
    if ("v" in rule && !("f" in rule))
      throw at(file, `${ptr}/v`, "a rule naming v must also name f");
    if ("r" in rule && !("p" in rule))
      throw at(file, `${ptr}/r`, "a rule naming r must also name p");
    for (const [k, id] of Object.entries(rule)) {
      const owner = k === "v" ? rule.f : k === "r" ? rule.p : null;
      if (!ids.has(k, id, owner))
        throw at(file, `${ptr}/${k}`, `${show(id)} names nothing in the catalog`);
    }
  });
}

/**
 * `data/weights.json`, against the catalog it names.
 *
 * @param {string} file
 * @param {any} data
 * @param {Index} ids
 */
export function checkWeights(file, data, ids) {
  keys(file, "", data, WEIGHT_KEYS, []);
  for (const [axis, table] of Object.entries(data)) {
    if (!isObject(table)) throw at(file, `/${axis}`, "must be an object of id: odds");
    for (const [key, odds] of Object.entries(table)) {
      const ptr = `/${axis}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      if (!isOdds(odds)) throw at(file, ptr, "must be an integer 0–16");
      // `v` and `r` keys are qualified by their owner: `<font>.<variant>`, `<palette>.<o>`.
      const dot = key.indexOf(".");
      const qualified = axis === "v" || axis === "r";
      if (qualified && dot < 0) throw at(file, ptr, `must be <owner>.<id>`);
      const [owner, id] = qualified ? [key.slice(0, dot), key.slice(dot + 1)] : [null, key];
      if (!ids.has(axis, id, owner)) throw at(file, ptr, "names nothing in the catalog");
    }
  }
  if ("mode" in data) {
    const free = data.mode.free ?? 8;
    const preset = data.mode.preset ?? 2;
    if (free + preset > 0 && preset / (free + preset) > PRESET_SHARE)
      throw at(
        file,
        "/mode/preset",
        `presets may take at most 20% of draws, got ${preset}/${free + preset}`,
      );
  }
}

/**
 * @typedef {{has: (axis: string, id: string, owner: string | null) => boolean}} Index
 * @typedef {{file: string, data: any}} Entry
 * @typedef {{fonts: Entry[], palettes: Entry[], presets: Entry[], effects: Entry[],
 *   deny: Entry | null, weights: Entry | null, woff2: Map<string, Buffer>}} Files
 */

/** @param {Entry[]} entries @param {string} kind */
function unique(entries, kind, idOf = (e) => [e.data.id]) {
  const seen = new Map();
  for (const e of entries) {
    for (const id of idOf(e)) {
      if (seen.has(id)) throw at(e.file, "", `duplicate ${kind} id ${id}, also in ${seen.get(id)}`);
      seen.set(id, e.file);
    }
  }
}

/**
 * Every check, in the order the files depend on each other. Throws on the first broken
 * file; returns the warnings that are not errors yet.
 *
 * @param {Files} cat
 * @returns {string[]}
 */
export function checkCatalog(cat) {
  const warnings = [];
  for (const { file, data } of cat.effects) warnings.push(...checkEffect(file, data));
  for (const { file, data } of cat.fonts) checkFontMeta(file, data);
  for (const { file, data } of cat.palettes) checkPalette(file, data);
  for (const { file, data } of cat.presets) {
    if (!isObject(data) || data.id !== stem(file))
      throw at(file, "/id", `must equal the file name, got ${show(data?.id)}`);
    if (!isOdds(data.odds)) throw at(file, "/odds", "must be an integer 0–16");
  }

  unique(cat.effects, "effect");
  unique(cat.fonts, "font");
  unique(cat.presets, "preset");
  unique(cat.palettes, "palette", (e) => e.data.map((row) => row.id));

  // R11 retires the engine's empty-catalog fallbacks once these hold.
  if (cat.fonts.length === 0) throw at("fonts/meta", "", "no font metas; the font pool is empty");
  if (!cat.effects.some((e) => e.data.id === "plain"))
    throw at("effects", "", "plain.js is missing; it is the universal fallback");
  if (!cat.palettes.some((e) => e.data.some((row) => row.id === "qa-bw")))
    throw at("data/palettes", "", "qa-bw is missing; QA mask mode pins it");

  for (const { file, data: meta } of cat.fonts) {
    meta.files.forEach((f, i) => {
      const name = `fonts/files/${meta.id}.${f.id}.woff2`;
      const bytes = cat.woff2.get(name);
      if (!bytes) throw at(file, `/files/${i}`, `${name} is missing`);
      if (bytes.length !== f.bytes)
        throw at(file, `/files/${i}/bytes`, `${name} is ${bytes.length} bytes, not ${f.bytes}`);
      const sha = createHash("sha256").update(bytes).digest("hex");
      if (sha !== f.sha256) throw at(file, `/files/${i}/sha256`, `${name} has sha256 ${sha}`);
    });
  }

  const ids = index(cat);
  if (cat.deny) checkDeny(cat.deny.file, cat.deny.data, ids);
  if (cat.weights) checkWeights(cat.weights.file, cat.weights.data, ids);
  return warnings;
}

/**
 * What a deny rule or a weights key may name, per axis. `v` and `r` resolve inside their
 * owner, because their ids repeat across fonts and palettes (§5.3).
 *
 * @param {Files} cat
 * @returns {Index}
 */
function index(cat) {
  const fonts = new Map(cat.fonts.map((e) => [e.data.id, e.data]));
  const palettes = new Map(cat.palettes.flatMap((e) => e.data.map((row) => [row.id, row])));
  const flat = {
    f: new Set(fonts.keys()),
    p: new Set(palettes.keys()),
    e: new Set(cat.effects.map((e) => e.data.id)),
    l: new Set(LAYOUTS.map((l) => l.id)),
    preset: new Set(cat.presets.map((e) => e.data.id)),
    bucket: ARCHETYPES,
    mode: new Set(["free", "preset"]),
  };
  return {
    has(axis, id, owner) {
      if (axis === "v") return !!fonts.get(owner)?.variants.some((v) => v.id === id);
      if (axis === "r") return !!palettes.get(owner)?.roles.some((r) => r.o === id);
      return flat[axis].has(id);
    },
  };
}
