/**
 * Comic panel lettering (R22): a bright face, a heavy dark keyline around it, and one hard
 * copy dropped down-left or down-right.
 *
 * The shadow is a single `text-shadow` layer, and CSS says a shadow silhouettes the text
 * "including any text stroke" — so the dropped copy is already fattened by `sw/2` and lines
 * up with the keyline instead of peeking out from under it. That is also why the bleed adds
 * the stroke allowance to the offset rather than taking the offset alone.
 *
 * `paint-order:stroke fill` keeps the face at full weight with the keyline outside it. The
 * face is `--a1`, and §5.4 guarantees nothing about `--a1` on `--bg`, so the `--fg` keyline
 * is what carries legibility here: it is the darkest-against-ground role the engine has,
 * it surrounds every stem, and it is why `sw` never drops below ~1.2u.
 *
 * R22 also asks for rotate and skew. §5.6 allows neither on `.n` — only pseudo-elements may
 * transform — and the tilt would have to be paid for twice over in bleed at every viewport.
 * Dropped deliberately: the ink does the shouting.
 */

/** Down-right and down-left. The drop always falls, so only the x sign is drawn. */
const DIR = [1, -1]

/** Outward allowance per unit of stroke width; see `outline-hollow.js` for the derivation. */
const MITER = 0.8

/** Hover presses the letters toward their shadow, to this fraction of the offset. */
const PRESS = 0.45

export default {
  id: 'outline-comic',
  family: 'outline',
  shape: 'A',
  colors: 3,
  bg: 'any',
  odds: 4,
  fonts: {
    deny: ['hairline', 'script', 'brush', 'connected', 'inline', 'shaded', 'stencil'],
    prefer: ['fat', 'deco', 'sans'],
  },
  palettes: { prefer: [] },
  // R22: a .04-.1em keyline with the drop .05-.14em away, at 1em = 100/W1 u (24-33u here).
  // `sw` never goes below 1.2u because the keyline is what carries legibility.
  params: { sw: [1.2, 2.4, 0.4], d: [1.5, 3.5, 0.5], q: [0, 1, 1] },

  /** @param {{sw: number, d: number, q: number}} p */
  bleed: (p) => {
    const sx = DIR[p.q]
    const s = MITER * p.sw
    return { t: s, r: s + (sx > 0 ? p.d : 0), b: s + p.d, l: s + (sx < 0 ? p.d : 0) }
  },

  /**
   * @param {{sw: number, d: number, q: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => {
    const sx = DIR[p.q]
    return (
      `.n{color:var(--a1);-webkit-text-stroke:${h.u(p.sw)} var(--fg);paint-order:stroke fill;` +
      `text-shadow:${h.u(sx * p.d)} ${h.u(p.d)} 0 var(--fg)}`
    )
  },

  /**
   * The panel gets punched: the shadow shortens instead of the letters moving, because a
   * `translate` on `.n` would overwrite the fit's own centring translate (and, under
   * `side`, its 90° rotate).
   *
   * @param {{sw: number, d: number, q: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  hover: (p, h) => {
    const sx = DIR[p.q]
    return `text-shadow:${h.u(PRESS * sx * p.d)} ${h.u(PRESS * p.d)} 0 var(--fg)`
  },
  motion: null,
}
