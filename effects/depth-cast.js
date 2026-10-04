/**
 * Extrusion plus a ground shadow: a solid accent wall on one of the two downward
 * diagonals, and under it two blurred layers that pool straight down, so the block reads
 * as an object standing on a surface rather than a flat sticker.
 *
 * `bg: 'light'` is not decoration. The cast shadow is the only thing here that has to be
 * *darker than the ground*, and the only darker colour an effect can spell without
 * literals is a mix of the ink into the ground — which is darker only when the ground is
 * the light role. On a dark role set this same mix would come out as a glow.
 *
 * `bg: 'light'` is a threshold on the ground's own luminance, though, not a promise that
 * `--fg` is darker than `--bg`: about 3% of the light role sets in `wada1` put a very
 * light ink on a mid ground, and there the cast reads as a soft bloom instead. Nothing in
 * the four role variables is guaranteed darker than the ground, so this is as close as an
 * effect can get.
 *
 * The cast is vertical rather than trailing the extrusion because the only way to angle a
 * blurred layer is to compute its offsets in JS, and `Math.cos` is
 * implementation-approximated: the emitted CSS would then depend on the engine that
 * rendered it. Overhead light is also what the two blurred layers already imply.
 */

/** sin 45°, written out so no trigonometry happens in JS. */
const SIN45 = 0.7071;

/** Blur radii of the two cast layers, in u. Both inside the measured 2.5u cap. */
const TIGHT = 0.9;
const SOFT = 2.2;

/** How far past the end of the wall the soft layer pools, in u. */
const POOL = 2.5;

export default /** @satisfies {import("../src/types.js").Effect<{ d: number; a: number; k: number }>} */ ({
  id: "depth-cast",
  shape: "A",
  colors: 3,
  bg: "light",
  fonts: { deny: ["hairline", "script", "shaded"], prefer: ["fat", "slab"] },
  // `k` is how much ink the cast shadow carries, in percent of the ground colour.
  params: { d: [4, 10, 2], a: [45, 135, 90], k: [24, 44, 10] },

  /**
   * @param {{d: number, a: number, k: number}} p
   * @param {import("../src/types.js").LineGeometry} _lines
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  bleed: (p, _lines, h) => {
    const wall = h.toward(p.a, p.d);
    const side = h.REACH * SOFT;
    return {
      t: 0,
      r: Math.max(wall.r, side),
      b: Math.max(wall.b, p.d * SIN45 + POOL + side),
      l: Math.max(wall.l, side),
    };
  },

  /**
   * @param {{d: number, a: number, k: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => {
    const n = h.layers(8 * p.d);
    const wall = h.stack(n, p.a, p.d, "var(--a1)");
    // Listed last, so the soft ground pools behind the wall and behind the face.
    const cast = [
      `0 ${h.u(p.d * SIN45 + 1)} ${h.u(TIGHT)} ${h.mix("var(--fg)", "var(--bg)", p.k)}`,
      `0 ${h.u(p.d * SIN45 + POOL)} ${h.u(SOFT)} ${h.mix("var(--fg)", "var(--bg)", p.k * 0.6)}`,
    ].join(",");
    return `.n{text-shadow:${wall},${cast}}`;
  },

  hover: "filter:brightness(1.05)",
});
