/**
 * The poster classic (recipe 16): a hollow face, a keyline around it, one solid offset copy.
 *
 * The face is painted in the *ground* colour rather than left transparent. With
 * `paint-order:stroke fill` the fill covers the inner half of the stroke, which keeps the
 * letterform's weight, hides the interior contour seams a variable font still shows under
 * a see-through stroke (google/fonts#4212) — so this one needs no `overlap` deny — and,
 * the reason it matters most here, stops the offset copy showing *through* the counters.
 * A genuinely transparent face would park the whole hard shadow inside every letter.
 *
 * Legibility rides on the stroke, not on the face: `--fg` on `--bg` is the only pair the
 * engine guarantees at 3:1, so the keyline is `--fg` and the accent is spent on the shadow.
 *
 * The stroke is centred on the contour, so half of it lies outside the glyph and half is
 * eaten back by the fill. The bleed budgets `h.OUTSET` (the full width), not the half:
 * Chromium and WebKit miter the joins, `stroke-linejoin` is not on the §5.6 allowlist, and
 * a sharp apex spikes well past `sw/2`. Widths stop at 1.6u because at this size a wider
 * ink keyline starts to close the counters of `a`, `o` and `d` and to pinch the bar of
 * `ł`, which is also why `hairline` and the script-like traits are denied outright.
 */

export default /** @satisfies {import("../src/types.js").Effect<{ sw: number; d: number; q: number }>} */ ({
  id: "outline-hollow",
  shape: "A",
  colors: 3,
  bg: "any",
  odds: 5,
  fonts: {
    deny: ["hairline", "script", "brush", "connected", "inline", "shaded"],
    prefer: ["fat", "sans"],
  },
  // Recipe 16 asks for a .02-.06em stroke and copies .04-.12em apart. 1em is 100/W1 u,
  // and W1 (the ink width of "Tomasz") runs ~3-4.25em on the display faces this keeps, so
  // 1em is 24-33u and those ranges are below. Shorter than a shadow, longer than a seam.
  params: { sw: [0.6, 1.6, 0.25], d: [1.5, 3.5, 0.5], q: [0, 3, 1] },

  /**
   * @param {{sw: number, d: number, q: number}} p
   * @param {import("../src/types.js").LineGeometry} lines
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  bleed: (p, lines, h) => {
    const [sx, sy] = /** @type {import("../src/types.js").Pair} */ (h.QUAD[p.q]);
    const s = h.OUTSET * p.sw;
    return {
      t: s + (sy < 0 ? p.d : 0),
      r: s + (sx > 0 ? p.d : 0),
      b: s + (sy > 0 ? p.d : 0),
      l: s + (sx < 0 ? p.d : 0),
    };
  },

  /**
   * @param {{sw: number, d: number, q: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => {
    const [sx, sy] = /** @type {import("../src/types.js").Pair} */ (h.QUAD[p.q]);
    return (
      `.n{color:var(--bg);-webkit-text-stroke:${h.u(p.sw)} var(--fg);paint-order:stroke fill;` +
      `text-shadow:${h.u(sx * p.d)} ${h.u(sy * p.d)} 0 var(--a1)}`
    );
  },

  /** The hole fills with ink: face and keyline become one solid letter over the shadow. */
  hover: "color:var(--fg)",
});
