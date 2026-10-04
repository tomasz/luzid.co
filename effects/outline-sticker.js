/**
 * Die-cut sticker (recipe 20): a thick paper border around the letters, lifted off the page
 * by one soft drop.
 *
 * There is no white role to cut the paper from — §5.4 hands out a ground, an ink and up to
 * two accents, and any of them can be the dark one. So the paper is mixed: the ground
 * carried 30% of the way toward the ink. That is far enough to draw a visible cut edge on
 * any palette in the catalog, light or dark, and near enough to the ground to still read as
 * paper rather than as a second ink. A plain `--bg` border was the first try and it is
 * invisible: on a flat ground the die cut simply is not there, which the first pass over
 * the seven effects showed immediately.
 *
 * The thick stroke is safe because of `paint-order:stroke fill`: the stroke paints under
 * the fill, so what survives inside a counter is the paper colour, a shade off the ground.
 * Unlike an ink keyline, a wide paper stroke never closes the counters of `a`, `o` or `d`
 * or fills in the bar of `ł` — it only fattens the outside silhouette, which is the
 * "outlines merge into one blob" that makes a sticker a sticker.
 *
 * Two roles (`--fg` face, `--bg` ground, mixes of the two for paper and shade), so this one
 * fits every palette in the catalog and the face keeps the guaranteed 3:1 contrast.
 */

/** Hover grows the drop by this much: the sticker lifts further off the page. */
const LIFT = 1.5;

export default /** @satisfies {import("../src/types.js").Effect<{ sw: number; dy: number }>} */ ({
  id: "outline-sticker",
  shape: "A",
  colors: 2,
  bg: "any",
  odds: 5,
  fonts: {
    deny: ["hairline", "script", "brush", "connected", "inline", "shaded", "stencil"],
    prefer: ["fat", "rounded", "soft"],
  },
  // Recipe 20: a .08-.2em paper border over a .02-.06em drop, at 1em = 100/W1 u (24-33u).
  params: { sw: [3, 5, 0.5], dy: [0.6, 1.4, 0.4] },

  /**
   * The paper reaches `h.OUTSET·sw` on every side, and the drop shadows the papered
   * silhouette, so its reach starts from there. The drop is measured at its hover size, per
   * §5.6: bleed bounds all painted ink, hover included. Its blur reaches `h.REACH` times
   * its radius (R14), a little past its own offset, so a sliver of it shows above too.
   *
   * @param {{sw: number, dy: number}} p
   * @param {import("../src/types.js").LineGeometry} lines
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  bleed: (p, lines, h) => {
    const s = h.OUTSET * p.sw;
    const drop = LIFT * p.dy;
    const tail = h.REACH * drop;
    return { t: s + tail - drop, r: s + tail, b: s + drop + tail, l: s + tail };
  },

  /**
   * @param {{sw: number, dy: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => {
    const paper = h.mix("var(--fg)", "var(--bg)", 30);
    const shade = h.mix("var(--fg)", "var(--bg)", 45);
    return (
      `.n{-webkit-text-stroke:${h.u(p.sw)} ${paper};paint-order:stroke fill;` +
      `filter:drop-shadow(0 ${h.u(p.dy)} ${h.u(p.dy)} ${shade})}`
    );
  },

  /**
   * @param {{sw: number, dy: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  hover: (p, h) => {
    const shade = h.mix("var(--fg)", "var(--bg)", 45);
    return `filter:drop-shadow(0 ${h.u(LIFT * p.dy)} ${h.u(LIFT * p.dy)} ${shade})`;
  },
});
