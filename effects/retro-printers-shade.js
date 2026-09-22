/**
 * The printer's shade: a solid wall to the right and below, with a painterly softening
 * around it. Typekit's version staggers two tones through the stack and lets the blur
 * climb to about a pixel mid-stack before falling back to zero — which is what stops the
 * diagonal edge from striping and gives the shade the look of ink that spread a little.
 *
 * Here the tone deepens toward the ink in six quantized bands down the wall, and the blur
 * lives in three layers listed *after* the hard wall: under the wall they are invisible,
 * and what shows is exactly their halo around its edge. Three blurred layers, well inside
 * the four the contract allows.
 *
 * The tone was first written as Typekit's literal layer-by-layer alternation between two
 * colours. Do not put that back: at this size the alternation has a period of about two
 * device pixels, and WebKit moirés it into visible horizontal banding across the whole
 * shade. Chromium did not, which is why this needed the three-engine pass to catch. Six
 * bands over forty-odd layers read as one smooth gradient in all three.
 *
 * The angle is fixed at 45°, right and down, because that is the recipe — a printer's
 * shade is not a free-angle extrusion. Depths are the recipe's em figures converted at
 * roughly 1em = 25u: D .05–.11em is 1.25–2.75u, and the blur sits just above it.
 */
export default {
  id: 'retro-printers-shade',
  family: 'retro',
  shape: 'A',
  colors: 3,
  bg: 'any',
  odds: 4,
  fonts: { deny: ['hairline', 'inline', 'shaded'], prefer: ['brush', 'script', 'fat', 'serif'] },
  palettes: { prefer: [] },
  // d = per-axis depth; b = the largest blur radius in the soft trio.
  params: { b: [0.2, 0.6, 0.2], d: [1.5, 4, 0.5] },

  /**
   * Nothing reaches above or left of the block: every soft layer sits further out than its
   * own tail, and R13 feeds `G` from `bleed.b`. The `1.5` is R14 — a blur radius is a
   * Gaussian diameter hint, so the ink reaches about one and a half radii, not one. That
   * rule is written for `drop-shadow()`, but `text-shadow` defines its radius the same way
   * and the tail is the same tail; budgeting at 1x left about 0.03u of margin here.
   *
   * @param {{b: number, d: number}} p
   */
  bleed: (p) => ({ t: 0, r: p.d + 1.5 * p.b, b: p.d + 1.5 * p.b, l: 0 }),

  /**
   * @param {{b: number, d: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => {
    const n = Math.min(60, Math.max(12, Math.round(14 * p.d)))
    // Six bands, never a per-layer alternation. The nearest band is the accent itself,
    // which is what a 0% mix means and is a good deal shorter to say.
    const tone = (i) => {
      const band = Math.min(5, Math.floor((6 * (i - 1)) / n))
      return band === 0 ? 'var(--a1)' : h.mix('var(--fg)', 'var(--a1)', 4 * band)
    }
    const out = []
    for (let i = 1; i <= n; i++) {
      const k = (p.d * i) / n
      out.push(`${h.u(k)} ${h.u(k)} 0 ${tone(i)}`)
    }
    // Every soft layer sits further out than its own radius, so none of them reaches back
    // past the face: the bleed stays a clean {right, bottom} box.
    const soft = h.mix('var(--a1)', 'var(--bg)', 62)
    for (const [at, r] of [
      [0.55, 0.6],
      [0.78, 1],
      [1, 0.5],
    ]) {
      const k = p.d * at
      out.push(`${h.u(k)} ${h.u(k)} ${h.u(p.b * r)} ${soft}`)
    }
    return `.n{text-shadow:${out.join(',')}}`
  },

  hover: () => 'filter:brightness(1.05)',
  motion: null,
}
