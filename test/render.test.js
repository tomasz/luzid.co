import assert from "node:assert/strict";
import { expect, test } from "vite-plus/test";
import { brotliCompressSync } from "node:zlib";
import { helpers } from "../src/helpers.js";
import { FALLBACK_FONT, pick, pickString, resolve } from "../src/pick.js";
import { round4 } from "../src/rand.js";
import { fit, render, stylesheet } from "../src/render.js";
import { fixtureCatalog, GOLDEN_SEEDS } from "./catalog.js";

const catalog = await fixtureCatalog();
const GATE = "@media screen and (forced-colors:none) and (prefers-contrast:no-preference){";

const page = (seed, pins = {}) => {
  const p = pick(seed, pins, catalog);
  return { p, html: render(p, catalog, { nonce: "test", pick: pickString(p) }) };
};

/** The character range the §5.8 gate spans, by brace matching. */
function gateRange(css) {
  const start = css.indexOf(GATE);
  assert.notEqual(start, -1, "the accessibility gate is missing");
  assert.equal(css.indexOf(GATE, start + 1), -1, "the gate must appear exactly once");
  let depth = 0;
  for (let i = start + GATE.length - 1; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return [start, i + 1];
  }
  throw new Error("unbalanced gate");
}

// One file and one test per seed, never one shared snapshot: a diff has to be readable,
// the file opens in a browser as-is, and one mismatch must not hide the others. The path is
// relative to this file. Refresh with `vp test -u`.
test.each(GOLDEN_SEEDS)("golden HTML for %s", async (seed) => {
  await expect(page(seed).html).toMatchFileSnapshot(`./golden/${seed}.html`);
});

test("the document carries exactly one style element, one link and no style attribute", () => {
  for (const seed of GOLDEN_SEEDS) {
    const { html } = page(seed);
    assert.equal((html.match(/<style\b/g) ?? []).length, 1, `${seed}: one <style>`);
    assert.match(html, /<style nonce="test">/, `${seed}: the <style> must be nonce'd`);
    assert.equal((html.match(/<a\b/g) ?? []).length, 1, `${seed}: one <a>`);
    assert.equal(
      (html.match(/<script\b/g) ?? []).length,
      2,
      `${seed}: JSON-LD + the pageshow script`,
    );

    // A CSP nonce covers <style> elements only, never a style="" attribute, and the policy
    // sends style-src-attr 'none' — an attribute would silently do nothing.
    assert.equal(
      /\sstyle=/.test(html.replaceAll("<style", "<S")),
      false,
      `${seed}: inline style attribute`,
    );
    assert.equal(/\son[a-z]+=/.test(html), false, `${seed}: inline event handler`);
  }
});

test("the accessible name is the real text, exactly once", () => {
  for (const seed of GOLDEN_SEEDS) {
    const { html } = page(seed);
    const anchor = html.match(/<a\b[^>]*>([\s\S]*?)<\/a>/)[1];
    // The text between the tags, i.e. what a screen reader announces.
    const text = anchor.split(/<[^>]*>/).join("");
    assert.equal(text, "Tomasz Cudziło", `${seed}: accessible name`);
    assert.match(html, /href="https:\/\/github\.com\/tomasz" rel="me"/);
    // Case is CSS only. The DOM text never changes.
    assert.equal(html.includes('data-t="Tomasz"'), true);
    assert.equal(html.includes('data-t="Cudziło"'), true);
    assert.equal(
      html.includes("aria-label"),
      false,
      `${seed}: aria-label breaks translation and 2.5.3`,
    );
  }
});

test("no effect selector or property appears outside the §5.8 gate", () => {
  for (const seed of GOLDEN_SEEDS) {
    const { p } = page(seed);
    const parts = resolve(p, catalog);
    const f = fit(p, parts);
    const css = stylesheet(p, catalog);
    const [from, to] = gateRange(css);
    const inside = css.slice(from, to);
    const outside = css.slice(0, from) + css.slice(to);

    const fx = parts.effect.css?.(p.params, helpers, f.m) ?? "";
    if (fx) {
      assert.equal(css.split(fx).length, 2, `${seed}: the effect CSS must appear exactly once`);
      assert.ok(inside.includes(fx), `${seed}: the effect CSS escaped the gate`);
    }

    // Everything the effect writes — and every interaction selector — has to be gated too.
    const props = [...fx.matchAll(/(?:^|[{;])\s*(-?[a-z-]+)\s*:/g)].map((m) => m[1]);
    for (const prop of new Set(props)) {
      assert.equal(
        outside.includes(`${prop}:`),
        false,
        `${seed}: ${prop} is declared outside the gate`,
      );
    }
    for (const sel of ["a.n:hover", "a.n:active", "prefers-reduced-motion"]) {
      assert.equal(outside.includes(sel), false, `${seed}: ${sel} is outside the gate`);
    }
  }
});

test("the non-screen and high-contrast fallbacks are always present", () => {
  for (const seed of GOLDEN_SEEDS) {
    const { p } = page(seed);
    const css = stylesheet(p, catalog);
    const dark = catalog.palettes.find((x) => x.id === p.p).roles.find((r) => r.o === p.r).dark;
    assert.ok(css.includes("@media print{html,body{background:none}.n{color:#000}}"));
    assert.ok(css.includes(`@media (prefers-contrast:more){:root{--bg:${dark ? "#111" : "#fff"}`));
    // The gate is `screen` + `forced-colors:none`, so print and forced-colors get the plain
    // fitted name with no author rules at all — which is what both modes want.
    assert.ok(css.startsWith(":root{--bg:"));
  }
});

test("all four role variables always resolve", () => {
  for (let i = 0; i < 500; i++) {
    const css = stylesheet(pick(`s${i}`, {}, catalog), catalog);
    const root = css.match(/^:root\{([^}]*)\}/)[1];
    for (const v of ["--bg", "--fg", "--a1", "--a2"]) {
      assert.match(root, new RegExp(`${v}:#[0-9a-f]{6}`), `${v} is not a literal in ${root}`);
    }
  }
});

