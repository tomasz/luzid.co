/**
 * Fire: a warm multi-layer bloom rising off the letters (recipe 58).
 *
 * Four blurred layers, each lifted further and opened wider than the last, and each mixed one
 * step further from `--fg` through `--a1` and on toward `--bg` — so the ramp goes hot at the
 * glyph and cools into the ground as it rises. The recipe's fixed fire colours are replaced
 * by that ramp: literal orange and yellow fight every historical palette this can land on.
 *
 * **Static.** `motion` is `null` in Waves 0–3 (§5.6), and this is the one effect in the
 * family where that is a mercy rather than a restriction: keyframing a blurred shadow list
 * over viewport-sized text is the worst case the browser spike found. Wave 4 should animate
 * the opacity of a pre-rendered copy, not the radii.
 *
 * Four blurred layers is the cap, and the top bleed is genuinely large — the rise plus the
 * full reach. That is real upward ink, not a declaration bought to widen the gap: `G` is
 * `max(g, bt, bb)` (§5.2, R13) and it is what stops `Cudziło`'s flames licking the underside
 * of `Tomasz`. Below the glyph only what a layer's blur reaches past its own rise remains.
 */

/**
 * The four layers, nearest first: `[x, rise, blur]`, with `x` and `blur` as fractions of the
 * radius and `rise` as a fraction of the lift. `css()` paints them and `bleed()` bounds them,
 * so the declaration cannot drift away from the paint. The small sideways offsets are the
 * lean of recipe 58's sketch: without them four centred layers stack into a symmetrical
 * column, which no flame has ever been.
 * @type {[number, number, number][]}
 */
const FLAMES = [
  [0, 0.1, 0.3],
  [0.06, 0.3, 0.55],
  [-0.06, 0.55, 0.8],
  [0.1, 0.85, 1],
];

export default /** @satisfies {import("../src/types.js").Effect<{ r: number; l: number }>} */ ({
  id: "glow-fire",
  shape: "A",
  colors: 3,
  bg: "dark",
  odds: 3,
  fonts: { deny: ["hairline", "inline", "shaded"], prefer: ["fat", "condensed"] },
  palettes: { prefer: ["dark"] },
  // r = widest bloom radius in tenths of a u (1.6u–2.5u; 2.5u is the measured cap).
  // l = rise, as a fraction of that radius in tenths. It stays *under* the radius on
  // purpose: the moment a layer's offset outruns its own blur it stops being a flame and
  // becomes a displaced ghost copy with a dark gap under it.
  params: { r: [16, 25, 1], l: [6, 14, 2] },

  /**
   * Each side is the farthest any layer reaches: its offset that way plus `h.REACH` of its
   * blur (R14), never less than the glyph itself.
   * @param {{r: number, l: number}} p
   * @param {import("../src/types.js").LineGeometry} _lines
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  bleed: (p, _lines, h) => {
    const r = p.r / 10;
    const y = (r * p.l) / 10;
    /** @param {(f: [number, number, number]) => number} side */
    const most = (side) => Math.max(0, ...FLAMES.map(side));
    return {
      t: most(([, k, b]) => k * y + h.REACH * b * r),
      r: most(([x, , b]) => (x + h.REACH * b) * r),
      b: most(([, k, b]) => h.REACH * b * r - k * y),
      l: most(([x, , b]) => (h.REACH * b - x) * r),
    };
  },

  /**
   * @param {{r: number, l: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => {
    const r = p.r / 10;
    const y = (r * p.l) / 10;
    const colour = [
      h.mix("var(--a1)", "var(--fg)", 15),
      h.mix("var(--a1)", "var(--fg)", 45),
      "var(--a1)",
      h.mix("var(--a1)", "var(--bg)", 60),
    ];
    const layers = FLAMES.map(
      ([x, k, b], i) => `${h.u(x * r)} ${h.u(-k * y)} ${h.u(b * r)} ${colour[i]}`,
    );
    return `.n{text-shadow:${layers.join(",")}}`;
  },

  hover: () => "filter:brightness(1.14)",
});
