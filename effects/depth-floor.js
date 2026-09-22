/**
 * Perspective floor shadow: a second copy of each word, flipped under its own baseline,
 * squashed, skewed and faded out with a mask — the letters end up standing on a floor
 * that the shadow lies across.
 *
 * This is the one effect in the family that needs shape B. A `text-shadow` cannot be
 * transformed, so the copy has to be real generated content: `content:attr(data-t) / ""`,
 * exactly once, with the alt text that keeps the accessible name single. `z-index:-1`
 * puts it behind every line's real glyphs, which is what stops line 1's shadow from
 * muddying line 2 — it passes behind those letters rather than over them.
 *
 * Geometry: `.l::before/::after` are `inset:0` on the line's ink box, so the copy inherits
 * the exact font size, line height and indent of the real text. With the default
 * `transform-origin` at the box centre, `translateY((1+s)/2)` lands the flipped copy's top
 * edge precisely on the original's bottom edge — and `transform-origin` is not on the
 * property allowlist, so that identity is the only way to hinge the copy at the baseline.
 *
 * The skew angles are quantized and their tangents written out as literals: computing them
 * with `Math.tan` would make the bleed — and so the emitted fit literals — depend on the
 * engine that rendered the page.
 */

/** Upper bounds on tan(|skew|), for the quantized angles `sk` can take. */
const TAN = { 0: 0, 15: 0.27, 30: 0.58 }

/** Blur on the copy, in u. Small: the mask does the softening. */
const BLUR = 0.25

/** Blur radius to painted reach: sigma is r/2, so 2r is a conservative bound. */
const SPREAD = 2

/** How much ink the floor copy carries, in percent of the ground colour. */
const SHADE = 45

export default {
  id: 'depth-floor',
  family: 'depth',
  shape: 'B',
  colors: 2,
  bg: 'any',
  odds: 3,
  fonts: { deny: ['hairline'], prefer: ['fat', 'sans'] },
  palettes: { prefer: [] },
  // `sy` is the floor copy's height as a percent of the letters; `sk` its skew in degrees.
  params: { sy: [30, 60, 10], sk: [-30, 30, 15] },

  /**
   * @param {{sy: number, sk: number}} p
   * @param {{H: number[]}} m
   */
  bleed: (p, m) => {
    const tall = Math.max(m.H[0], m.H[1])
    const lean = (TAN[Math.abs(p.sk)] ?? 0.58) * (tall / 2) + SPREAD * BLUR
    return { t: 0, r: lean, b: (p.sy / 100) * m.H[1] + SPREAD * BLUR, l: lean }
  },

  /**
   * @param {{sy: number, sk: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => {
    const s = p.sy / 100
    const drop = 50 * (1 + s)
    return (
      `.l::after{content:attr(data-t) / "";color:${h.mix('var(--fg)', 'var(--bg)', SHADE)};z-index:-1;` +
      `transform:translateY(${drop}%) scaleY(${-s}) skewX(${p.sk}deg);` +
      `filter:blur(${h.u(BLUR)});mask-image:linear-gradient(transparent,var(--fg) 88%)}`
    )
  },

  hover: () => 'filter:brightness(1.05)',
  motion: null,
}
