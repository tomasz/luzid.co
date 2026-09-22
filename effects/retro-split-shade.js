/**
 * Split shade: one solid extrusion whose colour changes part way down it, the way a sign
 * painter bands a shade so the wall reads as two planes. Typekit's lesson sandwiches a
 * pale band between two darker ones; three bands here do exactly that (a1 · a2 · a1) and
 * two bands give the plain two-tone version.
 *
 * The bands are one `text-shadow` list, so there is no extra DOM and nothing to align.
 * Layers march along a unit diagonal rather than through `h.stack()` because a band needs
 * a *sub-range* of the ramp and `stack()` only ever starts at the face; `d` is therefore
 * the per-axis offset, and the shade travels `d`·√2 along the diagonal.
 *
 * Both angles point downward on purpose: an upward shade would have to be grouped behind
 * the text (§5.6) and would eat into the gap between the two lines.
 */

/** Horizontal sign per angle. CSS shadow axes are y-down, so both of these fall. */
const SX = { 45: 1, 135: -1 }

export default {
  id: 'retro-split-shade',
  family: 'retro',
  shape: 'A',
  colors: 4,
  bg: 'any',
  odds: 4,
  fonts: { deny: ['hairline', 'inline', 'shaded'], prefer: ['fat', 'slab', 'serif', 'deco'] },
  palettes: { prefer: ['n4'] },
  params: { a: [45, 135, 90], b: [2, 3, 1], d: [2, 5, 1] },

  /**
   * Nothing is painted above the block: both angles fall, and R13 feeds `G` from `bleed.b`,
   * so the gap the shade needs is asked for on the side the shade is on.
   *
   * @param {{a: number, b: number, d: number}} p
   */
  bleed: (p) => ({
    t: 0,
    r: p.a === 45 ? p.d : 0,
    b: p.d,
    l: p.a === 135 ? p.d : 0,
  }),

  /**
   * @param {{a: number, b: number, d: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => {
    const sx = SX[p.a] ?? 1
    // ~12 layers per u of per-axis offset keeps the step under about 1.5 device px at the
    // widest viewport the fit produces, which is what makes the wall solid rather than combed.
    const n = Math.min(64, Math.max(10, Math.round(12 * p.d)))
    const bands = ['var(--a1)', 'var(--a2)']
    const out = []
    for (let i = 1; i <= n; i++) {
      const k = (p.d * i) / n
      const band = Math.min(p.b - 1, Math.floor(((i - 1) * p.b) / n))
      out.push(`${h.u(sx * k)} ${h.u(k)} 0 ${bands[band % 2]}`)
    }
    return `.n{text-shadow:${out.join(',')}}`
  },

  hover: () => 'filter:saturate(1.16)',
  motion: null,
}
