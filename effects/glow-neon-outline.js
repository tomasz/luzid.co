/**
 * Neon outline tube: a stroked tube rather than a solid face, with the bloom outside it.
 *
 * The face is `transparent` and the letter is drawn entirely by `-webkit-text-stroke` in
 * `--fg`, so the ground shows through the counters the way it does through real glass. The
 * bloom is a `filter: drop-shadow()` chain rather than `text-shadow` because the glow has to
 * follow the *stroke's* alpha, inside and outside the letter — `text-shadow` would silhouette
 * the (empty) glyph fill instead (recipe 34).
 *
 * Three passes, not the eight the recipe suggests: the spike measured the chain doubling in
 * GPU cost per pass from six up (8 passes = 33–121 ms), and §5.6 caps it at four. Chained
 * blurs compound, so three passes at .12/.4/1 of the radius already read as a full bloom.
 *
 * A transparent face is the one place where a font with overlapping contours seams visibly,
 * hence `deny: ['overlap']`; `paint-order: stroke fill` is belt and braces for the same thing.
 */

/** The three bloom radii, as fractions of `r`. `bleed()` sums them; the passes chain. */
const RADII = [0.12, 0.42, 1];
const SUM_R = RADII.reduce((a, b) => a + b, 0);

export default /** @satisfies {import("../src/types.js").Effect<{ w: number; r: number; t: number }>} */ ({
  id: "glow-neon-outline",
  shape: "A",
  colors: 3,
  bg: "dark",
  fonts: { deny: ["hairline", "overlap", "inline", "shaded"], prefer: ["fat", "rounded"] },
  palettes: { prefer: ["dark"] },
  // w = stroke width in hundredths of a u (0.35u–0.80u). The floor is set by the phone: at
  // a 390 px viewport 1u is about 3.6 device px, so anything under ~0.35u renders as a
  // sub-pixel hairline and the tube stops reading as glass.
  // r = bloom radius in tenths of a u. t = how much of `--a1` the bloom carries.
  params: { w: [35, 80, 5], r: [18, 25, 1], t: [60, 100, 10] },

  /**
   * Chained drop-shadows compound, so the blur term is the *sum* of the three radii and not
   * the largest of them — and the whole chain starts from the stroke's outer edge, not from
   * the glyph contour, so the stroke's `h.OUTSET` adds to it (R14). The first version
   * counted half the stroke and the radii at 1.0x, and `e2e/bleed.spec.js` measured 0.81u of
   * real ink past that at `r=25, t=100, w=80`, holding its value in u from a 1270 px block
   * to a 3360 px one. The full stroke width and `h.REACH` add 0.79u there.
   * @param {{w: number, r: number}} p
   * @param {import("../src/types.js").LineGeometry} _lines
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  bleed: (p, _lines, h) => {
    const o = h.REACH * SUM_R * (p.r / 10) + (h.OUTSET * p.w) / 100;
    return { t: o, r: o, b: o, l: o };
  },

  /**
   * @param {{w: number, r: number, t: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) =>
    `.n{color:transparent;-webkit-text-stroke:${h.u(p.w / 100)} var(--fg);paint-order:stroke fill;` +
    `filter:${bloom(p, h)}}`,

  /** @param {{w: number, r: number, t: number}} p @param {typeof import('../src/helpers.js').helpers} h */
  hover: (p, h) => `filter:${bloom(p, h)} brightness(1.16)`,
});

/**
 * The bloom chain, shared by `css` and `hover`: hover must re-state it, because a bare
 * `filter` on `a.n:hover` would otherwise replace the glow rather than add to it. Appending
 * `brightness()` keeps the two lists interpolable (its initial value is 1).
 *
 * @param {{r: number, t: number}} p
 * @param {typeof import('../src/helpers.js').helpers} h
 */
function bloom(p, h) {
  const r = p.r / 10;
  const tube = h.mix("var(--a1)", "var(--fg)", p.t);
  const core = h.mix("var(--a1)", "var(--fg)", p.t / 4);
  // Same list `bleed()` sums, so the declaration cannot drift away from the paint.
  const colour = [core, tube, tube];
  return RADII.map((k, i) => `drop-shadow(0 0 ${h.u(r * k)} ${colour[i]})`).join(" ");
}
