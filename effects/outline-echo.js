/**
 * Stacked outline echoes (R14): the solid word, and behind it two outlined copies marching
 * away on a diagonal, each one occluding the one behind it.
 *
 * The occlusion is the whole effect — without it this is three overlapping wireframes and
 * reads as noise. Each copy is therefore filled with `--bg` and stroked, with
 * `paint-order:stroke fill` so the fill covers the inner half of its own stroke: an opaque
 * hollow letter, not a see-through one. That also means no copy exposes the interior
 * contour seams of a variable font, so `overlap` does not have to be denied.
 *
 * Two copies is the ceiling, not a taste call: §5.1 fixes the DOM at two spans, so shape B
 * has exactly `::before` and `::after` to spend, and they are spent on the two echoes while
 * the real text stays the face. The second echo fades toward the ground so the ramp reads
 * as depth rather than as three equal words.
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
  id: 'outline-echo',
  family: 'outline',
  shape: 'B',
  colors: 3,
  bg: 'any',
  odds: 4,
  fonts: {
    deny: ['hairline', 'script', 'brush', 'connected', 'inline', 'shaded'],
    prefer: ['fat', 'sans'],
  },
  palettes: { prefer: [] },
  // R14: a .012-.03em stroke stepped .03-.08em per copy, converted at 1em = 100/W1 u
  // (24-33u for these faces). The top of that range was tried first and the screenshots
  // showed why it is the top: past ~2u the two trails tangle with the other line's and the
  // stack stops reading as one word echoing itself.
  params: { sw: [0.4, 0.8, 0.2], o: [1, 2, 0.25], q: [0, 3, 1] },

  /** @param {{sw: number, o: number, q: number}} p */
  bleed: (p) => {
    const [sx, sy] = DIR[p.q]
    const s = MITER * p.sw
    const far = 2 * p.o
    return {
      t: s + (sy < 0 ? far : 0),
      r: s + (sx > 0 ? far : 0),
      b: s + (sy > 0 ? far : 0),
      l: s + (sx < 0 ? far : 0),
    }
  },

  /**
   * @param {{sw: number, o: number, q: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => {
    const [sx, sy] = DIR[p.q]
    const far = h.mix('var(--a1)', 'var(--bg)', 45)
    return (
      `.l::before{content:attr(data-t) / "";color:var(--bg);` +
      `-webkit-text-stroke:${h.u(p.sw)} var(--a1);paint-order:stroke fill;` +
      `translate:${h.u(sx * p.o)} ${h.u(sy * p.o)};z-index:-1}` +
      `.l::after{content:attr(data-t) / "";color:var(--bg);` +
      `-webkit-text-stroke:${h.u(p.sw)} ${far};paint-order:stroke fill;` +
      `translate:${h.u(2 * sx * p.o)} ${h.u(2 * sy * p.o)};z-index:-2}`
    )
  },

  /** The house lift. The stack must not move: every copy's reach is already in the bleed. */
  hover: () => 'filter:brightness(1.06)',
  motion: null,
}
