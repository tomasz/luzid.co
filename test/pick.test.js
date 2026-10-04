import assert from "node:assert/strict";
import { expect, test } from "vite-plus/test";
import { parsePickString, pickString } from "../src/look.js";
import { BUCKET_ODDS, denied, PickError, pick, resolve } from "../src/pick.js";
import { fixtureCatalog } from "./catalog.js";

const catalog = await fixtureCatalog();
const str = (seed, pins = {}) => pickString(pick(catalog, seed, pins));

test("pick golden vectors", () => {
  // The frozen mini-catalog plus these seeds pin the whole sampler: the axis order, the
  // odds, the deny handling and the canonical string format. A diff here means the look of
  // every seed on the live site moved. Refresh with `vp test -u`.
  expect(str("gs")).toMatchInlineSnapshot(
    `"f:fx-sans.up p:fx-ground.k10- e:depth-extrude(a=225,d=5) l:stack-fit(g=6,a=center)"`,
  );
  expect(str("gt")).toMatchInlineSnapshot(
    `"f:fx-sans.as p:fx-ground.w01- e:depth-extrude(a=135,d=4) l:stack-fit(g=6,a=flex-start)"`,
  );
  expect(str("gp")).toMatchInlineSnapshot(
    `"f:fx-sans.lo p:fx-dusk.012- e:plain l:stack-eq(g=4,a=flex-end,side)"`,
  );
  expect(str("gn")).toMatchInlineSnapshot(
    `"f:fx-sans.as p:fx-ink.01-- e:plain l:stack-fit(g=10,a=flex-start,side)"`,
  );
  expect(str("k3f9x2m7qa")).toMatchInlineSnapshot(
    `"f:fx-sans.as p:fx-ink.10-- e:plain l:stack-fit(g=8,a=flex-end)"`,
  );
  expect(str("a")).toMatchInlineSnapshot(
    `"f:fx-sans.up p:fx-ground.k10- e:plain l:stack-fit(g=6,a=center)"`,
  );
});

test("the same seed always gives the same pick", () => {
  for (const s of ["a", "gs", "k3f9x2m7qa"]) {
    assert.deepEqual(pick(catalog, s), pick(catalog, s));
  }
});

test("every pin is honoured exactly", () => {
  const p = pick(catalog, "gs", {
    f: "fx-sans",
    v: "lo",
    p: "fx-dusk",
    r: "0123",
    e: "plain",
    l: "stack-eq",
  });
  assert.equal(p.f, "fx-sans");
  assert.equal(p.v, "lo");
  assert.equal(p.p, "fx-dusk");
  assert.equal(p.r, "0123");
  assert.equal(p.e, "plain");
  assert.equal(p.l, "stack-eq");
  assert.deepEqual(p.pinned, ["f", "v", "p", "r", "e", "l"]);
});

test("a pin fixes its axis while the rest still follow the seed", () => {
  const free = new Set();
  const pinnedLayout = new Set();
  for (let i = 0; i < 200; i++) {
    free.add(pick(catalog, `s${i}`).l);
    const p = pick(catalog, `s${i}`, { l: "stack-eq" });
    pinnedLayout.add(p.l);
    // Pinning the layout must not move the earlier axes.
    assert.equal(p.f, pick(catalog, `s${i}`).f);
    assert.equal(p.e, pick(catalog, `s${i}`).e);
  }
  assert.equal(free.size, 2, "both layouts should occur across 200 seeds");
  assert.deepEqual([...pinnedLayout], ["stack-eq"]);
});

test("an unknown id is rejected, on every axis", () => {
  for (const [axis, value] of Object.entries({
    f: "no-such-font",
    v: "no-such-variant",
    p: "no-such-palette",
    r: "zzzz",
    e: "no-such-effect",
    l: "no-such-layout",
  })) {
    assert.throws(
      () => pick(catalog, "a", { [axis]: value }),
      (err) => err instanceof PickError && err.kind === "unknown" && err.axis === axis,
      `${axis}=${value} should be an unknown-id error`,
    );
  }
});

test("two pins that nothing satisfies are rejected", () => {
  // `w01-` is a role set of fx-ground only.
  assert.throws(
    () => pick(catalog, "a", { p: "fx-ink", r: "w01-" }),
    (err) => err instanceof PickError && err.kind === "incompatible" && err.axis === "r",
  );
  // Both variant ids exist, but no single font carries both.
  const [as, lo] = catalog.fonts[0].variants;
  const split = {
    ...catalog,
    fonts: [
      { ...catalog.fonts[0], id: "one", variants: [as] },
      { ...catalog.fonts[0], id: "two", variants: [lo] },
    ],
  };
  assert.throws(
    () => pick(split, "a", { f: "one", v: "lo" }),
    (err) => err instanceof PickError && err.kind === "incompatible" && err.axis === "v",
  );
});

