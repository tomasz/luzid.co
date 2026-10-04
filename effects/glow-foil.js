/**
 * Foil: a metallic sheen clipped to the letters, with a thin raised bevel (recipe 37).
 *
 * Where the chrome horizon is one hard event, foil is a run of soft specular bands — bright,
 * deep, bright — tilted a few degrees off vertical so the sheen crosses the letters on a
 * slant. The stops are all `h.mix()` of `--a1` into `--fg`, warm where the tint is heavy and
 * cool where it is light; nothing here is a literal colour, so the "gold" of a warm palette
 * and the "steel" of a cool one come out of the same seven stops.
 *
 * Like the chrome fill, the gradient is sized to `--bh` and offset by `--y` so it spans both
 * lines continuously, the clip sits on `.l` and never on `.n`, and the bevel is
 * `filter: drop-shadow()` rather than `text-shadow` — on a clipped face a text shadow paints
 * inside the transparent glyphs (§5.6, F4).
 *
 * The bevel is three passes: one step up in a bright mix, one step down in a ground-tinted
 * mix, and one soft ambient. Chained drop-shadows accumulate offsets, so the up-step is
 * re-shadowed downward by the second pass, which is what gives the edge its thickness.
 *
 * Legibility: both ends of the sheen are the same 25–45% `--a1` mix, so the ramp starts and
 * finishes well inside the guaranteed pair. Only the one deep band in the middle reaches
 * ~50%, and the 80%-`--fg` keyline draws the silhouette of every letter regardless.
 *
 * The bevel assumes light from above, and `bg: 'any'` cannot promise which way that is:
 * `--fg` is only guaranteed to *contrast* with `--bg`, not to be lighter than it. On a role
 * set where the ink is the darker of the two the edge simply lights from below. It still
 * reads as a bevel, which is why this is a note and not a `bg` restriction.
 */
/** @param {number} x */
const pc = (x) => `${Math.round(x * 10) / 10}%`;

/** The ambient pass's blur radius in u. `bleed()` and `bevel()` share it. */
const AMBIENT = 1.1;

export default /** @satisfies {import("../src/types.js").Effect<{ a: number; s: number; o: number; k: number }>} */ ({
  id: "glow-foil",
  shape: "A",
  colors: 3,
  bg: "any",
  fonts: { deny: ["hairline", "inline", "shaded"], prefer: ["serif", "deco"] },
  palettes: { prefer: ["n3"] },
  // a = sheen angle, a few degrees either side of vertical. s = tint strength.
  // o = bevel step in tenths of a u. k = keyline width in hundredths of a u.
  // Recipe 37's bevel offsets are .004–.01em and its ambient blur .03–.06em. A line of the name
  // fills the block width, so 1em is about 25u: o tops out at 0.6u ≈ .024em and the ambient
  // is 1.1u ≈ .044em. The offsets sit a little above the recipe because three chained
  // passes have to read as one edge; the ambient is inside it.
  params: { a: [172, 188, 4], s: [25, 45, 5], o: [2, 6, 1], k: [14, 30, 4] },

  /**
   * The chain steps `o` up and then `o + 1.6·o` down, and the ambient blur spreads from the
   * *keyline's* outer edge on every side — not from the glyph contour — so the keyline's
   * `h.OUTSET` adds to every pass (R14). Upward, the ambient pass sits `1.6·o` lower than the
   * up-step it shadows, so the top is whichever reaches further: the up-step or the blur.
   *
   * The first version counted half the keyline and the blur at 1.0x, and `e2e/bleed.spec.js`
   * measured 0.32u of real ink past that on the left and right at `k=30`. The full keyline
   * width and `h.REACH` add 0.26u there; the spec, not this comment, is the proof.
   * @param {{o: number, k: number}} p
   * @param {import("../src/types.js").LineGeometry} _lines
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  bleed: (p, _lines, h) => {
    const o = p.o / 10;
    const stroke = (h.OUTSET * p.k) / 100;
    const blur = h.REACH * AMBIENT;
    const side = stroke + blur;
    return { t: stroke + Math.max(o, blur - o * 0.6), r: side, b: o * 2.6 + side, l: side };
  },

  /**
   * @param {{a: number, s: number, o: number, k: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => {
    const warm = h.mix("var(--a1)", "var(--fg)", p.s);
    const glint = h.mix("var(--a1)", "var(--fg)", p.s * 0.3);
    const deep = h.mix("var(--a1)", "var(--fg)", p.s * 1.15);
    const stops = [
      `${warm} 0%`,
      `${glint} ${pc(22)}`,
      `var(--fg) ${pc(37)}`,
      `${glint} ${pc(46)}`,
      `${deep} ${pc(63)}`,
      `${glint} ${pc(81)}`,
      `${warm} 100%`,
    ];
    return (
      `.n{-webkit-text-stroke:${h.u(p.k / 100)} ${h.mix("var(--fg)", "var(--a1)", 80)};` +
      `filter:${bevel(p, h)}}` +
      h.clipFill(`linear-gradient(${p.a}deg,${stops.join(",")})`)
    );
  },

  /** @param {{o: number}} p @param {typeof import('../src/helpers.js').helpers} h */
  hover: (p, h) => `filter:${bevel(p, h)} brightness(1.05)`,
});

/**
 * @param {{o: number}} p
 * @param {typeof import('../src/helpers.js').helpers} h
 */
function bevel(p, h) {
  const o = p.o / 10;
  return (
    `drop-shadow(0 ${h.u(-o)} 0 ${h.mix("var(--fg)", "var(--a1)", 60)}) ` +
    `drop-shadow(0 ${h.u(o)} 0 ${h.mix("var(--bg)", "var(--a1)", 45)}) ` +
    `drop-shadow(0 ${h.u(o * 1.6)} ${h.u(AMBIENT)} ${h.mix("var(--bg)", "var(--a1)", 75)})`
  );
}
