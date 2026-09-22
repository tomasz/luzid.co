/**
 * Concentric varsity rings (R19): the athletic double outline — ink face, a ground-coloured
 * keyline holding it off the field, then a wider accent ring around both.
 *
 * Built from two shape-B copies behind the face, each one filled *and* stroked in the same
 * colour. That is the trick that keeps it seam-free: a copy whose fill matches its stroke
 * is one solid blob fattened by `sw/2`, so nothing shows through it — no transparent fill,
 * no `paint-order` needed, and no reason to deny `overlap`. Stacking two of them, the wider
 * one further back, leaves two clean concentric bands of `w1/2` and `(w2−w1)/2`.
 *
 * `w2 = w1 + x` by construction, so the outer ring can never be drawn inside the inner one
 * however the parameter axes are drawn. Widths are held under ~4.5u because
 * `-webkit-text-stroke` is mitered in Chromium and `stroke-linejoin` is not on the §5.6
 * allowlist: past that, pointed apexes grow visible spikes rather than a round varsity edge.
 *
 * Contrast is unaffected — the face keeps `--fg` on `--bg` and the rings sit outside it.
 */

/** Outward allowance per unit of stroke width; see `outline-hollow.js` for the derivation. */
const MITER = 0.8

export default {
  id: 'outline-varsity',
  family: 'outline',
  shape: 'B',
  colors: 3,
  bg: 'any',
  odds: 4,
  fonts: {
    deny: ['hairline', 'script', 'brush', 'connected', 'inline', 'shaded', 'stencil'],
    prefer: ['fat', 'slab', 'sans'],
  },
  palettes: { prefer: [] },
  // R19's .04-.08em inner and .1-.18em outer ring, at 1em = 100/W1 u (24-33u for these
  // faces), expressed as the inner width plus the step out to the outer one.
  params: { w1: [1, 2, 0.5], x: [1, 2.5, 0.5] },

  /**
   * The rings are concentric, so the reach is the same on every side. The extra below is
   * the hover drop, which §5.6 counts as painted ink like any other: `0.8·w2` of offset
   * plus a blur of `0.6·w2`, budgeted at 1.5× the radius because that is where a Gaussian
   * of σ = radius/2 actually stops painting. Sized off `w2` so the patch lifts by the same
   * fraction of its own rings at either end of the range — a drop sized in flat u was
   * invisible at `w2`'s minimum when I looked at it.
   *
   * @param {{w1: number, x: number}} p
   */
  bleed: (p) => {
    const w2 = p.w1 + p.x
    const s = MITER * w2
    return { t: s, r: s, b: 1.7 * w2, l: s }
  },

  /**
   * @param {{w1: number, x: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => {
    const w2 = p.w1 + p.x
    return (
      `.l::before{content:attr(data-t) / "";color:var(--bg);` +
      `-webkit-text-stroke:${h.u(p.w1)} var(--bg);z-index:-1}` +
      `.l::after{content:attr(data-t) / "";color:var(--a1);` +
      `-webkit-text-stroke:${h.u(w2)} var(--a1);z-index:-2}`
    )
  },

  /**
   * One drop under the whole patch, so it lifts off the field as a unit. `filter` on `.n`
   * composites the face and both rings first, which a `text-shadow` could not do — that
   * paints with the face, above the negative-z-index copies.
   *
   * @param {{w1: number, x: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  hover: (p, h) => {
    const w2 = p.w1 + p.x
    return `filter:drop-shadow(0 ${h.u(0.8 * w2)} ${h.u(0.6 * w2)} ${h.mix('var(--fg)', 'var(--bg)', 55)})`
  },
  motion: null,
}
