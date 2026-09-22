/**
 * An outline with no stroke property (R18): `h.ring()` puts N zero-blur copies of the word
 * on a circle of radius `r`, the face is painted in the ground colour, and what is left
 * visible is a band of exactly `r` around every letter.
 *
 * Why bother when `-webkit-text-stroke` exists: shadows are round-joined in every engine
 * (no Chromium miter spikes, and `stroke-linejoin` is not on the §5.6 allowlist), the band
 * is outside-only without needing `paint-order`, the counters keep their full size, and
 * nothing is ever seen through — so a variable font's overlapping contours cannot seam.
 *
 * The browser spike (`gap-browser-empirical-spike.json`) gates this one hard:
 *
 *  - **Smoothness.** N ≥ π / acos(1 − 0.5px / r_px), or the ring shows facets. `acos(1−x) ≥
 *    √(2x)`, so `N = ceil(π·√(r_px))` is a safe upper bound — and it reproduces the spike's
 *    measured numbers exactly (15px → 13, 30px → 18, 60px → 25). It needs only `Math.sqrt`,
 *    which IEEE-754 pins to the correctly rounded result, so unlike `Math.cos` it cannot
 *    make a golden depend on the engine that rendered it.
 *  - **Stems.** Where a stem is thinner than `r`, a band between the glyph and its offset
 *    copies stays uncovered and the letter grows spirograph rays. The spike's fix — a
 *    second ring at `r/2` — reduces but does not remove it, so the real gate is the font:
 *    everything hairline, high-contrast or script-like is denied and `fat` is preferred.
 *    This effect is for heavy faces, and only for heavy faces.
 *
 * Two roles: `--fg` ring on a `--bg` face, which is the pair the engine guarantees at 3:1.
 * With a hollow face the ring *is* the letter, so it could not be anything else.
 */

/**
 * The largest font-size the fit is expected to reach, in px. The spike measured at ~300,
 * which is a laptop; this is a 2560-wide display with the block filling it (~2550u of
 * width, ~600px of line 1). Guessing low is what shows facets, and the extra layers are
 * ~0.05 ms each on the spike's GPU numbers, so the headroom is nearly free.
 */
const FIT_PX = 600

/** Per-ring layer cap, so the two rings together can never exceed the measured 64. */
const CAP = 32

/**
 * Layers for a ring of radius `r` u, from the spike's smoothness rule.
 *
 * @param {number} r radius in u
 * @param {number} uPx px per u at the largest expected fit
 */
const layers = (r, uPx) => Math.min(CAP, Math.max(8, Math.ceil(Math.PI * Math.sqrt(r * uPx))))

export default {
  id: 'outline-ring',
  family: 'outline',
  shape: 'A',
  colors: 2,
  bg: 'any',
  odds: 3,
  fonts: {
    deny: ['hairline', 'serif', 'script', 'brush', 'connected', 'blackletter', 'inline', 'shaded'],
    prefer: ['fat'],
  },
  palettes: { prefer: [] },
  // R18's .01-.08em radius at 1em = 100/W1 u, i.e. ~25u, so .08em is 2u. The top of the
  // range is where the stem rule starts to bite even on a fat face.
  params: { r: [0.8, 2, 0.4] },

  /** @param {{r: number}} p */
  bleed: (p) => ({ t: p.r, r: p.r, b: p.r, l: p.r }),

  /**
   * @param {{r: number}} p
   * @param {typeof import('../src/helpers.js').helpers} h
   * @param {{fs: number[]}} m
   */
  css: (p, h, m) => {
    // 1u is 1% of the block width; m.fs[0] is line 1's font-size in u, so u→px at the
    // largest expected fit is FIT_PX / m.fs[0]. The ring is sized against line 1 because
    // it is the larger of the two under `stack-fit`.
    const uPx = FIT_PX / m.fs[0]
    const inner = p.r / 2
    // The inner ring is listed first because the first shadow paints on top: it fills the
    // band the outer ring leaves behind a thin stem before the outer ring can show through.
    return (
      `.n{color:var(--bg);text-shadow:${h.ring(layers(inner, uPx), inner, 'var(--fg)')},` +
      `${h.ring(layers(p.r, uPx), p.r, 'var(--fg)')}}`
    )
  },

  /** The outline fills in: face and ring become one solid letter. */
  hover: () => 'color:var(--fg)',
  motion: null,
}
