/**
 * Anaglyph: the two-channel split, done with the palette's own inks.
 *
 * The literal red/cyan of the source recipe (R38) is exactly what this site cannot do — a
 * fixed pair of channels fights every historical palette it lands on. `--a1` and `--a2` are
 * the two channels instead, which is why this effect declares `colors: 4`: with fewer, `--a2`
 * aliases `--bg` (R4) and one channel would paint itself onto the ground and vanish. The
 * engine checks that forward before the palette is drawn (R3).
 *
 * The recipe's channel alpha is done as a mix toward `--bg` rather than a transparency: the
 * shadows sit on the flat ground behind the glyph, so mixing toward it is the same result
 * with a colour the lint can verify.
 *
 * Two hard layers, no blur — this is the cheapest effect in the family, about 0.05 ms of GPU
 * raster per layer against 2.4–7.9 ms for a blurred one.
 */
export default {
  id: 'glow-anaglyph',
  family: 'glow',
  shape: 'A',
  colors: 4,
  bg: 'any',
  odds: 4,
  // A hairline face split in two directions stops being a letter.
  fonts: { deny: ['hairline'], prefer: ['fat', 'wide'] },
  palettes: { prefer: ['n4'] },
  // s = split distance in tenths of a u. a = split axis in degrees (0 = horizontal).
  // R38 quotes .008–.04em. One line of the name fills the block, so 1em is roughly 25u and
  // that range is 0.2u–1.0u — a tenth of what the same numbers would mean read as u. The
  // range here tops out a shade above the recipe because the name is set far larger than
  // the body copy the recipe was measured on, not because em was mistaken for u.
  params: { s: [4, 12, 1], a: [0, 150, 30] },

  /**
   * Hover widens the split by half, and the bleed has to bound the hover state too (§5.6),
   * so the outset is the widened distance on every side — the axis is drawn, and the `side`
   * flag rotates the whole block, so per-axis bookkeeping would buy nothing here.
   * @param {{s: number}} p
   */
  bleed: (p) => {
    const o = (p.s / 10) * 1.5
    return { t: o, r: o, b: o, l: o }
  },

  /**
   * @param {{s: number, a: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => `.n{text-shadow:${split(p, h, 1)}}`,

  /** @param {{s: number, a: number}} p @param {typeof import('../src/helpers.js').helpers} h */
  hover: (p, h) => `text-shadow:${split(p, h, 1.5)}`,
  motion: null,
}

/**
 * One layer per channel, `h.stack(1, …)` each, so the offsets stay as `cos()`/`sin()` in CSS
 * — `Math.cos` is implementation-approximated and would make the emitted CSS depend on the
 * engine that rendered it (§5.6, `src/helpers.js`).
 *
 * @param {{s: number, a: number}} p
 * @param {typeof import('../src/helpers.js').helpers} h
 * @param {number} k
 */
function split(p, h, k) {
  const d = (p.s / 10) * k
  const c1 = h.mix('var(--a1)', 'var(--bg)', 72)
  const c2 = h.mix('var(--a2)', 'var(--bg)', 72)
  return `${h.stack(1, p.a, d, c1)},${h.stack(1, p.a + 180, d, c2)}`
}
