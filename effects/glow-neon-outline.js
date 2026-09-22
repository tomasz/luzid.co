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
   * Chained drop-shadows compound, so the conservative outset is the sum of the three radii
   * plus the half of the stroke that sits outside the glyph outline.
   * @param {{w: number, r: number}} p
   */
  bleed: (p) => {
    const o = (p.r / 10) * 1.54 + p.w / 200
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
  return (
    `drop-shadow(0 0 ${h.u(r * 0.12)} ${core}) drop-shadow(0 0 ${h.u(r * 0.42)} ${tube}) ` +
    `drop-shadow(0 0 ${h.u(r)} ${tube})`
  )
}
