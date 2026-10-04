/**
 * The shared effect helpers (§5.6), checked against hand-computed values, and against the
 * effect code they replace: the E rows adopt them only if the bytes stay the same.
 */
import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import {
  BLURS,
  CAP,
  CHAIN,
  clipFill,
  copy,
  fall,
  helpers,
  layers,
  march,
  MAX_BLUR,
  OUTSET,
  QUAD,
  ramp,
  REACH,
  stack,
  toward,
} from "../src/helpers.js";
import { fit } from "../src/fit.js";
import { pick, resolve } from "../src/pick.js";
import { stylesheet } from "../src/render.js";
import { fixtureCatalog } from "./catalog.js";
import { effects, grid, METRICS } from "./effects-lint.js";

test("h is frozen and carries exactly the §5.6 constants and helpers", () => {
  assert.ok(Object.isFrozen(helpers));
  assert.deepEqual(Object.keys(helpers).sort(), [
    "BLURS",
    "CAP",
    "CHAIN",
    "MAX_BLUR",
    "OUTSET",
    "QUAD",
    "REACH",
    "clipFill",
    "copy",
    "fall",
    "layers",
    "march",
    "mix",
    "ramp",
    "ring",
    "stack",
    "toward",
    "u",
  ]);
  assert.deepEqual(
    { REACH, OUTSET, CAP, BLURS, CHAIN, MAX_BLUR },
    { REACH: 1.1, OUTSET: 1, CAP: 64, BLURS: 4, CHAIN: 4, MAX_BLUR: 2.5 },
  );
});

test("layers rounds, floors at min and caps at CAP", () => {
  assert.equal(layers(36), 36);
  assert.equal(layers(12.5), 13);
  assert.equal(layers(3.4, 12), 12);
  assert.equal(layers(100, 12), 64);
  assert.equal(layers(0), 1);
});

test("toward reserves the full distance on each side the angle points at", () => {
  assert.deepEqual(toward(90, 3), { t: 0, r: 0, b: 3, l: 0 });
  assert.deepEqual(toward(0, 4), { t: 0, r: 4, b: 0, l: 0 });
  assert.deepEqual(toward(180, 4), { t: 0, r: 0, b: 0, l: 4 });
  assert.deepEqual(toward(270, 4), { t: 4, r: 0, b: 0, l: 0 });
  assert.deepEqual(toward(45, 2), { t: 0, r: 2, b: 2, l: 0 });
  assert.deepEqual(toward(135, 2), { t: 0, r: 0, b: 2, l: 2 });
  assert.deepEqual(toward(225, 1), { t: 1, r: 0, b: 0, l: 1 });
  assert.deepEqual(toward(315, 1), { t: 1, r: 1, b: 0, l: 0 });
});

test("QUAD is the four diagonals clockwise from down-right, and frozen", () => {
  assert.deepEqual(QUAD, [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ]);
  assert.ok(Object.isFrozen(QUAD) && QUAD.every((q) => Object.isFrozen(q)));
});

test("fall gives the horizontal sign of the two falling diagonals", () => {
  assert.equal(fall(45), 1);
  assert.equal(fall(135), -1);
});

test("march steps n layers from `from` (exclusive) to `to` (inclusive) per axis", () => {
  assert.equal(
    march(2, 1, 1, 0, 3, (i) => (i === 1 ? "var(--a1)" : "var(--a2)")),
    "calc(1.5*var(--u)) calc(1.5*var(--u)) 0 var(--a1),calc(3*var(--u)) calc(3*var(--u)) 0 var(--a2)",
  );
  assert.equal(
    march(2, -1, 1, 1, 2, () => "var(--a1)"),
    "calc(-1.5*var(--u)) calc(1.5*var(--u)) 0 var(--a1),calc(-2*var(--u)) calc(2*var(--u)) 0 var(--a1)",
  );
});

test("ramp is stack with a colour per layer", () => {
  assert.equal(
    ramp(2, 45, 4, (t) => (t === 1 ? "var(--a2)" : "var(--a1)")),
    "calc(2*cos(45deg)*var(--u)) calc(2*sin(45deg)*var(--u)) 0 var(--a1)," +
      "calc(4*cos(45deg)*var(--u)) calc(4*sin(45deg)*var(--u)) 0 var(--a2)",
  );
  // With one colour it is exactly stack(): same distances, same rounding.
  for (const [n, a, d] of [
    [5, 30, 3],
    [64, 135, 20],
    [36, 45, 4.5],
  ]) {
    assert.equal(
      ramp(n, a, d, () => "var(--a1)"),
      stack(n, a, d, "var(--a1)"),
    );
  }
});

test("copy writes the one shape-B copy form", () => {
  assert.equal(
    copy("before", "color:var(--bg);z-index:-1"),
    '.l::before{content:attr(data-t) / "";color:var(--bg);z-index:-1}',
  );
  assert.equal(copy("after", "opacity:.5"), '.l::after{content:attr(data-t) / "";opacity:.5}');
});

test("clipFill clips one block-sized image to the letters of each line", () => {
  assert.equal(
    clipFill("linear-gradient(180deg,var(--a1) 0%,var(--fg) 100%)"),
    ".l{background-image:linear-gradient(180deg,var(--a1) 0%,var(--fg) 100%);" +
      "background-size:100% calc(var(--bh)*var(--u));" +
      "background-position:0 calc(-1*var(--y)*var(--u));background-repeat:no-repeat;" +
      "-webkit-background-clip:text;background-clip:text;" +
      "-webkit-text-fill-color:transparent;color:transparent}",
  );
});

// The E rows replace copied code with these helpers and must keep every grid hash. These
// pin the two replacements that are pure renames, over every point of the effect's grid.
const byId = Object.fromEntries(effects.map((e) => [e.id, e.fx]));

test("toward is the dir() the depth effects and the falling retro effects copy", () => {
  for (const [id, a, d] of [
    ["depth-long", "a", "d"],
    ["depth-ramp", "a", "d"],
    ["retro-split-shade", "a", "d"],
  ]) {
    const fx = byId[id];
    for (const p of grid(fx.params)) {
      assert.deepEqual(fx.bleed(p), toward(p[a], p[d]), `${id} ${JSON.stringify(p)}`);
    }
  }
});

test("clipFill is the clipped fill glow-chrome and glow-foil end with", () => {
  for (const id of ["glow-chrome", "glow-foil"]) {
    const fx = byId[id];
    for (const p of grid(fx.params)) {
      const css = fx.css(p, helpers, METRICS);
      const image = css.match(/\.l\{background-image:(.*?);background-size:/)?.[1] ?? "";
      assert.ok(css.endsWith(clipFill(image)), `${id} ${JSON.stringify(p)}`);
    }
  }
});

test("a string hover renders exactly like a function returning it", async () => {
  const catalog = await fixtureCatalog();
  const scene = resolve(catalog, pick(catalog, "gs"));
  const decls = "filter:brightness(1.05)";
  const as = (hover) => {
    const s = { ...scene, effect: { ...scene.effect, hover } };
    return stylesheet(s, fit(s));
  };
  assert.equal(
    as(decls),
    as(() => decls),
  );
  assert.ok(as(decls).includes(`a.n:hover{${decls}}`));
});
