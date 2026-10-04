/**
 * Shaded-ramp extrusion: the same solid wall as `depth-extrude`, but lit — each layer is
 * a little further toward the ground colour than the one in front of it, so the wall
 * carries a tonal falloff instead of reading as one flat slab.
 *
 * The ramp runs toward `--bg` rather than toward black (which an effect cannot spell) or
 * toward a second accent (which would need a 4-colour role set and would read as two inks
 * rather than one lit surface). Fading the far end into the ground is also the one
 * direction that works on both polarities: the wall keeps its full contrast against the
 * face, where legibility lives, and loses it into the distance, where it does not.
 *
 * `h.ramp` rather than `h.stack`: the wall needs a colour per layer, and `h.stack` takes
 * one colour for the whole ramp, which is exactly what this effect is not.
 */

export default /** @satisfies {import("../src/types.js").Effect<{ d: number; a: number; s: number }>} */ ({
  id: "depth-ramp",
  family: "depth",
  shape: "A",
  colors: 3,
  bg: "any",
  odds: 4,
  fonts: { deny: ["hairline", "script", "shaded"], prefer: ["fat", "slab"] },
  palettes: { prefer: [] },
  // `s` is the ramp strength: how much ground colour the far end has taken on, in percent.
  params: { d: [4, 10, 2], a: [45, 315, 90], s: [20, 60, 20] },

  /**
   * @param {{d: number, a: number, s: number}} p
   * @param {import("../src/types.js").LineGeometry} _lines
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  bleed: (p, _lines, h) => h.toward(p.a, p.d),

  /**
   * @param {{d: number, a: number, s: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => {
    const n = h.layers(8 * p.d);
    /** @param {number} t */
    const tint = (t) => (t === 0 ? "var(--a1)" : h.mix("var(--bg)", "var(--a1)", p.s * t));
    return `.n{text-shadow:${h.ramp(n, p.a, p.d, tint)}}`;
  },

  hover: "filter:brightness(1.06)",
  motion: null,
});
