/**
 * The catalog build is the validation boundary (`scripts/catalog/check.js`): every data
 * file breaking the contract fails `vp dev/build/preview/test` with `file: /pointer: msg`.
 *
 * Each directory under `test/fixtures/bad/` plants one broken file at the path it would
 * have in a catalog; `plant()` lays it over the good fixture catalog, and the build must
 * reject the result with exactly the message listed in `BAD` below.
 */
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import { catalogModule, checkCatalog, loadCatalog, readCatalog } from "../../scripts/catalog.js";

const fixtures = resolve(import.meta.dirname, "../fixtures");
const good = await readCatalog(resolve(fixtures, "catalog"));

const BAD = {
  "effect-order": "effects/plain.js: /: keys must be in the order id, family, shape, colors,",
  "effect-id": 'effects/plain.js: /id: must equal the file name, got "plane"',
  "effect-family": 'effects/plain.js: /family: must be "plain", the id up to its first -',
  "effect-shape": "effects/plain.js: /shape: must be A or B",
  "effect-trait": 'effects/plain.js: /fonts/deny/0: "bold" is not allowed here',
  "effect-step": "effects/plain.js: /params/d/2: step must be positive",
  "effect-range": "effects/plain.js: /params/d/1: max must be ≥ min",
  "effect-hook": "effects/plain.js: /css: must be a function",
  "effect-hover": "effects/plain.js: /hover: must be a function, a string or null",
  "effect-motion": "effects/plain.js: /motion: must be null until Wave 4",
  "effect-unknown-key": "effects/plain.js: /extra: unknown key",
  // Cultural guards (AGENTS.md): an effect brings no face of its own and no image, data: included.
  "effect-url": "effects/plain.js: /css: at {} emits url(); effects never do",
  "effect-font-family":
    "effects/plain.js: /hover: at {} sets font-family:Mincho; only the engine's f",
  "font-upm": "fonts/meta/fx-sans.json: /upm: must be a positive integer",
  "font-variant-file":
    'fonts/meta/fx-sans.json: /variants/1/file: names no entry of /files: "w900"',
  "font-asc": "fonts/meta/fx-sans.json: /files/0/asc: must be an integer in font units",
  "font-ink": "fonts/meta/fx-sans.json: /variants/0/w1/W: must be a finite number",
  "font-bytes":
    "fonts/meta/fx-sans.json: /files/0/bytes: fonts/files/fx-sans.w700.woff2 is 150 bytes, not 151",
  // Curated facts live in the source row (§5.5); a meta that stores one is not trusted.
  "font-stored-odds": "fonts/meta/fx-sans.json: /odds: unknown key",
  "font-trait": 'fonts/sources/fx-sans.json: /traits/1: "bold" is not allowed here',
  "font-measured":
    "fonts/sources/fx-sans.json: /traits/2: fonts/meta/fx-sans.json did not measure capsOnly",
  "font-sha256": "fonts/sources/fx-sans.json: /sha256: must be the upstream's sha256",
  "palette-hex": 'data/palettes/fx.json: /0/hex/1: "#FFF" is not allowed here',
  "palette-ground": "data/palettes/fx.json: /0/roles/0/o: w points past the end of hex (2)",
  "palette-names": "data/palettes/fx.json: /0/names: must name 2–4 colours, got 5",
  "palette-dark": "data/palettes/fx.json: /0/roles/0/dark: must be true or false",
  "palette-namespace": "data/palettes/fx.json: /0/id: must be kebab-case and start with fx-",
  // `colors` and `ground` are derived at the build (§5.4); a stored count is never trusted.
  "palette-stored-n": "data/palettes/fx.json: /0/roles/0/n: unknown key",
  "deny-bare-variant": "data/deny.json: /deny/0/v: a rule naming v must also name f",
  "deny-bare-role": "data/deny.json: /deny/0/r: a rule naming r must also name p",
  "deny-stale-id": 'data/deny.json: /deny/0/e: "outline-rings" names nothing in the catalog',
  "deny-foreign-variant": 'data/deny.json: /deny/0/v: "n-base-static" names nothing in the catalog',
  "deny-key": "data/deny.json: /deny/0/font: unknown key",
  "weights-axis": "data/weights.json: /font: unknown key",
  "weights-range": "data/weights.json: /e/plain: must be an integer 0–16",
  "weights-stale-role": "data/weights.json: /r/fx-ink.0123: names nothing in the catalog",
  "weights-preset-share": "data/weights.json: /mode/preset: presets may take at most 20% of draws",
  // Not a pointer: the file does not parse, so there is nothing to point into.
  "weights-malformed": "data/weights.json: Expected",
};

/** The good fixture with every file under `bad/<dir>` laid over the one at its path. */
async function plant(dir) {
  const bad = await readCatalog(resolve(fixtures, "bad", dir));
  const over = (list, extra) => [
    ...list.filter((e) => !extra.some((x) => x.file === e.file)),
    ...extra,
  ];
  return {
    ...good,
    fonts: over(good.fonts, bad.fonts),
    sources: over(good.sources, bad.sources),
    palettes: over(good.palettes, bad.palettes),
    presets: over(good.presets, bad.presets),
    effects: over(good.effects, bad.effects),
    deny: bad.deny ?? good.deny,
    weights: bad.weights ?? good.weights,
  };
}

test("the fixture catalog and the live catalog pass", async () => {
  assert.deepEqual(checkCatalog(good), []);
  assert.deepEqual(checkCatalog(await readCatalog(resolve(import.meta.dirname, "../.."))), []);
});

test("every planted bad fixture has an expected message, and every message a fixture", async () => {
  assert.deepEqual((await readdir(resolve(fixtures, "bad"))).sort(), Object.keys(BAD).sort());
});

