/**
 * Isometric two-tone block: the sign-painter's close shade. Two interleaved staircases of
 * hard layers — one stepping down then across, the other across then down — so the block
 * behind the face splits into a bottom facet in `--a1` and a side facet in `--a2` instead
 * of reading as one wall.
 *
 * That split is the whole effect, so it genuinely needs a 4-colour role set: derived
 * shades of one accent would make the two facets differ only in tone, which is
 * `depth-ramp`. Because both facets are axis-aligned staircases, every offset is a plain
 * multiple of one step and goes through `h.u()` — no trigonometry anywhere.
 *
 * Layer budget: 2 per step, so the step count is capped at 32 to stay inside the measured
 * 64. A close shade is close: the published range is 0.03-0.12em total, and one line fills
 * the block, so 1em lands near 25u and `d` stops at 2.5u. At 12 steps per u the individual
 * stair is about a device pixel, which is what keeps the two facets reading as facets.
 */

/** Steps per u of depth, before the cap. 12 keeps the step near one device pixel. */
const DENSITY = 12

/** Half the measured 64-layer cap: this effect emits two layers per step. */
const STEPS = 32

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
  id: 'depth-iso',
  family: 'depth',
  shape: 'A',
  colors: 4,
  bg: 'any',
  odds: 4,
  fonts: { deny: ['script', 'brush', 'hairline', 'shaded'], prefer: ['fat', 'slab'] },
  palettes: { prefer: [] },
  params: { d: [1, 2.5, 0.5], a: [45, 315, 90] },

  /** @param {{d: number, a: number}} p */
  bleed: (p) => dir(p.a, p.d),

  /**
   * @param {{d: number, a: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => {
    const sx = p.a === 45 || p.a === 315 ? 1 : -1
    const sy = p.a === 45 || p.a === 135 ? 1 : -1
    const n = Math.min(STEPS, Math.max(4, Math.round(DENSITY * p.d)))
    const s = p.d / n
    const out = []
    for (let i = 1; i <= n; i++) {
      out.push(`${h.u(sx * (i - 1) * s)} ${h.u(sy * i * s)} 0 var(--a1)`)
      out.push(`${h.u(sx * i * s)} ${h.u(sy * (i - 1) * s)} 0 var(--a2)`)
    }
    return `.n{text-shadow:${out.join(',')}}`
  },

  hover: () => 'filter:brightness(1.06)',
  motion: null,
}
