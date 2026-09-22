/**
 * Hard drop shade: one offset copy of the face, no ramp and no blur — the oldest trick in
 * sign painting and the cheapest effect in the family (a single shadow layer).
 *
 * The eight compass directions are all allowed because a single copy reads as deliberate
 * from any of them, unlike an extrusion, which only looks like a solid on a diagonal. `d`
 * stays inside the published 0.03-0.12em: a line fills the block, so 1em lands near 25u
 * and anything past ~3u stops reading as a shade and starts reading as a second word. The
 * bleed reserves the full distance on each axis the angle points along rather than its
 * cosine: that over-reserves by ~30% on the diagonals and needs no trigonometry in JS,
 * which would make the emitted CSS depend on the engine that computed it.
 *
 * On hover the shade pushes out to 1.35x: one layer is cheap enough to interpolate, and
 * the bleed below is declared against the hovered distance, not the resting one.
 */

/** How far the shade travels on hover, as a multiple of `d`. */
const LIFT = 1.35

/**
 * Axis-aligned bound for a shadow of length `d` at `a` degrees (0 = right, 90 = down).
 * @param {number} a
 * @param {number} d
 */
const dir = (a, d) => ({
  t: a > 180 ? d : 0,
  r: a < 90 || a > 270 ? d : 0,
  b: a > 0 && a < 180 ? d : 0,
  l: a > 90 && a < 270 ? d : 0,
})

export default {
  id: 'depth-drop',
  family: 'depth',
  shape: 'A',
  colors: 3,
  bg: 'any',
  odds: 5,
  fonts: { deny: ['hairline', 'shaded'], prefer: ['fat', 'deco'] },
  palettes: { prefer: [] },
  params: { d: [1, 3, 0.5], a: [0, 315, 45] },

  /** @param {{d: number, a: number}} p */
  bleed: (p) => dir(p.a, p.d * LIFT),

  /**
   * @param {{d: number, a: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => `.n{text-shadow:${h.stack(1, p.a, p.d, 'var(--a1)')}}`,

  /**
   * @param {{d: number, a: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  hover: (p, h) => `text-shadow:${h.stack(1, p.a, p.d * LIFT, 'var(--a1)')}`,
  motion: null,
}
