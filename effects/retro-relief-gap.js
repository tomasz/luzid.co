/**
 * Sign-painter inline shade: a channel of bare background separates the face from its drop
 * shade, so the letter reads as a plate applied to the wall rather than printed on it.
 *
 * R09 as published paints `color` + a background-coloured `-webkit-text-stroke` +
 * `paint-order:stroke fill` + `text-shadow` on one element, and produces no channel at
 * all: with `paint-order` the engine runs the stroke pass first and then the fill pass
 * *with the fill's own shadow layers over it*, so the extrusion covers the very ring it is
 * meant to be held off by. The browser spike recorded two verified fixes. This is Fix B —
 * the shade moves to a `::before` copy behind the face (`z-index:-1`) and carries the
 * whole stack, while the face keeps the background-coloured stroke.
 *
 * Fix A (face unchanged, extrusion as a `filter:drop-shadow` chain) is equally correct but
 * was not used: §5.6 caps the chain at four passes, and four binary-doubling passes are 16
 * copies, which is too coarse a comb for a shade this deep at viewport size.
 *
 * The copy is stroked in the shade colour at the same width, so its silhouette matches the
 * face's stroked silhouette exactly and the channel comes out uniform on every side. Both
 * fixes only read as carved on a flat ground the colour of `--bg`, which v1.0 always has.
 */
export default {
  id: 'retro-relief-gap',
  family: 'retro',
  shape: 'B',
  colors: 3,
  bg: 'any',
  odds: 5,
  fonts: { deny: ['hairline', 'inline', 'shaded', 'stencil'], prefer: ['fat', 'slab', 'deco'] },
  palettes: { prefer: [] },
  // d = shade distance along the angle; g = channel width (half the stroke, which is
  // centred on the outline); a = the two sign-painter diagonals, both downward.
  params: { a: [45, 135, 90], d: [3, 6, 1], g: [0.3, 1.2, 0.3] },

  /**
   * The only ink above the block top is the stroke ring, which is half of the stroke width
   * — `p.g` — on every side. Everything else falls: both angles are downward, and R13 now
   * feeds `G` from `bleed.b` as well, so the gap the shade needs is asked for where the
   * shade actually is.
   *
   * `h.stack()` measures its distance along the angle, so the reach on each axis is
   * `d·cos45`, not `d`. That is exact rather than conservative on purpose: `b` now sets
   * the line gap as well as the safe box, so rounding it up would cost size twice.
   *
   * @param {{a: number, d: number, g: number}} p
   */
  bleed: (p) => {
    const q = Math.SQRT1_2 * p.d
    return {
      t: p.g,
      r: (p.a === 45 ? q : 0) + p.g,
      b: q + p.g,
      l: (p.a === 135 ? q : 0) + p.g,
    }
  },

  /**
   * @param {{a: number, d: number, g: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => {
    const n = Math.min(64, Math.max(12, Math.round(10 * p.d)))
    const sw = h.u(2 * p.g)
    return (
      `.n{-webkit-text-stroke:${sw} var(--bg);paint-order:stroke fill}` +
      `.l::before{content:attr(data-t) / "";z-index:-1;color:var(--a1);` +
      `-webkit-text-stroke:${sw} var(--a1);text-shadow:${h.stack(n, p.a, p.d, 'var(--a1)')}}`
    )
  },

  hover: () => 'filter:brightness(1.06)',
  motion: null,
}
