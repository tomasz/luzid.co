/**
 * Long shadow: the flat-design wedge that runs off one corner of the letters and dissolves
 * into the ground. Same primitive as the extrusion, but far longer and ramped all the way
 * to `--bg`, so it has no far edge at all — it simply stops being visible.
 *
 * Two measured limits shape it. Hard shadow layers are capped at 64, and the per-layer
 * step has to stay near a device pixel or the diagonal silhouette turns into a sawtooth;
 * at 64 layers that puts the honest ceiling on `d` at around 20u, which is where the
 * range ends. The published recipe says not to reserve the tail and let the viewport clip
 * it — this engine's bleed contract says the opposite, so the full length is reserved on
 * both axes the angle points along and the name pays for it in size.
 *
 * Only the two downward diagonals are drawn. An upward shadow this long would trip the
 * §5.6 rule that anything reaching more than ~10u up has to paint as a group, and it
 * would push `G` — the gap between the two lines — out to the full shadow length, which
 * pulls the name apart for no gain.
 */

/**
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

/** The measured cap. The ramp always spends all of it: the step size is the artefact. */
const LAYERS = 64

export default {
  id: 'depth-long',
  family: 'depth',
  shape: 'A',
  colors: 3,
  bg: 'any',
  odds: 3,
  fonts: { deny: ['hairline', 'script', 'shaded'], prefer: ['fat', 'sans'] },
  palettes: { prefer: [] },
  params: { d: [8, 20, 4], a: [45, 135, 90] },

  /** @param {{d: number, a: number}} p */
  bleed: (p) => dir(p.a, p.d),

  /**
   * @param {{d: number, a: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => {
    // Quadratic, not linear: the body of the wedge stays solid and the dissolve happens
    // over the outer third. A linear fade spends most of the reserved bleed on ink too
    // close to the ground to see, which leaves the name sitting off-centre in its own box.
    // `t * t` is exact in binary floating point, so the emitted CSS stays byte-stable.
    const tint = (t) => (t === 0 ? 'var(--a1)' : h.mix('var(--bg)', 'var(--a1)', 100 * t * t))
    return `.n{text-shadow:${ramp(h, LAYERS, p.a, p.d, tint)}}`
  },

  hover: () => 'filter:brightness(1.05)',
  motion: null,
}
