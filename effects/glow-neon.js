/**
 * Neon tube: the classic bloom. One tight near-`--fg` core halo hugging the glyph, then
 * three `--a1`-tinted layers opening out to the full radius.
 *
 * Four blurred layers is the entire budget (§5.6) and this effect spends all of it. The
 * browser spike measured 2.4–7.9 ms of GPU raster *per blurred layer* at desktop size, so
 * the bloom is built from few, widely spaced radii rather than the eight of the source
 * recipe (R32). The ratios .14/.42/.75/1 crowd the outer half deliberately: a blurred layer
 * drops most of its alpha in the first radius, so two wide layers close together are what
 * builds a bloom you can see, while the four together still read as one falloff rather than
 * as four rings.
 *
 * `bg: 'dark'` is not a preference. A bloom is additive light; on a light ground the same
 * layers read as mud. The engine checks the declaration forward when it draws the role set
 * (R3), so a neon pick always lands on a dark ground.
 *
 * The face stays `--fg` — the one ink the engine guarantees at 3:1 against `--bg`. The glow
 * is decoration on top of that guarantee, never a substitute for it.
 */
export default {
  id: 'glow-neon',
  family: 'glow',
  shape: 'A',
  colors: 3,
  bg: 'dark',
  odds: 5,
  // A hairline face is eaten by its own bloom; `inline`/`shaded` faces already carry an
  // internal second colour that the glow turns to porridge.
  fonts: { deny: ['hairline', 'inline', 'shaded'], prefer: ['rounded', 'soft'] },
  palettes: { prefer: ['dark'] },
  // r = full bloom radius in tenths of a u (1.5u–2.5u; 2.5u is the measured cap). Note the
  // scale: a line of the name fills the block width, so 1em is roughly 25u and the cap is
  // about .1em — a third of the `min(.3em, 56px)` outer layer R32 asks for. The cap wins,
  // and this is the tightest, brightest bloom that fits under it rather than a soft wide one.
  // t = how much of `--a1` the tube carries, as a percentage mixed into `--fg`. It starts
  // high: below about 60% the mix pulls the tube back toward the face and the bloom reads
  // as a soft rim rather than as coloured light.
  params: { r: [15, 25, 1], t: [60, 100, 10] },

  /** The bloom is centred, so the full radius outsets on every side. @param {{r: number}} p */
  bleed: (p) => ({ t: p.r / 10, r: p.r / 10, b: p.r / 10, l: p.r / 10 }),

  /**
   * @param {{r: number, t: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => {
    const r = p.r / 10
    const tube = h.mix('var(--a1)', 'var(--fg)', p.t)
    const core = h.mix('var(--a1)', 'var(--fg)', p.t / 4)
    return (
      `.n{text-shadow:0 0 ${h.u(r * 0.14)} ${core},0 0 ${h.u(r * 0.42)} ${tube},` +
      `0 0 ${h.u(r * 0.75)} ${tube},0 0 ${h.u(r)} ${tube}}`
    )
  },

  // Brightness is a compositor-side filter and adds no painted area, so the bleed still holds.
  hover: () => 'filter:brightness(1.18)',
  motion: null,
}