test("a derived ground reads from the row hex past names.length", () => {
  // WP-12's convention: washi then sumi, appended after the palette's real colours.
  const ground = catalog.palettes.find((x) => x.id === "fx-ground");
  assert.equal(ground.names.length, 2);
  assert.equal(ground.hex.length, 4);
  const washi = stylesheet(pick("gt", {}, catalog), catalog);
  assert.ok(washi.includes(`--bg:${ground.hex[2]}`), "w must be hex[names.length]");
  const sumi = stylesheet(pick("gs", {}, catalog), catalog);
  assert.ok(sumi.includes(`--bg:${ground.hex[3]}`), "k must be hex[names.length + 1]");
  // The credit line names only the real colours, never a derived ground.
  const html = page("gt").html;
  assert.ok(html.includes("palette: Moss, Olive (fixture)"));
});

test("the fit literals follow §5.2", () => {
  const p = pick("gs", {}, catalog);
  const parts = resolve(p, catalog);
  const f = fit(p, parts);
  const { w1, w2 } = parts.variant;
  const [ASC, DESC] = [parts.file.asc / parts.font.upm, parts.file.desc / parts.font.upm];

  assert.equal(f.F1, w1.W, "stack-fit: each line fills the block width");
  assert.equal(f.F2, w2.W);
  assert.equal(f.L1, 2 * w1.top - ASC + DESC);
  assert.equal(f.L2, 2 * w2.top - ASC + DESC);

  const h1 = (100 * w1.H) / f.F1;
  const h2 = (100 * w2.H) / f.F2;
  assert.equal(f.G, Math.max(p.g, f.bleed.t, f.bleed.b), "R13: G clears ink both ways");
  assert.equal(f.R, (h1 + h2 + f.G) / 100);
  assert.equal(f.BH, 100 * f.R);
  assert.equal(f.Y2, h1 + f.G);
  assert.equal(f.K1, 1 + (f.bleed.l + f.bleed.r) / 100);
  assert.equal(f.K2, f.R + (f.bleed.t + f.bleed.b) / 100);
  assert.equal(f.DX, (f.bleed.l - f.bleed.r) / 2);
  assert.equal(f.DY, (f.bleed.t - f.bleed.b) / 2);

  // stack-eq shares one scale between the lines.
  const eq = pick("gp", {}, catalog);
  const feq = fit(eq, resolve(eq, catalog));
  assert.equal(feq.F1, feq.F2);

  // gs bleeds only upwards, so it cannot tell R13 from the old max(g, bt). s7 is
  // depth-extrude(a=135,d=9) at g=4: all of its bleed is downwards, and G must follow it.
  const down = pick("s7", {}, catalog);
  const fd = fit(down, resolve(down, catalog));
  assert.ok(fd.bleed.b > fd.bleed.t && fd.bleed.b > down.g, "s7 must bleed down past g");
  assert.equal(fd.G, Math.max(down.g, fd.bleed.t, fd.bleed.b));
  assert.equal(fd.G, fd.bleed.b);
});

test("the emitted gap is the resolved G, not the drawn g", () => {
  // Line 1's box is h1 tall and line 2 sits margin-top:G below it, so the gap between the
  // two boxes is exactly G·u. That is the whole of the DOM-rect check; no browser needed.
  let widened = 0;
  for (let i = 0; i < 400; i++) {
    const p = pick(`s${i}`, {}, catalog);
    const f = fit(p, resolve(p, catalog));
    assert.equal(f.G, Math.max(p.g, f.bleed.t, f.bleed.b), `s${i}: G is not max(g, bt, bb)`);
    const css = stylesheet(p, catalog);
    const gap = css.match(/\.l2\{[^}]*margin-top:calc\((-?[\d.]+)\*var\(--u\)\)/)[1];
    assert.equal(Number(gap), round4(f.G), `s${i}: line 2's margin is not G`);
    if (f.G > p.g) widened++;
  }
  assert.ok(widened > 0, "no seed widened the gap, so the loop proved nothing");
});

