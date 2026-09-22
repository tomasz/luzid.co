/**
 * Detached echo lines: two to four narrow copies of the letter trailing off one diagonal,
 * each held off the last by a band of bare background. It is the split shade with the
 * shade cut into slices — Typekit's relief channel repeated.
 *
 * The gaps cost nothing. A `text-shadow` layer is only painted where it is listed, so a
 * band of background is simply a range of the ramp with no layers emitted in it; the whole
 * budget goes to the ink. That is what lets four echoes stay inside the 64-layer cap while
 * each one is still dense enough to read as a solid line.
 *
 * Each echo is knocked back toward the ground so the tail recedes instead of flickering.
 * Needs a flat ground the colour of `--bg`, which v1.0 always has.
 */

/** Horizontal sign per angle. Both fall, so nothing reaches up into the line above. */
const SX = { 45: 1, 135: -1 }

export default {
  id: 'retro-echo-lines',
  family: 'retro',
  shape: 'A',
  colors: 4,
  bg: 'any',
  odds: 4,
  fonts: { deny: ['hairline', 'inline', 'shaded', 'stencil'], prefer: ['fat', 'sans', 'slab'] },
  palettes: { prefer: ['n4'] },
  // e = echoes; w = ink band width; c = background channel before each band. All per axis.
  // The channel and the band are deliberately short: four echoes of the widest pair still
  // has to fit between the two lines, and past about 8u the trailing echoes of `Tomasz`
  // arrive in the ascenders of `Cudziło` however wide the gap is opened.
  params: { a: [45, 135, 90], c: [0.4, 1, 0.3], e: [2, 4, 1], w: [0.35, 0.95, 0.3] },

  /**
   * Nothing is painted above the block: both angles fall, and R13 feeds `G` from `bleed.b`.
   *
   * @param {{a: number, c: number, e: number, w: number}} p
   */
  bleed: (p) => {
    const d = p.e * (p.c + p.w)
    return { t: 0, r: p.a === 45 ? d : 0, b: d, l: p.a === 135 ? d : 0 }
  },

  /**
   * @param {{a: number, c: number, e: number, w: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => {
    const sx = SX[p.a] ?? 1
    const nb = Math.min(16, Math.max(5, Math.round(12 * p.w)))
    const cycle = ['var(--a1)', 'var(--a2)', 'var(--a1)', 'var(--a2)']
    const out = []
    for (let i = 0; i < p.e; i++) {
      const start = i * (p.c + p.w) + p.c
      const back = 100 - i * 15
      const color = i === 0 ? cycle[0] : h.mix(cycle[i], 'var(--bg)', back)
      for (let j = 1; j <= nb; j++) {
        const k = start + (p.w * j) / nb
        out.push(`${h.u(sx * k)} ${h.u(k)} 0 ${color}`)
      }
    }
    return `.n{text-shadow:${out.join(',')}}`
  },

  hover: () => 'filter:saturate(1.2)',
  motion: null,
}
