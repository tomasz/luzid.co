/**
 * Fire: a warm multi-layer bloom rising off the letters (R58).
 *
 * Four blurred layers, each lifted further and opened wider than the last, and each mixed one
 * step further from `--fg` through `--a1` and on toward `--bg` — so the ramp goes hot at the
 * glyph and cools into the ground as it rises. The recipe's fixed fire colours are replaced
 * by that ramp: literal orange and yellow fight every historical palette this can land on.
 *
 * **Static.** `motion` is `null` in Waves 0–3 (§5.6), and this is the one effect in the
 * family where that is a mercy rather than a restriction: keyframing a blurred shadow list
 * over viewport-sized text is the worst case the browser spike found. Wave 4 should animate
 * the opacity of a pre-rendered copy, not the radii.
 *
 * Four blurred layers is the cap, and the top bleed is genuinely large — the rise plus the
 * full radius. That is real upward ink, not a declaration bought to widen the gap: `G` is
 * `max(g, bleed.t)` (§5.2) and it is what stops `Cudziło`'s flames licking the underside of
 * `Tomasz`. Nothing does the same for ink falling downward, which is why the bottom of the
 * bloom is only the radius — smaller than the 4u floor on the layout gap.
 */
export default {
  id: 'glow-fire',
  family: 'glow',
  shape: 'A',
  colors: 3,
  bg: 'dark',
  odds: 3,
  fonts: { deny: ['hairline', 'inline', 'shaded'], prefer: ['fat', 'condensed'] },
  palettes: { prefer: ['dark'] },
  // r = widest bloom radius in tenths of a u (1.6u–2.5u; 2.5u is the measured cap).
  // l = rise, as a fraction of that radius in tenths. It stays *under* the radius on
  // purpose: the moment a layer's offset outruns its own blur it stops being a flame and
  // becomes a displaced ghost copy with a dark gap under it.
  params: { r: [16, 25, 1], l: [6, 14, 2] },

  /** @param {{r: number, l: number}} p */
  bleed: (p) => {
    const r = p.r / 10
    return { t: r * (0.85 * (p.l / 10) + 1), r: r * 1.1, b: r, l: r * 1.06 }
  },

  /**
   * @param {{r: number, l: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   */
  css: (p, h) => {
    const r = p.r / 10
    const y = (r * p.l) / 10
    const core = h.mix('var(--a1)', 'var(--fg)', 15)
    const body = h.mix('var(--a1)', 'var(--fg)', 45)
    const tip = h.mix('var(--a1)', 'var(--bg)', 60)
    // The small sideways offsets are the lean of R58's sketch: without them four centred
    // layers stack into a symmetrical column, which no flame has ever been.
    return (
      `.n{text-shadow:0 ${h.u(-y * 0.1)} ${h.u(r * 0.3)} ${core},` +
      `${h.u(r * 0.06)} ${h.u(-y * 0.3)} ${h.u(r * 0.55)} ${body},` +
      `${h.u(-r * 0.06)} ${h.u(-y * 0.55)} ${h.u(r * 0.8)} var(--a1),` +
      `${h.u(r * 0.1)} ${h.u(-y * 0.85)} ${h.u(r)} ${tip}}`
    )
  },

  hover: () => 'filter:brightness(1.14)',
  motion: null,
}
