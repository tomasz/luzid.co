/**
 * 80s chrome horizon: a hard-stop sky/ground gradient clipped to the letters, a bright
 * keyline, and a solid raised wall under the face (R35).
 *
 * The fill is one gradient spanning **both lines**, not one per line. `render.js` emits
 * `--bh` (the block height in u) and `--y` (each line's top in u) exactly so an effect can
 * size the background to the whole block and scroll it up by the line's own offset; the
 * horizon then runs straight through the name instead of restarting on `Cudziło`.
 *
 * Two rules from §5.6 shape the rest:
 *   - `background-clip: text` lives on `.l`, never on `.n`. Older Chrome and Safari drop
 *     positioned descendants from the clip, and on `.n` that is the whole name.
 *   - the bevel is `filter: drop-shadow()`, never `text-shadow`. A shadow on a clipped face
 *     paints *inside* the transparent glyphs and fills the letters with shadow (F4).
 *
 * Legibility: every gradient stop is a mix of `--a1` into `--fg`, so both ends of the ramp
 * stay anchored on the one pair the engine guarantees at 3:1 — the sky never goes past 45%
 * `--a1`, and only the thin band just under the horizon reaches 65%. On top of that the
 * keyline is 80% `--fg`, so the silhouette of every letter is drawn in very nearly the
 * guaranteed ink even where a band goes quiet against the ground.
 *
 * The wall falls downward, and nothing in §5.2 widens the line gap for downward ink — `G`
 * is `max(g, bleed.t)` and has no bottom counterpart. It does not need one here: the wall
 * is at most 2.1u deep against a layout gap of at least 4u.
 */
const pc = (x) => `${Math.round(x * 10) / 10}%`

export default {
  id: 'glow-chrome',
  family: 'glow',
  shape: 'A',
  colors: 3,
  bg: 'any',
  odds: 4,
  fonts: { deny: ['hairline', 'inline', 'shaded'], prefer: ['fat', 'wide'] },
  palettes: { prefer: ['n3'] },
  // z = horizon, as a percentage of the *ink*, not of the block: `css()` maps it past the
  // gap using `m`, because a horizon that lands between the two lines is a horizon nobody
  // sees. s = tint strength. d = total bevel depth in tenths of a u. k = keyline width in
  // hundredths of a u.
  params: { z: [25, 80, 5], s: [25, 45, 5], d: [7, 21, 7], k: [14, 30, 4] },

  /**
   * The doubling chain sinks the face by the full depth, and the keyline outsets on every
   * side.
   *
   * The keyline is budgeted at 1.5x its width, not the geometric half. Chrome and WebKit
   * miter their stroke joins, so an acute corner runs past `k/2`; that is what the pixel
   * proof caught on the two effects in this family that compose a stroke with a blur.
   *
   * This one has no blurred layer, which is exactly why its allowance has to be the larger.
   * On `glow-neon-outline` and `glow-foil` a generous blur term absorbs the miter; here the
   * keyline is the only ink on the left and right, so the miter is the entire error budget.
   * Measured at 3840x2160 on the sharpest faces this effect accepts, `bellefair` leaves
   * 0.01u at 1x and 0.14u at 1.5x. The extra costs 0.3% of the block width.
   * @param {{d: number, k: number}} p
   */
  bleed: (p) => {
    const side = (1.5 * p.k) / 100
    return { t: side, r: side, b: p.d / 10 + side, l: side }
  },

  /**
   * @param {{z: number, s: number, d: number, k: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   * @param {{H: number[], G: number, R: number}} m
   */
  css: (p, h, m) => {
    // Map the horizon from a fraction of the ink to a percentage of the background box,
    // stepping over the inter-line gap so it always crosses a letter.
    const bh = m.R * 100
    const ink = (m.H[0] + m.H[1]) * (p.z / 100)
    const z = (100 * (ink <= m.H[0] ? ink : ink + m.G)) / bh
    const pu = 100 / bh // one u, as a percentage of the background box
    const sky = h.mix('var(--a1)', 'var(--fg)', p.s)
    const haze = h.mix('var(--a1)', 'var(--fg)', p.s * 0.4)
    const line = h.mix('var(--a1)', 'var(--fg)', p.s + 20)
    const stops = [
      `${sky} 0%`,
      `${haze} ${pc(z - 6 * pu)}`,
      `var(--fg) ${pc(z - 1.4 * pu)}`,
      `var(--fg) ${pc(z)}`,
      `${line} ${pc(z + 0.25 * pu)}`,
      `${line} ${pc(z + 2.6 * pu)}`,
      `${haze} ${pc(z + 9 * pu)}`,
      `${sky} 100%`,
    ]
    return (
      `.n{-webkit-text-stroke:${h.u(p.k / 100)} ${h.mix('var(--fg)', 'var(--a1)', 80)};` +
      `filter:${raise(p, h)}}` +
      `.l{background-image:linear-gradient(180deg,${stops.join(',')});` +
      `background-size:100% calc(var(--bh)*var(--u));` +
      `background-position:0 calc(-1*var(--y)*var(--u));background-repeat:no-repeat;` +
      `-webkit-background-clip:text;background-clip:text;` +
      `-webkit-text-fill-color:transparent;color:transparent}`
    )
  },

  /** @param {{d: number}} p @param {typeof import('../src/helpers.js').helpers} h */
  hover: (p, h) => `filter:${raise(p, h)} brightness(1.06)`,
  motion: null,
}

/**
 * The raised wall under the face, as a binary-doubling drop-shadow chain (R06): each pass
 * shadows the *result* of the previous one, so steps of d, 2d and 4d lay down a copy at
 * every multiple of d out to 7d. Three passes therefore give a solid wall where three equal
 * steps would give three visible ridges — and it stays well inside the cap of four.
 *
 * A single colour, deliberately. Ramping the passes reads as banding at this step size, and
 * the face above it already carries all the colour this effect needs.
 *
 * @param {{d: number}} p
 * @param {typeof import('../src/helpers.js').helpers} h
 */
function raise(p, h) {
  const b = p.d / 70
  const wall = h.mix('var(--bg)', 'var(--a1)', 35)
  return (
    `drop-shadow(0 ${h.u(b)} 0 ${wall}) drop-shadow(0 ${h.u(2 * b)} 0 ${wall}) ` +
    `drop-shadow(0 ${h.u(4 * b)} 0 ${wall})`
  )
}
