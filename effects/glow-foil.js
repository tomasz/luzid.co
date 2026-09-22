/**
 * Foil: a metallic sheen clipped to the letters, with a thin raised bevel (R37).
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
const pc = (x) => `${Math.round(x * 10) / 10}%`

export default {
  id: 'glow-foil',
  family: 'glow',
  shape: 'A',
  colors: 3,
  bg: 'any',
  odds: 4,
  fonts: { deny: ['hairline', 'inline', 'shaded'], prefer: ['serif', 'deco'] },
  palettes: { prefer: ['n3'] },
  // a = sheen angle, a few degrees either side of vertical. s = tint strength.
  // o = bevel step in tenths of a u. k = keyline width in hundredths of a u.
  // R37's bevel offsets are .004–.01em and its ambient blur .03–.06em. A line of the name
  // fills the block width, so 1em is about 25u: o tops out at 0.6u ≈ .024em and the ambient
  // is 1.1u ≈ .044em. The offsets sit a little above the recipe because three chained
  // passes have to read as one edge; the ambient is inside it.
  params: { a: [172, 188, 4], s: [25, 45, 5], o: [2, 6, 1], k: [14, 30, 4] },

  /**
   * The chain steps `o` up and then `o + 1.6·o` down, and the ambient adds its blur on every
   * side. The keyline straddles the outline, so half of it counts too.
   * @param {{o: number, k: number}} p
   */
  bleed: (p) => {
    const o = p.o / 10
    const side = p.k / 200 + 1.1
    return { t: o + side, r: side, b: o * 2.6 + side, l: side }
  },

  /**
   * @param {{a: number, s: number, o: number, k: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => {
    const warm = h.mix('var(--a1)', 'var(--fg)', p.s)
    const glint = h.mix('var(--a1)', 'var(--fg)', p.s * 0.3)
    const deep = h.mix('var(--a1)', 'var(--fg)', p.s * 1.15)
    const stops = [
      `${warm} 0%`,
      `${glint} ${pc(22)}`,
      `var(--fg) ${pc(37)}`,
      `${glint} ${pc(46)}`,
      `${deep} ${pc(63)}`,
      `${glint} ${pc(81)}`,
      `${warm} 100%`,
    ]
    return (
      `.n{-webkit-text-stroke:${h.u(p.k / 100)} ${h.mix('var(--fg)', 'var(--a1)', 80)};` +
      `filter:${bevel(p, h)}}` +
      `.l{background-image:linear-gradient(${p.a}deg,${stops.join(',')});` +
      `background-size:100% calc(var(--bh)*var(--u));` +
      `background-position:0 calc(-1*var(--y)*var(--u));background-repeat:no-repeat;` +
      `-webkit-background-clip:text;background-clip:text;` +
      `-webkit-text-fill-color:transparent;color:transparent}`
    )
  },

  /** @param {{o: number}} p @param {typeof import('../src/helpers.js').helpers} h */
  hover: (p, h) => `filter:${bevel(p, h)} brightness(1.05)`,
  motion: null,
}

/**
 * @param {{o: number}} p
 * @param {typeof import('../src/helpers.js').helpers} h
 */
function bevel(p, h) {
  const o = p.o / 10
  return (
    `drop-shadow(0 ${h.u(-o)} 0 ${h.mix('var(--fg)', 'var(--a1)', 60)}) ` +
    `drop-shadow(0 ${h.u(o)} 0 ${h.mix('var(--bg)', 'var(--a1)', 45)}) ` +
    `drop-shadow(0 ${h.u(o * 1.6)} ${h.u(1.1)} ${h.mix('var(--bg)', 'var(--a1)', 75)})`
  )
}
