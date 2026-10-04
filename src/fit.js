/**
 * The §5.2 fit literals, computed from build-time ink metrics so the browser does one
 * `min()` and nothing shifts. Numbers only: `render.js` turns them into CSS.
 */

/** @import { Fit, Metrics, Scene } from "./types.js" */

/** Shrink factor covering sub-pixel rounding and Safari's CoreText shaping differences. */
export const SAFETY = 0.985;

/**
 * `1u` = 1% of the fitted block width; `F_i` is the font-size divisor; `L_i` is the
 * line-height that puts each line's ink top exactly on its block top.
 *
 * @param {Scene} scene
 * @returns {Fit}
 */
export function fit(scene) {
  const { look, font, variant, file, effect, layout } = scene;
  const { w1, w2 } = variant;
  const [F1, F2] = layout.divisors(w1, w2);

  // ASC/DESC are the rounded values `scripts/sfnt.mjs` actually wrote, in em. The baseline
  // sits (L + ASC - DESC)/2 below the line top; setting that equal to top_i gives L_i.
  const upm = Number(font.upm ?? 0);
  const ASC = upm > 0 ? file.asc / upm : file.asc;
  const DESC = upm > 0 ? file.desc / upm : file.desc;
  const L1 = 2 * w1.top - ASC + DESC;
  const L2 = 2 * w2.top - ASC + DESC;

  // Line heights in block-width percent, i.e. in u.
  const h1 = (100 * w1.H) / F1;
  const h2 = (100 * w2.H) / F2;

  // The effect's bleed may depend on the metrics, and G depends on the bleed's top. Two
  // passes: bleed() sees G = g (the layout gap), css() sees the final G and R.
  /**
   * @param {number} G
   * @param {number} R
   * @returns {Metrics}
   */
  const metrics = (G, R) => ({
    fs: [100 / F1, 100 / F2],
    H: [h1, h2],
    top: [(100 * w1.top) / F1, (100 * w2.top) / F2],
    asc: [(100 * ASC) / F1, (100 * ASC) / F2],
    desc: [(100 * DESC) / F1, (100 * DESC) / F2],
    G,
    R,
    layout: look.l,
  });
  const provisional = metrics(look.g, (h1 + h2 + look.g) / 100);
  const declared = effect.bleed?.(look.params, provisional) ?? { t: 0, r: 0, b: 0, l: 0 };
  const bleed = {
    t: Math.max(0, Number(declared.t) || 0),
    r: Math.max(0, Number(declared.r) || 0),
    b: Math.max(0, Number(declared.b) || 0),
    l: Math.max(0, Number(declared.l) || 0),
  };

  // The gap has to clear ink travelling BOTH ways, because the two lines paint in tree
  // order: line 2's upward ink would cover line 1's glyphs, and line 2's glyphs would
  // cover line 1's downward ink. `bleed.t` alone only bought the first, so every effect
  // with a downward shade had to declare a top bleed it never painted into just to widen
  // the gap — dead space above line 1, measured at 3-7% of block width on a phone.
  // max() rather than t + b: the two lines' inks may meet in the gap, they just may not
  // reach the other line's glyphs, and the sum would cost real size for nothing.
  const G = Math.max(look.g, bleed.t, bleed.b);
  const R = (h1 + h2 + G) / 100;

  return {
    F1,
    F2,
    L1,
    L2,
    G,
    R,
    BH: 100 * R,
    Y2: h1 + G,
    K1: 1 + (bleed.l + bleed.r) / 100,
    K2: R + (bleed.t + bleed.b) / 100,
    DX: (bleed.l - bleed.r) / 2,
    DY: (bleed.t - bleed.b) / 2,
    bleed,
    m: metrics(G, R),
  };
}
