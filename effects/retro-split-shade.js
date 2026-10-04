/**
 * Split shade: one solid extrusion whose colour changes part way down it, the way a sign
 * painter bands a shade so the wall reads as two planes. Typekit's lesson sandwiches a
 * pale band between two darker ones; three bands here do exactly that (a1 · a2 · a1) and
 * two bands give the plain two-tone version.
 *
 * The bands are one `text-shadow` list, so there is no extra DOM and nothing to align.
 * Layers go through `h.march()` rather than `h.stack()` because `stack()` paints one colour
 * and measures along an angle; `d` is therefore the per-axis offset, and the shade travels
 * `d`·√2 along the diagonal.
 *
 * Both angles point downward on purpose: an upward shade would have to be grouped behind
 * the text (§5.6) and would eat into the gap between the two lines.
 */

export default /** @satisfies {import("../src/types.js").Effect<{ a: number; b: number; d: number }>} */ ({
  id: "retro-split-shade",
  family: "retro",
  shape: "A",
  colors: 4,
  bg: "any",
  odds: 4,
  fonts: { deny: ["hairline", "inline", "shaded"], prefer: ["fat", "slab", "serif", "deco"] },
  palettes: { prefer: ["n4"] },
  params: { a: [45, 135, 90], b: [2, 3, 1], d: [2, 5, 1] },

  /**
   * Nothing is painted above the block: both angles fall, and R13 feeds `G` from `bleed.b`,
   * so the gap the shade needs is asked for on the side the shade is on.
   */
  bleed: (p, lines, h) => h.toward(p.a, p.d),

  css: (p, h) => {
    // ~12 layers per u of per-axis offset keeps the step under about 1.5 device px at the
    // widest viewport the fit produces, which is what makes the wall solid rather than combed.
    const n = h.layers(12 * p.d, 10);
    const bands = ["var(--a1)", "var(--a2)"];
    /** @param {number} i */
    const band = (i) =>
      /** @type {string} */ (bands[Math.min(p.b - 1, Math.floor(((i - 1) * p.b) / n)) % 2]);
    return `.n{text-shadow:${h.march(n, h.fall(p.a), 1, 0, p.d, band)}}`;
  },

  hover: "filter:saturate(1.16)",
  motion: null,
});
