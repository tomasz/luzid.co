/**
 * Block extrusion: a solid ramp of hard shadow layers marching away from the face at one
 * of four diagonals, painted in the accent role so the wall reads as a second ink.
 *
 * Layer count scales with the depth so the ramp stays solid — a fixed count would show a
 * staircase on the diagonal edge at large depths — and is capped at the measured 64.
 * The bleed is the conservative full depth on each axis the angle points along, which is
 * what keeps the extrusion inside the safe box at every viewport.
 */
export default /** @satisfies {import("../src/types.js").Effect<{ d: number; a: number }>} */ ({
  id: "depth-extrude",
  shape: "A",
  colors: 3,
  bg: "any",
  odds: 6,
  fonts: { deny: ["script", "hairline"], prefer: ["fat"] },
  params: { d: [3, 9, 1], a: [45, 315, 90] },

  /**
   * @param {{d: number, a: number}} p
   * @param {import("../src/types.js").LineGeometry} _lines
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  bleed: (p, _lines, h) => h.toward(p.a, p.d),

  /**
   * @param {{d: number, a: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => `.n{text-shadow:${h.stack(h.layers(8 * p.d), p.a, p.d, "var(--a1)")}}`,

  hover: "filter:brightness(1.07)",
});
