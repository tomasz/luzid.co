/**
 * The keyline that missed its register (R15): a solid face, and a stroked copy of the same
 * word sitting a hair off it, the way a second plate lands when the sheet has shifted.
 *
 * The copy is a real shape-B `::after` rather than a shadow because a shadow is a filled
 * silhouette — there is no way to get an unfilled one out of `text-shadow` at a single
 * offset. `-webkit-text-fill-color:transparent` is what makes it a keyline instead of a
 * duplicate, and the stroke stays centred on the contour (no `paint-order`), because a
 * misregistered plate prints its whole line, not the outside half of it.
 *
 * That transparent fill is exactly the case §5.5's `overlap` trait exists for: seen through
 * an unfilled stroke, a pinned variable font shows the seams where its contours overlap. So
 * `overlap` is denied here, and so are the hairline and script-like faces whose joins a
 * second stroked pass would close up.
 *
 * Both colours stay honest: the face keeps `--fg`, so the name reads at the engine's
 * guaranteed 3:1 whatever the accent does. The keyline is decoration on top of that.
 */

/** The four diagonals as exact ±1 pairs. No trig, so no golden can depend on `Math.cos`. */
const DIR = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
]

/** Outward allowance per unit of stroke width; see `outline-hollow.js` for the derivation. */
const MITER = 0.8

export default {
  id: 'outline-misprint',
  family: 'outline',
  shape: 'B',
  colors: 3,
  bg: 'any',
  odds: 4,
  fonts: {
    deny: ['overlap', 'hairline', 'script', 'brush', 'connected', 'inline', 'shaded'],
    prefer: ['fat', 'sans', 'slab'],
  },
  palettes: { prefer: [] },
  // R15: a .008-.025em keyline offset .02-.08em. 1em is 24-33u here (1em = 100/W1 u), so a
  // misregistration this small stays a misregistration and never becomes a second word.
  params: { sw: [0.3, 0.9, 0.2], o: [0.8, 2, 0.4], q: [0, 3, 1] },

  /** @param {{sw: number, o: number, q: number}} p */
  bleed: (p) => {
    const [sx, sy] = DIR[p.q]
    const s = MITER * p.sw
    return {
      t: s + (sy < 0 ? p.o : 0),
      r: s + (sx > 0 ? p.o : 0),
      b: s + (sy > 0 ? p.o : 0),
      l: s + (sx < 0 ? p.o : 0),
    }
  },

  /**
   * @param {{sw: number, o: number, q: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => {
    const [sx, sy] = DIR[p.q]
    return (
      `.l::after{content:attr(data-t) / "";-webkit-text-fill-color:transparent;` +
      `-webkit-text-stroke:${h.u(p.sw)} var(--a1);` +
      `translate:${h.u(sx * p.o)} ${h.u(sy * p.o)}}`
    )
  },

  /**
   * Hover inks the missed plate in: a filled ghost of the same word at the same offset, so
   * the keyline stops being empty. It adds no reach the bleed did not already budget, and
   * it leaves the face `--fg` — a hover state must not trade away the guaranteed contrast.
   */
  hover: (p, h) => {
    const [sx, sy] = DIR[p.q]
    return `text-shadow:${h.u(sx * p.o)} ${h.u(sy * p.o)} 0 ${h.mix('var(--a1)', 'var(--bg)', 40)}`
  },
  motion: null,
}
