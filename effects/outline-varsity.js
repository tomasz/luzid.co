/**
 * Concentric varsity rings (recipe 19): the athletic double outline — ink face, a
 * ground-coloured keyline holding it off the field, then a wider accent ring around both.
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

/** The hover drop's offset and blur, as fractions of the outer ring's width `w2`. */
const DROP = 0.8;
const BLUR = 0.6;

export default /** @satisfies {import("../src/types.js").Effect<{ w1: number; x: number }>} */ ({
  id: "outline-varsity",
  shape: "B",
  colors: 3,
  bg: "any",
  fonts: {
    deny: ["hairline", "script", "brush", "connected", "inline", "shaded", "stencil"],
    prefer: ["fat", "slab", "sans"],
  },
  // Recipe 19's .04-.08em inner and .1-.18em outer ring, at 1em = 100/W1 u (24-33u for
  // these faces), expressed as the inner width plus the step out to the outer one.
  params: { w1: [1, 2, 0.5], x: [1, 2.5, 0.5] },

  /**
   * The rings are concentric, so at rest they reach `h.OUTSET·w2` on every side. The hover
   * drop, which §5.6 counts as painted ink like any other, shadows the whole patch: its
   * blur reaches `h.REACH·BLUR·w2` (R14) out from the rings on the left, right and below,
   * plus the `DROP·w2` offset below. That blur never climbs back past its own offset, so
   * the top keeps the rings' reach alone. The drop is sized off `w2` so the patch lifts by
   * the same fraction of its own rings at either end of the range — a drop sized in flat u
   * was invisible at `w2`'s minimum when I looked at it.
   *
   * @param {{w1: number, x: number}} p
   * @param {import("../src/types.js").LineGeometry} lines
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  bleed: (p, lines, h) => {
    const w2 = p.w1 + p.x;
    const s = h.OUTSET * w2;
    const tail = h.REACH * BLUR * w2;
    return { t: s, r: s + tail, b: s + DROP * w2 + tail, l: s + tail };
  },

  /**
   * @param {{w1: number, x: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => {
    const w2 = p.w1 + p.x;
    return (
      h.copy("before", `color:var(--bg);-webkit-text-stroke:${h.u(p.w1)} var(--bg);z-index:-1`) +
      h.copy("after", `color:var(--a1);-webkit-text-stroke:${h.u(w2)} var(--a1);z-index:-2`)
    );
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
    const w2 = p.w1 + p.x;
    return `filter:drop-shadow(0 ${h.u(DROP * w2)} ${h.u(BLUR * w2)} ${h.mix("var(--fg)", "var(--bg)", 55)})`;
  },
});
