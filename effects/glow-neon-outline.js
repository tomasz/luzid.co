/**
 * Neon outline tube: a stroked tube rather than a solid face, with the bloom outside it.
 *
 * The face is `transparent` and the letter is drawn entirely by `-webkit-text-stroke` in
 * `--fg`, so the ground shows through the counters the way it does through real glass. The
 * bloom is a `filter: drop-shadow()` chain rather than `text-shadow` because the glow has to
 * follow the *stroke's* alpha, inside and outside the letter — `text-shadow` would silhouette
 * the (empty) glyph fill instead (R34).
 *
 * Three passes, not the eight the recipe suggests: the spike measured the chain doubling in
 * GPU cost per pass from six up (8 passes = 33–121 ms), and §5.6 caps it at four. Chained
 * blurs compound, so three passes at .12/.4/1 of the radius already read as a full bloom.
 *
 * A transparent face is the one place where a font with overlapping contours seams visibly,
 * hence `deny: ['overlap']`; `paint-order: stroke fill` is belt and braces for the same thing.
 */

/**
 * What the stroke adds to the painted extent, as a multiple of its own width.
 *
 * Geometrically it is 0.5 — `-webkit-text-stroke` is centred, so half lies outside the glyph
 * contour. That is what the first version of this effect budgeted, and the pixel proof found
 * it short on all four sides. Chrome and WebKit *miter* their stroke joins (Firefox rounds
 * them, and §5.6 cannot control either), and a mitered join on a sharp serif corner runs out
 * to `w/2 ÷ sin(θ/2)` — several times the nominal half-width on the kind of acute corner a
 * display serif has. Budgeting the full width covers a miter of 2x, which is what the
 * measurement needed, and costs at most 0.4u.
 */
const STROKE_OUTSET = 1

/**
 * R14 says a blurred layer reaches about one radius beyond its offset, and
 * `test/bleed.test.js` budgets 1.1 for safety. This chain needs a little more than that: the
 * blur does not start at the glyph, it starts at the stroke's antialiased outer edge, and
 * three passes compound. 1.3 clears the measured overshoot with about 0.7u to spare, which
 * is the margin the same number gives `glow-foil` in proportion.
 */
const REACH = 1.3

/** The three bloom radii, as fractions of `r`. `bleed()` sums them; the passes chain. */
const RADII = [0.12, 0.42, 1]
const SUM_R = RADII.reduce((a, b) => a + b, 0)

export default {
  id: 'glow-neon-outline',
  family: 'glow',
  shape: 'A',
  colors: 3,
  bg: 'dark',
  odds: 4,
  fonts: { deny: ['hairline', 'overlap', 'inline', 'shaded'], prefer: ['fat', 'rounded'] },
  palettes: { prefer: ['dark'] },
  // w = stroke width in hundredths of a u (0.35u–0.80u). The floor is set by the phone: at
  // a 390 px viewport 1u is about 3.6 device px, so anything under ~0.35u renders as a
  // sub-pixel hairline and the tube stops reading as glass.
  // r = bloom radius in tenths of a u. t = how much of `--a1` the bloom carries.
  params: { w: [35, 80, 5], r: [18, 25, 1], t: [60, 100, 10] },

  /**
   * Chained drop-shadows compound, so the blur term is the *sum* of the three radii and not
   * the largest of them — and the whole chain starts from the stroke's outer edge, not from
   * the glyph contour. Both terms were budgeted too tightly in the first version of this
   * effect, and `e2e/bleed.spec.js` measured the result: 0.83u l · 0.69u r · 0.66u b ·
   * 0.50u t at `r=25, t=100, w=80`, holding its value in u from a 1270 px block to a
   * 3360 px one, i.e. real ink rather than rounding. `STROKE_OUTSET` and `REACH` are what
   * that measurement costs.
   * @param {{w: number, r: number}} p
   */
  bleed: (p) => {
    const o = REACH * SUM_R * (p.r / 10) + (STROKE_OUTSET * p.w) / 100
    return { t: o, r: o, b: o, l: o }
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
  motion: null,
}

/**
 * The bloom chain, shared by `css` and `hover`: hover must re-state it, because a bare
 * `filter` on `a.n:hover` would otherwise replace the glow rather than add to it. Appending
 * `brightness()` keeps the two lists interpolable (its initial value is 1).
 *
 * @param {{r: number, t: number}} p
 * @param {typeof import('../src/helpers.js').helpers} h
 */
function bloom(p, h) {
  const r = p.r / 10
  const tube = h.mix('var(--a1)', 'var(--fg)', p.t)
  const core = h.mix('var(--a1)', 'var(--fg)', p.t / 4)
  // Same list `bleed()` sums, so the declaration cannot drift away from the paint.
  const colour = [core, tube, tube]
  return RADII.map((k, i) => `drop-shadow(0 0 ${h.u(r * k)} ${colour[i]})`).join(' ')
}
