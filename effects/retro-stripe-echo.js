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

/** Horizontal sign per angle. Both fall, so nothing reaches up into the line above. */
const SX = { 45: 1, 135: -1 }

export default {
  id: 'retro-stripe-echo',
  family: 'retro',
  shape: 'A',
  colors: 4,
  bg: 'any',
  odds: 4,
  fonts: { deny: ['hairline', 'inline', 'shaded'], prefer: ['fat', 'rounded', 'groovy', 'soft'] },
  palettes: { prefer: ['n4'] },
  params: { a: [45, 135, 90], k: [3, 5, 1], s: [0.6, 1.2, 0.3] },

  /**
   * Nothing is painted above the block: both angles fall, and R13 feeds `G` from `bleed.b`.
   *
   * @param {{a: number, k: number, s: number}} p
   */
  bleed: (p) => {
    const d = p.k * p.s
    return { t: 0, r: p.a === 45 ? d : 0, b: d, l: p.a === 135 ? d : 0 }
  },

  /**
   * @param {{a: number, k: number, s: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => {
    const sx = SX[p.a] ?? 1
    const d = p.k * p.s
    const n = Math.min(64, Math.max(12, Math.round(11 * d)))
    const cycle = [
      'var(--a1)',
      'var(--a2)',
      h.mix('var(--a1)', 'var(--a2)', 50),
      h.mix('var(--a1)', 'var(--bg)', 62),
      h.mix('var(--a2)', 'var(--bg)', 62),
    ]
    const out = []
    for (let i = 1; i <= n; i++) {
      const k = (d * i) / n
      const stripe = Math.min(p.k - 1, Math.floor(((i - 1) * p.k) / n))
      out.push(`${h.u(sx * k)} ${h.u(k)} 0 ${cycle[stripe]}`)
    }
    return `.n{text-shadow:${out.join(',')}}`
  },

  hover: () => 'filter:brightness(1.07)',
  motion: null,
}
