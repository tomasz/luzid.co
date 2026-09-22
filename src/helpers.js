/**
 * The four helpers every effect author gets as `h` in `css(p, h, m)` and `hover(p, h, m)`.
 *
 * They exist so that effects never write a raw length or a raw colour: `u()` is the only
 * way to spell a length, and `mix()` the only way to make a colour that is not one of the
 * four role variables. The effect lint (`test/effects.test.js`) enforces both.
 *
 * Trigonometry stays in CSS (`cos()` / `sin()`, Baseline since 2023). `Math.cos` is
 * implementation-approximated, so computing the offsets in JS would make the emitted CSS —
 * and therefore every golden snapshot — depend on the engine that rendered it.
 */

import { round4 } from './rand.js'

/**
 * A length in `u` (1u = 1% of the fitted block width). The only unit an effect may use.
 *
 * @param {number} x
 * @returns {string}
 */
export function u(x) {
  return `calc(${round4(x)}*var(--u))`
}

/**
 * `n` hard shadow layers marching from the glyph to `dist` u at `angle` degrees: the
 * primitive behind every extrusion and long shadow. Layer 1 sits nearest the face, layer
 * `n` at the full distance, so the ramp is solid at any size.
 *
 * Caps (measured, §5.6): at most 64 hard layers per composed effect.
 *
 * @param {number} n number of layers
 * @param {number} angle degrees; 0 = right, 90 = down (CSS shadow axes)
 * @param {number} dist total distance in u
 * @param {string} color one of the role variables, or a `mix()`
 * @returns {string} a `text-shadow` value
 */
export function stack(n, angle, dist, color) {
  const a = round4(angle)
  const out = []
  for (let i = 1; i <= n; i++) {
    const k = round4((dist * i) / n)
    out.push(`calc(${k}*cos(${a}deg)*var(--u)) calc(${k}*sin(${a}deg)*var(--u)) 0 ${color}`)
  }
  return out.join(',')
}

/**
 * `n` hard shadow layers evenly spaced around a circle of radius `r` u: an outline drawn
 * out of shadows, for fonts whose thinnest stem is wider than `r`.
 *
 * Smoothness rule from the browser spike: n >= pi / acos(1 - 0.5px / r_px). At a ~300px
 * fitted size that is n >= 13 for r = .05em and n >= 25 for r = .2em.
 *
 * @param {number} n
 * @param {number} r radius in u
 * @param {string} color
 * @returns {string} a `text-shadow` value
 */
export function ring(n, r, color) {
  const k = round4(r)
  const out = []
  for (let i = 0; i < n; i++) {
    const a = round4((360 * i) / n)
    out.push(`calc(${k}*cos(${a}deg)*var(--u)) calc(${k}*sin(${a}deg)*var(--u)) 0 ${color}`)
  }
  return out.join(',')
}

/**
 * `pct` percent of `a` mixed into `b`, in OKLab so the midpoints stay perceptual.
 *
 * @param {string} a
 * @param {string} b
 * @param {number} pct
 * @returns {string}
 */
export function mix(a, b, pct) {
  return `color-mix(in oklab,${a} ${round4(pct)}%,${b})`
}

/** The object handed to effects as `h`. */
export const helpers = { u, stack, ring, mix }
