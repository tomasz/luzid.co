/**
 * Letterpress deboss: the face pressed into the paper.
 *
 * The published recipe is a white shadow below the glyph and a black one above it. Neither
 * literal is available here, and the first attempt at replacing them — a mid tone up and
 * left, where the shaded bevel of a depression physically is — came out reading as a
 * *raised* letter. The reason is what the eye anchors on. Every tone this effect can paint
 * is between the ink and the ground, so a tight rim laid against a dark face is always
 * lighter than that face and always reads as light catching an edge, whatever the paper
 * behind it is doing. A wide, soft, further-out halo anchors on the paper instead and
 * reads as shadow.
 *
 * So the rule the trio is built on: **tight and hard is a highlight, wide and soft is a
 * shadow**, and the geometry follows from that. A depression lit from the top left has its
 * far wall — down and right — catching the light, and its near wall in shade. Hence a
 * crisp pale edge below right and a soft darker one above left, which is exactly the
 * canonical inset recipe with both tones squeezed into the range a palette can reach.
 *
 * `bg: 'light'` because the whole construction needs tones darker than the ground, which
 * only exist when the ground is the lighter role; on a dark ground every tone here inverts
 * and the letter rises instead. Both tones are mixes of the two guaranteed roles, so this
 * fits any palette at all — `colors: 2`. The face stays `--fg`, so legibility is the
 * engine's guarantee and the relief spends the low-contrast tones.
 */

/**
 * @param {{k: number, s: number}} p
 * @param {typeof import('../src/helpers.js').helpers} h
 * @param {number} lit the lit far wall, as a percentage of ink mixed into the ground
 * @param {number} shade the shaded near wall, likewise
 */
const press = (p, h, lit, shade) =>
  `${h.u(p.k)} ${h.u(p.k)} 0 ${h.mix('var(--fg)', 'var(--bg)', lit)},` +
  `${h.u(-1.6 * p.k)} ${h.u(-1.6 * p.k)} ${h.u(p.s)} ${h.mix('var(--fg)', 'var(--bg)', shade)}`

export default {
  id: 'retro-deboss',
  family: 'retro',
  shape: 'A',
  colors: 2,
  bg: 'light',
  odds: 3,
  fonts: {
    deny: ['hairline', 'inline', 'shaded', 'stencil'],
    prefer: ['fat', 'slab', 'sans', 'wide'],
  },
  palettes: { prefer: [] },
  // k = how deep the press is; s = how far the sheet rolls at the shaded wall. Both in u.
  params: { k: [0.3, 0.9, 0.3], s: [0.6, 1.8, 0.6] },

  /** @param {{k: number, s: number}} p */
  bleed: (p) => ({ t: 1.6 * p.k + p.s, r: p.k, b: p.k, l: 1.6 * p.k + p.s }),

  /**
   * @param {{k: number, s: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => `.n{text-shadow:${press(p, h, 20, 42)}}`,

  /**
   * Pressing harder deepens both tones without moving either, so the bleed is unchanged.
   *
   * @param {{k: number, s: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  hover: (p, h) => `text-shadow:${press(p, h, 28, 54)}`,

  motion: null,
}
