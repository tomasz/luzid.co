/**
 * Shaded-ramp extrusion: the same solid wall as `depth-extrude`, but lit — each layer is
 * a little further toward the ground colour than the one in front of it, so the wall
 * carries a tonal falloff instead of reading as one flat slab.
 *
 * The ramp runs toward `--bg` rather than toward black (which an effect cannot spell) or
 * toward a second accent (which would need a 4-colour role set and would read as two inks
 * rather than one lit surface). Fading the far end into the ground is also the one
 * direction that works on both polarities: the wall keeps its full contrast against the
 * face, where legibility lives, and loses it into the distance, where it does not.
 *
 * `h.stack(1, …)` is called once per layer so that every length still comes out of a
 * helper and the trigonometry still happens in CSS; `h.stack` itself takes one colour for
 * the whole ramp, which is exactly what this effect is not.
 */

/**
 * `n` hard layers from the face out to `d` u at `a` degrees, `tint(t)` giving the colour
 * at fraction `t` of the way out. Nearest layer first, because the first-listed shadow
 * paints on top.
 *
 * @param {typeof import('../src/helpers.js').helpers} h
 * @param {number} n
 * @param {number} a
 * @param {number} d
 * @param {(t: number) => string} tint
 */
const ramp = (h, n, a, d, tint) =>
  Array.from({ length: n }, (_, i) => h.stack(1, a, (d * (i + 1)) / n, tint((i + 1) / n))).join(',')

/**
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
  id: 'depth-ramp',
  family: 'depth',
  shape: 'A',
  colors: 3,
  bg: 'any',
  odds: 4,
  fonts: { deny: ['hairline', 'script', 'shaded'], prefer: ['fat', 'slab'] },
  palettes: { prefer: [] },
  // `s` is the ramp strength: how much ground colour the far end has taken on, in percent.
  params: { d: [4, 10, 2], a: [45, 315, 90], s: [20, 60, 20] },

  /** @param {{d: number, a: number, s: number}} p */
  bleed: (p) => dir(p.a, p.d),

  /**
   * @param {{d: number, a: number, s: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => {
    const n = Math.min(64, Math.round(8 * p.d))
    const tint = (t) => (t === 0 ? 'var(--a1)' : h.mix('var(--bg)', 'var(--a1)', p.s * t))
    return `.n{text-shadow:${ramp(h, n, p.a, p.d, tint)}}`
  },

  hover: () => 'filter:brightness(1.06)',
  motion: null,
}
