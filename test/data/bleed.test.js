/**
 * The cheap half of the bleed check (§5.6): does an effect's declared `bleed()` actually
 * bound the ink its own CSS paints?
 *
 * `e2e/bleed.spec.js` answers this properly, in pixels, in three engines. This runs in
 * milliseconds without a browser, so an effect author finds out at authoring time rather
 * than after a CI round trip. At the ~200 effects the catalogue is heading for, that
 * matters. It is a complement to the pixel test, never a replacement.
 *
 * Two rules, both learned from a first version of this audit that got it wrong:
 *
 *  - **Blur reaches 1.0x its radius, not 1.5x** (R14). The 1.5x figure came from the
 *    "Gaussian is visible to 3 sigma" folklore; measured against real pixels the answer is
 *    0.89-1.05. Using 1.5x here produced three false alarms and would have cost real size.
 *
 *  - **Anything unparsed is a FAILURE, not a pass.** A shadow-list scan cannot see shape-B
 *    geometry, `transform`, `clip-path` or `mask`, and scoring those zero reads as clean.
 *    The first version of this audit silently gave a pass to two effects that do overshoot
 *    and to one that it could not have judged at all.
 */
import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { helpers as h } from "../../src/helpers.js";
import {
  effects,
  grid,
  hoverOf,
  METRICS as M,
  parse,
  shadowLengths,
  topSplit,
} from "../effects-lint.js";

/** R14: a blurred layer paints to about one radius beyond its offset; `h.REACH` budgets it. */
const BLUR_REACH = h.REACH;

/**
 * How far past its declaration an effect may score before this test complains, in u.
 *
 * This scan is an approximation and always reads high: it sums the worst corner of every
 * layer analytically, while ink is only ink where it is actually visible. Measured in
 * pixels by `e2e/bleed.spec.js`, `retro-deboss` paints 0.7u *inside* its envelope where
 * this scan reads an overshoot, and `glow-neon` is clean where this scan says 0.25u.
 *
 * So the threshold is set to catch the gross errors this is good at — an effect that
 * declares nothing, or is out by a multiple — and to leave the fine margin to the pixel
 * test, which is authoritative. Tightening it below the scan's own error would just
 * force effects to reserve space they never paint into, which costs real size.
 */
const TOLERANCE = 0.5;

/** Properties whose ink a shadow-list scan cannot bound. Seeing one means we must abstain. */
const OPAQUE = /^(transform|translate|scale|rotate|clip-path|mask|mask-image|filter|content)$/;

