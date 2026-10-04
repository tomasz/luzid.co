/**
 * The 70s multi-stripe echo: three to five equal-width offset copies of the letter in a
 * repeating colour sequence, marching off one diagonal. Where the split shade bands one
 * shade tonally, this one cycles chromatically — the two palette accents, their midpoint,
 * and then the accents knocked back toward the ground so the tail recedes.
 *
 * Every stripe is a run of hard `text-shadow` layers rather than a single copy: a single
 * offset copy only looks solid at small sizes, and this name is as large as the screen.
 * The layer budget (64) is spread over the whole depth, so the stripe width and the stripe
 * count trade against each other — which is why the depth is capped at 6u per axis.
 */

export default /** @satisfies {import("../src/types.js").Effect<{ a: number; k: number; s: number }>} */ ({
  id: "retro-stripe-echo",
  shape: "A",
  colors: 4,
  bg: "any",
  fonts: { deny: ["hairline", "inline", "shaded"], prefer: ["fat", "rounded", "groovy", "soft"] },
  palettes: { prefer: ["n4"] },
  params: { a: [45, 135, 90], k: [3, 5, 1], s: [0.6, 1.2, 0.3] },

  /**
   * Nothing is painted above the block: both angles fall, and R13 feeds `G` from `bleed.b`.
   */
  bleed: (p, lines, h) => h.toward(p.a, p.k * p.s),

  css: (p, h) => {
    const d = p.k * p.s;
    const n = h.layers(11 * d, 12);
    const cycle = [
      "var(--a1)",
      "var(--a2)",
      h.mix("var(--a1)", "var(--a2)", 50),
      h.mix("var(--a1)", "var(--bg)", 62),
      h.mix("var(--a2)", "var(--bg)", 62),
    ];
    /** @param {number} i */
    const stripe = (i) =>
      /** @type {string} */ (cycle[Math.min(p.k - 1, Math.floor(((i - 1) * p.k) / n))]);
    return `.n{text-shadow:${h.march(n, h.fall(p.a), 1, 0, d, stripe)}}`;
  },

  hover: "filter:brightness(1.07)",
});
