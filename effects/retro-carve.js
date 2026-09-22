/**
 * Carved relief: opposing bevel tones with a coloured shadow down in the cut.
 *
 * The deboss with its two walls actually painted instead of one implied. A groove lit from
 * the top left has its far wall — down and right — catching the light and its near wall in
 * shade, so a pale hard rim goes below right and a strong hard rim above left; the eye
 * reads the pair as one gradient across the stroke, which is what tips the letter from
 * *shadowed* to *cut into something*.
 *
 * The accent then does the work Andy Clarke's far black shadow did, knocked back toward
 * the ground so it stays a shadow and not a second face — and thrown **up and left**, with
 * the shaded wall. A coloured shadow down and to the right would say the letter stands
 * proud of the surface, which is the opposite of the reading everything else here is
 * building; that conflict is what the first cut of this effect got wrong.
 *
 * `bg: 'light'` because all three tones have to be darker than the ground, and `colors: 3`
 * because the cut is genuinely painted in `--a1`. Deeper and harder than the deboss on
 * purpose: that one is a press into paper, this is cut into stone.
 */
export default {
  id: 'retro-carve',
  family: 'retro',
  shape: 'A',
  colors: 3,
  bg: 'light',
  odds: 3,
  fonts: {
    deny: ['hairline', 'inline', 'shaded', 'stencil'],
    prefer: ['serif', 'slab', 'fat', 'deco'],
  },
  palettes: { prefer: [] },
  // k = the width of the bevel; s = how soft the shadow in the cut is. Both in u.
  params: { k: [0.3, 0.9, 0.3], s: [0.6, 1.8, 0.6] },

  /**
   * The shadow in the cut travels up and left, so that is where the reach is — and `t` is
   * what keeps line 2's cut off line 1's glyphs. `1.5·s` and not `s` is R14: a blur radius
   * is a Gaussian diameter hint, so the ink reaches about one and a half radii. The rule
   * is written for `drop-shadow()`, but `text-shadow` defines its radius the same way and
   * the tail is the same tail.
   *
   * The bottom and the right are not just the lit bevel for the same reason as the emboss:
   * at the shallow end of `k` with the softest `s`, the shadow's tail reaches back across
   * the glyph and out the far side.
   *
   * @param {{k: number, s: number}} p
   */
  bleed: (p) => ({
    t: 2.4 * p.k + 1.5 * p.s,
    r: Math.max(p.k, 1.5 * p.s - 2.2 * p.k),
    b: Math.max(p.k, 1.5 * p.s - 2.4 * p.k),
    l: 2.2 * p.k + 1.5 * p.s,
  }),

  /**
   * @param {{k: number, s: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) =>
    `.n{text-shadow:${h.u(p.k)} ${h.u(p.k)} 0 ${h.mix('var(--fg)', 'var(--bg)', 16)},` +
    `${h.u(-p.k)} ${h.u(-p.k)} 0 ${h.mix('var(--fg)', 'var(--bg)', 58)},` +
    `${h.u(-2.2 * p.k)} ${h.u(-2.4 * p.k)} ${h.u(p.s)} ${h.mix('var(--a1)', 'var(--bg)', 46)}}`,

  hover: () => 'filter:contrast(1.06)',
  motion: null,
}
