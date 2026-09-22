/**
 * The universal fallback. It fits every font, every palette and every layout, it is never
 * denied, and it adds no ink beyond the glyphs — which is what makes the one-pass sampler
 * in `src/pick.js` provably terminate.
 *
 * It is also half of QA mask mode: `?p=qa-bw&e=plain` renders black on white with no
 * effect, which is what the fit pixel scan measures.
 */
export default {
  id: 'plain',
  family: 'plain',
  shape: 'A',
  colors: 2,
  bg: 'any',
  odds: 4,
  fonts: { deny: [], prefer: [] },
  palettes: { prefer: [] },
  params: {},
  bleed: () => ({ t: 0, r: 0, b: 0, l: 0 }),
  css: () => '',
  hover: null,
  motion: null,
}