for (const [dir, message] of Object.entries(BAD)) {
  test(`planted bad fixture ${dir} fails the build`, async () => {
    await expect(plant(dir).then(checkCatalog)).rejects.toThrow(message);
  });
}

test("the build rejects an empty catalog", () => {
  // The engine has no fallbacks (R11): an empty pool, a missing `plain` or a missing `qa-bw`
  // must stop the build, never reach the edge.
  const without = (patch) => () => checkCatalog({ ...good, ...patch });
  assert.throws(without({ fonts: [] }), /^Error: fonts\/meta: \/: no font metas/);
  assert.throws(without({ effects: [] }), /^Error: effects: \/: plain\.js is missing/);
  assert.throws(without({ palettes: [] }), /^Error: data\/palettes: \/: qa-bw is missing/);
  assert.throws(
    without({ effects: good.effects.filter((e) => e.data.id !== "plain") }),
    /^Error: effects: \/: plain\.js is missing/,
  );
  assert.throws(
    without({ palettes: good.palettes.filter((e) => e.file !== "data/palettes/qa.json") }),
    /^Error: data\/palettes: \/: qa-bw is missing/,
  );
});

test("an inexact parameter grid is an error; a float-inexact exact one is not", () => {
  const withParams = (params) =>
    good.effects.map((e) => (e.data.id === "plain" ? { ...e, data: { ...e.data, params } } : e));
  assert.throws(
    () => checkCatalog({ ...good, effects: withParams({ x: [0, 1, 0.3] }) }),
    /^Error: effects\/plain\.js: \/params\/x: \[0,1,0\.3\] is not an exact grid/,
  );
  // (2 - 0.8) / 0.4 is 2.9999999999999996 in floating point: exact at four decimals.
  assert.deepEqual(checkCatalog({ ...good, effects: withParams({ r: [0.8, 2, 0.4] }) }), []);
});

test("hover may be a function, a declaration string or null", () => {
  const withHover = (hover) =>
    good.effects.map((e) => (e.data.id === "plain" ? { ...e, data: { ...e.data, hover } } : e));
  for (const hover of [() => "opacity:.9", "opacity:.9", null]) {
    assert.deepEqual(checkCatalog({ ...good, effects: withHover(hover) }), []);
  }
});

test("defaults a file may leave out are filled in the module", () => {
  const optional = ["family", "odds", "fonts", "palettes", "hover", "motion"];
  const plain = good.effects.find((e) => e.data.id === "plain");
  const bare = Object.fromEntries(
    Object.entries(plain.data).filter(([k]) => !optional.includes(k)),
  );
  const effects = good.effects.map((e) => (e === plain ? { ...e, data: bare } : e));
  const [fx, ...rest] = good.palettes;
  const row = Object.fromEntries(Object.entries(fx.data[0]).filter(([k]) => k !== "odds"));
  const palettes = [{ ...fx, data: [row, ...fx.data.slice(1)] }, ...rest];
  const cat = { ...good, effects, palettes };
  assert.deepEqual(checkCatalog(cat), []);

  const source = catalogModule(cat, resolve(fixtures, "catalog/build"));
  assert.ok(
    source.includes(
      '{...fx1,"family":"plain","odds":4,"fonts":{"deny":[],"prefer":[]},"palettes":{"prefer":[]},"hover":null,"motion":null}',
    ),
  );
  const emitted = JSON.parse(source.match(/^ palettes: (.*),$/m)[1]);
  assert.equal(emitted.find((x) => x.id === row.id).odds, 4);
});

test("the build derives src, tier, colors and ground instead of reading them (§5.4)", async () => {
  const live = await loadCatalog(resolve(import.meta.dirname, "../.."));
  const wada = live.palettes.find((p) => p.id === "wada1-001");
  assert.equal(wada.src, "wada1", "src is the file name");
  assert.equal(wada.tier, "historical", "tier is the adapter's");
  assert.equal(live.palettes.find((p) => p.id === "qa-bw").tier, undefined, "no adapter, no tier");

  const { palettes } = await loadCatalog(resolve(fixtures, "catalog"));
  const roles = Object.fromEntries(
    palettes.flatMap((p) => p.roles.map((r) => [r.o, { colors: r.colors, ground: r.ground }])),
  );
  assert.deepEqual(roles["10--"], { colors: 2, ground: null });
  assert.deepEqual(roles["012-"], { colors: 3, ground: null });
  assert.deepEqual(roles["0123"], { colors: 4, ground: null });
  // A derived ground is a slot like any other: a two-colour palette on washi fills three.
  assert.deepEqual(roles["w01-"], { colors: 3, ground: "w" });
  assert.deepEqual(roles["k10-"], { colors: 3, ground: "k" });
});

test("a font's curated facts come from its source row, its measurements from its meta", () => {
  // Re-bucketing a font is a row edit the catalog picks up without the font pipeline.
  const sources = good.sources.map((e) => ({
    ...e,
    data: { ...e.data, odds: 3, traits: ["sans", "unicase"] },
  }));
  const fonts = good.fonts.map((e) => ({
    ...e,
    data: { ...e.data, measured: ["capsOnly", "overlap"] },
  }));
  const cat = { ...good, sources, fonts };
  assert.deepEqual(checkCatalog(cat), []);
  const source = catalogModule(cat, resolve(fixtures, "catalog/build"));
  const [font] = JSON.parse(source.match(/^ fonts: (.*),$/m)[1]);
  assert.equal(font.family, "FX Sans");
  assert.equal(font.odds, 3);
  // The row named the case label, so its word wins over the measured one.
  assert.deepEqual(font.traits, ["overlap", "sans", "unicase"]);
  assert.equal(font.upm, 1000);
});