/** Filter functions that recolour ink without moving it; `drop-shadow()` is scanned below. */
const RECOLOUR = /^(brightness|contrast|saturate)\(/;

/**
 * The painted extent of one CSS string, in u per side.
 * @returns {{ext: {l:number,r:number,t:number,b:number}, opaque: string[]}}
 */
function extent(css) {
  const ext = { l: 0, r: 0, t: 0, b: 0 };
  const opaque = [];
  let stroke = 0;

  for (const { decls } of parse(css, "extent")) {
    for (const [prop, value] of decls) {
      // A centred stroke puts w/2 outside the contour geometrically -- but Chrome and
      // WebKit MITER their joins, and a miter on an acute corner runs to w/2 / sin(0/2),
      // which is unbounded as the corner sharpens. Count the full width: it covers a 2x
      // miter, which is the sharpest these display faces produce. The stroke then feeds
      // every shadow that follows, so this is an outset on the glyph, not a separate side.
      if (/^-webkit-text-stroke(-width)?$/.test(prop)) {
        const [w = null] = shadowLengths(value);
        if (w === null) opaque.push(prop);
        else stroke = Math.max(stroke, w);
        continue;
      }
      // drop-shadow is the one filter whose geometry the scan understands; a recolouring
      // one paints no new ink, and any other changes ink in ways a shadow list cannot describe.
      const scannable =
        prop === "filter" &&
        topSplit(value, " ").every((f) => f.startsWith("drop-shadow(") || RECOLOUR.test(f));
      if (OPAQUE.test(prop) && !scannable) {
        opaque.push(prop);
        continue;
      }

      const isShadow = prop === "text-shadow";
      if (!isShadow && prop !== "filter") continue;
      const layers = isShadow
        ? topSplit(value, ",")
        : topSplit(value, " ")
            .filter((f) => f.startsWith("drop-shadow("))
            .map((f) => f.slice("drop-shadow(".length, -1));

      // `text-shadow` layers are siblings: each is drawn from the same glyph, so the
      // extent is the widest of them. Chained `drop-shadow()` filters are NOT siblings --
      // each pass shadows the OUTPUT of the one before, so offsets add up and blurs
      // compound. Taking the max over a chain under-reports it, which is how this scan
      // scored `glow-neon-outline` at 3.15u while it painted 5.08u and called it clean.
      const chain = { l: 0, r: 0, t: 0, b: 0 };
      for (const layer of layers) {
        const nums = shadowLengths(layer);
        if (nums.length < 2) {
          opaque.push(`${prop} layer`);
          continue;
        }
        const [x, y] = nums;
        const reach = BLUR_REACH * (nums[2] ?? 0);
        if (isShadow) {
          ext.l = Math.max(ext.l, -(x - reach));
          ext.r = Math.max(ext.r, x + reach);
          ext.t = Math.max(ext.t, -(y - reach));
          ext.b = Math.max(ext.b, y + reach);
        } else {
          chain.l += Math.max(0, -(x - reach));
          chain.r += Math.max(0, x + reach);
          chain.t += Math.max(0, -(y - reach));
          chain.b += Math.max(0, y + reach);
        }
      }
      for (const k of /** @type {const} */ (["l", "r", "t", "b"]))
        ext[k] = Math.max(ext[k], chain[k]);
    }
  }
  for (const k of /** @type {const} */ (["l", "r", "t", "b"]))
    ext[k] = Math.max(ext[k], 0) + stroke;
  return { ext, opaque };
}

test("every effect either bounds its own ink or says it cannot be scanned statically", () => {
  // Effects the scan provably cannot judge. Each one is covered by e2e/bleed.spec.js in
  // pixels instead; listing it here is an explicit abstention, not a silent pass.
  const abstain = new Set(effects.filter(({ fx }) => fx.shape === "B").map(({ id }) => id));

  const problems = [];
  for (const { id, fx: e } of effects) {
    for (const p of grid(e.params)) {
      // Hover ink is painted ink too (§5.6), so its declarations are scanned as a rule.
      const hover = hoverOf(e, p, h, M);
      const css = e.css(p, h, M) + (hover ? `.n{${hover}}` : "");
      const { ext, opaque } = extent(css);
      const declared = e.bleed?.(p, M, h) ?? { t: 0, r: 0, b: 0, l: 0 };

      if (opaque.length) {
        if (!abstain.has(id)) {
          problems.push(
            `${id}: emits ${[...new Set(opaque)].join(", ")}, which this scan cannot bound — ` +
              `declare shape 'B' or extend the scan; scoring it clean would be a lie`,
          );
        }
        break;
      }
      for (const side of /** @type {const} */ (["l", "r", "t", "b"])) {
        const over = ext[side] - (Number(declared[side]) || 0);
        if (over > TOLERANCE) {
          problems.push(
            `${id} at ${JSON.stringify(p)}: paints ${ext[side].toFixed(2)}u ${side} ` +
              `but declares ${(Number(declared[side]) || 0).toFixed(2)}u (over by ${over.toFixed(2)}u)`,
          );
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("the scan refuses to score what it cannot parse", () => {
  // The guard that matters: a silent zero from an unparsed construct must never read as a pass.
  assert.ok(extent(".n{transform:translateX(5px)}").opaque.length, "transform must be opaque");
  assert.ok(extent(".n{clip-path:inset(1px)}").opaque.length, "clip-path must be opaque");
  assert.ok(
    extent(".n{text-shadow:1cm 1cm 0 red}").opaque.length,
    "an unknown length must be opaque",
  );
  assert.equal(extent(".n{text-shadow:0 0 calc(2*var(--u)) var(--a1)}").opaque.length, 0);
});

test("the scan measures reach the way R14 says", () => {
  const { ext } = extent(".n{text-shadow:calc(3*var(--u)) 0 calc(2*var(--u)) var(--a1)}");
  assert.equal(ext.r.toFixed(2), (3 + BLUR_REACH * 2).toFixed(2));
  // The blur reaches 2.2u back but the offset carries it 3u right, so nothing lands left
  // of the glyph: a side that is never painted contributes no bleed, and clamps at 0.
  assert.equal(ext.l, 0);
  // A stroke counts at its full width, not w/2: the joins are mitred, so an acute corner
  // paints well past the geometric half-width. It outsets the glyph every layer starts from.
  const withStroke = extent(
    ".n{-webkit-text-stroke:calc(4*var(--u)) var(--fg);text-shadow:0 0 0 var(--a1)}",
  );
  assert.equal(withStroke.ext.l, 4);

  // Chained drop-shadows compound: each pass shadows the output of the one before.
  const chained = extent(
    ".n{filter:drop-shadow(0 calc(2*var(--u)) 0) drop-shadow(0 calc(3*var(--u)) 0)}",
  );
  assert.equal(chained.ext.b, 5, "a drop-shadow chain accumulates rather than taking the widest");
  const siblings = extent(
    ".n{text-shadow:0 calc(2*var(--u)) 0 var(--a1),0 calc(3*var(--u)) 0 var(--a1)}",
  );
  assert.equal(siblings.ext.b, 3, "text-shadow layers are siblings and take the widest");
});
