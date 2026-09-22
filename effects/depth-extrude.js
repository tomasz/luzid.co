/**
 * Block extrusion: a solid ramp of hard shadow layers marching away from the face at one
 * of four diagonals, painted in the accent role so the wall reads as a second ink.
 *
 * Layer count scales with the depth so the ramp stays solid — a fixed count would show a
 * staircase on the diagonal edge at large depths — and is capped at the measured 64.
 * The bleed is the conservative full depth on each axis the angle points along, which is
 * what keeps the extrusion inside the safe box at every viewport.
 */
export default {
  id: 'depth-extrude',
  family: 'depth',
  shape: 'A',
  colors: 3,
  bg: 'any',
  odds: 6,
  fonts: { deny: ['script', 'hairline'], prefer: ['fat'] },
  palettes: { prefer: [] },
  params: { d: [3, 9, 1], a: [45, 315, 90] },

  /** @param {{d: number, a: number}} p */
  bleed: (p) => ({
    t: p.a > 180 ? p.d : 0,
    r: p.a < 90 || p.a > 270 ? p.d : 0,
    b: p.a > 0 && p.a < 180 ? p.d : 0,
    l: p.a > 90 && p.a < 270 ? p.d : 0,
  }),

  /**
   * @param {{d: number, a: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => `.n{text-shadow:${h.stack(Math.min(64, Math.round(8 * p.d)), p.a, p.d, 'var(--a1)')}}`,

  hover: () => 'filter:brightness(1.07)',
  motion: null,
}
