/**
 * Emboss: the face raised off the paper, tone on tone.
 *
 * `retro-deboss` turned inside out, and built on the same rule — a tight hard rim reads as
 * a highlight because the eye compares it to the face, a wide soft halo reads as a shadow
 * because the eye compares it to the paper. A raised letter lit from the top left catches
 * that light on its near bevel and throws its shadow down and right, so the crisp pale
 * edge goes above left and the soft one below right.
 *
 * The hard rim is what separates this from an ordinary drop shade: without it the letter
 * is flat paper with something behind it, and with it the stroke has a lit face of its own.
 *
 * `bg: 'light'` for the same reason as the deboss — every tone it paints has to be darker
 * than the ground, and that only holds when the ground is the lighter role. Both tones are
 * mixes of the two guaranteed roles, so this fits any palette at all: `colors: 2`.
 */

/**
 * @param {{k: number, s: number}} p
 * @param {typeof import('../src/helpers.js').helpers} h
 * @param {number} lift how far the cast shadow is thrown, as a multiple of the resting throw
 */
const raise = (p, h, lift) =>
  `${h.u(-p.k)} ${h.u(-p.k)} 0 ${h.mix('var(--fg)', 'var(--bg)', 20)},` +
  `${h.u(2.4 * p.k * lift)} ${h.u(2.8 * p.k * lift)} ${h.u(p.s * lift)} ` +
  `${h.mix('var(--fg)', 'var(--bg)', 36)}`

export default {
  id: 'retro-emboss',
  family: 'retro',
  shape: 'A',
  colors: 2,
  bg: 'light',
  odds: 3,
  fonts: {
    deny: ['hairline', 'inline', 'shaded', 'stencil'],
    prefer: ['fat', 'slab', 'rounded', 'soft'],
  },
  palettes: { prefer: [] },
  // k = how far the letter stands off the sheet; s = how soft its shadow is. Both in u.
  params: { k: [0.3, 0.9, 0.3], s: [0.6, 1.8, 0.6] },

  /**
   * Hover lifts the letter further, so the bleed reserves the hover throw rather than the
   * resting one. `t` mirrors `b` so that `G = max(g, bt)` opens the gap the cast shadow of
   * line 1 falls through; see `retro-relief-gap` for why that is the only lever available.
   *
   * @param {{k: number, s: number}} p
   */
  bleed: (p) => ({
    t: 2.8 * p.k * 1.3 + p.s * 1.3,
    r: 2.4 * p.k * 1.3 + p.s * 1.3,
    b: 2.8 * p.k * 1.3 + p.s * 1.3,
    l: p.k,
  }),

  /**
   * @param {{k: number, s: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => `.n{text-shadow:${raise(p, h, 1)}}`,

  /**
   * @param {{k: number, s: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  hover: (p, h) => `text-shadow:${raise(p, h, 1.3)}`,

  motion: null,
}