test("the gap clears ink in both directions", () => {
  // R13, on the corner that failed before it: depth-extrude at d=9 over the narrowest gap.
  // a=45 paints only downwards and a=225 only upwards; max(g, bt) missed the first one.
  const base = pick("s7", {}, catalog);
  assert.equal(base.e, "depth-extrude");
  for (const [a, side] of [
    [45, "b"],
    [225, "t"],
  ]) {
    const p = { ...base, g: 4, params: { a, d: 9 } };
    const f = fit(p, resolve(p, catalog));
    assert.equal(f.bleed[side], 9, `a=${a} must bleed 9u ${side}`);
    assert.equal(f.G, 9, `a=${a}: G=${f.G} does not clear the ${side} bleed`);
  }
});

test("side emits the rotated portrait block, and only then", () => {
  const on = pick("gp", {}, catalog);
  assert.equal(on.side, true);
  assert.match(stylesheet(on, catalog), /@media \(max-aspect-ratio:4\/5\)\{\.n\{[^}]*rotate:90deg/);

  const off = pick("gs", {}, catalog);
  assert.equal(off.side, false);
  assert.equal(stylesheet(off, catalog).includes("max-aspect-ratio"), false);
});

test("the response fits the first flight", () => {
  // §9.1: the real gate is font bytes x heaviest effect, which arrives with WP-11. Here the
  // fixture font is a 150 B stub, so this only proves the shell and the effect CSS are cheap.
  for (const seed of GOLDEN_SEEDS) {
    const { html } = page(seed);
    const size = brotliCompressSync(Buffer.from(html, "utf8")).length;
    assert.ok(size <= 14000, `${seed}: ${size} B brotli`);
    assert.ok(size <= 4000, `${seed}: ${size} B brotli — the shell alone should be tiny`);
  }
});

test("two renders of one seed differ only in the nonce", () => {
  const p = pick("gs", {}, catalog);
  const a = render(p, catalog, { nonce: "AAAA", pick: pickString(p) });
  const b = render(p, catalog, { nonce: "BBBB", pick: pickString(p) });
  assert.equal(a.replaceAll("AAAA", "N"), b.replaceAll("BBBB", "N"));
});

test("the colophon can never break out of its comment", () => {
  const evil = {
    ...catalog,
    palettes: catalog.palettes.map((x) =>
      x.id === "fx-ink" ? { ...x, names: ["--> <script>alert(1)</script>", "x"] } : x,
    ),
  };
  const p = pick("k3f9x2m7qa", {}, evil);
  const html = render(p, evil, { nonce: "test", pick: pickString(p) });
  const comment = html.match(/<!-- ([\s\S]*?) -->/)[1];
  assert.equal(comment.includes("<"), false);
  assert.equal(comment.includes(">"), false);
  assert.equal(comment.includes("--&gt;"), false);
  assert.equal((html.match(/<script\b/g) ?? []).length, 2);

  // …while the canonical tuple survives verbatim, hyphens and all: the colophon is what a
  // bug report is copied from, and `10--` is an ordinary role-set id.
  const tuple = pickString(p);
  assert.ok(tuple.includes(".10--"));
  assert.ok(comment.startsWith(`${tuple} ·`), `tuple was mangled: ${comment}`);
});

test("the favicon data URI escapes its hashes", () => {
  const { html } = page("gs");
  const href = html.match(/href="(data:image\/svg\+xml,[^"]*)"/)[1];
  assert.equal(href.includes("#"), false, "a raw # would truncate the data URI at the fragment");
  assert.equal(href.includes("<"), false);
  assert.ok(href.includes("%23"));
});

test("a system-font render emits no @font-face and keeps the family stack", () => {
  const bare = {
    fonts: [],
    palettes: [],
    effects: catalog.effects,
    presets: [],
    deny: [],
    weights: {},
  };
  const p = pick("a", {}, bare);
  const css = stylesheet(p, bare);
  assert.equal(css.includes("@font-face"), false);
  assert.match(css, /font-family:Georgia,"Times New Roman",ui-serif,serif/);

  assert.equal(p.f, FALLBACK_FONT.id);

  // The stand-in's metrics are a deliberate upper bound on every plausible system serif —
  // Georgia is the widest at 3.94 / 3.84 em bold — so the ink always comes out narrower
  // than its box. Under-fill is benign; overflow would put the name past the viewport.
  const { w1, w2 } = FALLBACK_FONT.variants[0];
  assert.ok(w1.W > 3.94, `fallback w1 ${w1.W} must exceed Georgia's 3.94`);
  assert.ok(w2.W > 3.84, `fallback w2 ${w2.W} must exceed Georgia's 3.84`);
});
