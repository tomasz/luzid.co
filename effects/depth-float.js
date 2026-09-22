/**
 * Floating shadow: no wall, no offset copy — just two blurred layers pooled well below the
 * letters, so the name reads as hovering over the page. Height is spelled entirely by the
 * distance between the glyphs and their shadow, which is why `y` is the only real
 * parameter and why nothing else may paint.
 *
 * The effect cannot move the text to sell the levitation: `translate` on `.n` is the
 * renderer's (it carries the bleed centring), and the property allowlist keeps it that
 * way. Hover does the opposite instead — the shadow pulls in and darkens, so the name
 * settles onto the page under the pointer, which needs no extra bleed at all.
 *
 * `bg: 'light'`, for the same reason as `depth-cast`, and with the same small caveat: the
 * flag bounds the ground's luminance, not the ordering of `--fg` against `--bg`.
 *
 * The published height range is 0.15-0.4em and the blur 0.06-0.15em. A line fills the
 * block, so 1em lands near 25u: that is where `y` in [4, 10] and the derived radii come
 * from, and the soft radius is clamped to the measured 2.5u cap on top of it.
 */

/** Blur radius to painted reach: sigma is r/2, so 2r is a conservative bound. */
const SPREAD = 2

/** Measured cap on a blurred text-shadow radius, in u. */
const MAX_BLUR = 2.5

/** @param {number} y */
const tightBlur = (y) => Math.min(MAX_BLUR, y * 0.18)
/** @param {number} y */
const softBlur = (y) => Math.min(MAX_BLUR, y * 0.3)

export default {
  id: 'depth-float',
  family: 'depth',
  shape: 'A',
  colors: 2,
  bg: 'light',
  odds: 4,
  fonts: { deny: [], prefer: ['fat', 'rounded'] },
  palettes: { prefer: [] },
  // `y` is the hover height in u; `o` how much ink the shadow carries, in percent.
  params: { y: [4, 10, 2], o: [18, 42, 8] },

  /** @param {{y: number, o: number}} p */
  bleed: (p) => {
    const reach = SPREAD * softBlur(p.y)
    return { t: 0, r: reach, b: p.y + reach, l: reach }
  },

  /**
   * @param {{y: number, o: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) =>
    `.n{text-shadow:0 ${h.u(p.y * 0.35)} ${h.u(tightBlur(p.y))} ${h.mix('var(--fg)', 'var(--bg)', p.o)},` +
    `0 ${h.u(p.y)} ${h.u(softBlur(p.y))} ${h.mix('var(--fg)', 'var(--bg)', p.o * 0.65)}}`,

  /**
   * @param {{y: number, o: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  hover: (p, h) =>
    `text-shadow:0 ${h.u(p.y * 0.18)} ${h.u(tightBlur(p.y) * 0.7)} ${h.mix('var(--fg)', 'var(--bg)', p.o * 1.15)},` +
    `0 ${h.u(p.y * 0.5)} ${h.u(softBlur(p.y) * 0.7)} ${h.mix('var(--fg)', 'var(--bg)', p.o * 0.8)}`,
  motion: null,
}