test("a pin resolves a retired (odds 0) item — QA mask mode", () => {
  const live = {
    ...catalog,
    palettes: [
      ...catalog.palettes,
      {
        id: "qa-bw",
        src: "qa",
        tier: "editorial",
        odds: 0,
        names: ["Black", "White"],
        hex: ["#000000", "#ffffff"],
        roles: [{ o: "10--", dark: false, n: 2, derivedBg: null }],
      },
    ],
  };
  const p = pick(live, "a", { p: "qa-bw", e: "plain" });
  assert.equal(p.p, "qa-bw");
  assert.equal(p.e, "plain");

  // …and is never drawn without the pin.
  for (let i = 0; i < 2000; i++) assert.notEqual(pick(live, `s${i}`).p, "qa-bw");
});

test("a deny rule that would empty an axis is relaxed rather than deadlocking", () => {
  // Every effect denied against this font: the sampler still has to return something.
  const all = catalog.effects.map((e) => ({ f: "fx-sans", e: e.id }));
  const p = pick({ ...catalog, deny: all }, "a");
  assert.ok(p.e);
});

test("an effect never lands on a font whose traits it denies", () => {
  const scripty = {
    ...catalog,
    fonts: [{ ...catalog.fonts[0], traits: ["script"] }],
  };
  for (let i = 0; i < 500; i++) assert.equal(pick(scripty, `s${i}`).e, "plain");
});

test("weights override the item odds", () => {
  const only = { ...catalog, weights: { l: { "stack-eq": 0, "stack-fit": 4 } } };
  for (let i = 0; i < 500; i++) assert.equal(pick(only, `s${i}`).l, "stack-fit");

  const flipped = { ...catalog, weights: { l: { "stack-eq": 16, "stack-fit": 0 } } };
  for (let i = 0; i < 500; i++) assert.equal(pick(flipped, `s${i}`).l, "stack-eq");
});

test("D4: 90% of visits draw from the six taste archetypes", () => {
  // Against the default odds: the fixture's own weights.json boosts X on purpose, which is
  // what the weights test below relies on.
  const plainOdds = { ...catalog, weights: {} };
  let af = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) if ("ABCDEF".includes(pick(plainOdds, `s${i}`).bucket)) af++;
  const share = af / n;
  const want = 18 / 20;
  assert.ok(share >= 0.85, `A–F share ${share}`);
  assert.ok(Math.abs(share - want) < 0.02, `A–F share ${share}, expected ~${want}`);
  assert.equal(
    Object.values(BUCKET_ODDS).reduce((a, b) => a + b),
    20,
  );
});

test("D8: about a quarter of seeds add the rotated portrait variant", () => {
  let side = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) if (pick(catalog, `s${i}`).side) side++;
  assert.ok(Math.abs(side / n - 0.25) < 0.01, `side share ${side / n}`);
});

test("a broken catalog is a plain Error, never a PickError", () => {
  // The build rejects an empty catalog (test/data/catalog.test.js). If one reached the edge
  // anyway, the deploy is wrong, not the request: a 500, not a 400.
  const bare = { ...catalog, fonts: [] };
  assert.throws(
    () => pick(bare, "a"),
    (err) => !(err instanceof PickError) && /empty pool on axis f/.test(err.message),
  );
  const look = pick(catalog, "gs");
  assert.throws(
    () => resolve({ ...catalog, effects: [] }, look),
    (err) => !(err instanceof PickError) && /does not resolve/.test(err.message),
  );
});

test("the canonical string round-trips through the deny matcher", () => {
  const p = pick(catalog, "gs");
  assert.equal(denied([{ f: p.f, e: p.e }], p), true);
  assert.equal(denied([{ f: p.f, e: "nope" }], p), false);
  assert.equal(denied([{}], p), false, "an empty rule must never match everything");
  assert.match(pickString(p), /^f:[\w.-]+ p:[\w.-]+ e:\S+ l:\S+$/);
});

test("the Pick string parses back to the look it came from", () => {
  for (let i = 0; i < 500; i++) {
    const p = pick(catalog, `s${i}`);
    const { f, v, r, e, l, params, g, align, side } = p;
    const wire = { f, v, p: p.p, r, e, l, params, g, align, side };
    assert.deepEqual(parsePickString(pickString(p)), wire);
  }
  assert.equal(parsePickString("f:x"), null);
});
