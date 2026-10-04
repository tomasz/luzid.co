/**
 * What every effect author gets as `h` in `css(p, h, m)`, `hover(p, h, m)` and
 * `motion(p, h, m)`: the measured constants of §5.6 and the helpers that spell lengths,
 * colours and the geometry effects kept copying from each other.
 *
 * They exist so that effects never write a raw length or a raw colour: `u()` is the only
 * way to spell a length, and `mix()` the only way to make a colour that is not one of the
 * four role variables. The effect lint (`test/data/effects.test.js`) enforces both. Everything
 * here is pure, so the same pick emits the same bytes in Node, workerd and the browser.
 *
 * Trigonometry stays in CSS (`cos()` / `sin()`, Baseline since 2023). `Math.cos` is
 * implementation-approximated, so computing the offsets in JS would make the emitted CSS —
 * and therefore every golden snapshot — depend on the engine that rendered it.
 */

import { round4 } from "./rand.js";

/** @import { Bleed, Pair } from "./types.js" */

/**
 * R14: a blurred shadow paints about 1.0x its radius past its offset; 1.1 is the budget
 * with its safety factor. An effect that reserves more says why next to its own factor.
 */
export const REACH = 1.1;

/**
 * A `-webkit-text-stroke` reaches past the contour by this multiple of its width. Half
 * would be the geometry of a centred stroke; Chrome and WebKit miter acute joins well past
 * it, so the full width is the budget.
 */
export const OUTSET = 1;

/** Measured caps (§5.6): hard shadow layers per effect. */
export const CAP = 64;
/** Blurred shadow layers per effect. */
export const BLURS = 4;
/** `filter: drop-shadow()` passes per chain. */
export const CHAIN = 4;
/** The largest blur radius, in u. */
export const MAX_BLUR = 2.5;

/**
 * A length in `u` (1u = 1% of the fitted block width). The only unit an effect may use.
 *
 * @param {number} x
 * @returns {string}
 */
export function u(x) {
  return `calc(${round4(x)}*var(--u))`;
}

/**
 * One hard shadow `k` u from the glyph at `a` degrees. `k` and `a` are already rounded.
 *
 * @param {number} k
 * @param {number} a
 * @param {string} color
 */
const polar = (k, a, color) =>
  `calc(${k}*cos(${a}deg)*var(--u)) calc(${k}*sin(${a}deg)*var(--u)) 0 ${color}`;

/**
 * `n` hard shadow layers marching from the glyph to `dist` u at `angle` degrees: the
 * primitive behind every extrusion and long shadow. Layer 1 sits nearest the face, layer
 * `n` at the full distance, so the ramp is solid at any size.
 *
 * Caps (measured, §5.6): at most `CAP` hard layers per composed effect.
 *
 * @param {number} n number of layers
 * @param {number} angle degrees; 0 = right, 90 = down (CSS shadow axes)
 * @param {number} dist total distance in u
 * @param {string} color one of the role variables, or a `mix()`
 * @returns {string} a `text-shadow` value
 */
export function stack(n, angle, dist, color) {
  const a = round4(angle);
  const out = [];
  for (let i = 1; i <= n; i++) {
    out.push(polar(round4((dist * i) / n), a, color));
  }
  return out.join(",");
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
  const k = round4(r);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(polar(k, round4((360 * i) / n), color));
  }
  return out.join(",");
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
  return `color-mix(in oklab,${a} ${round4(pct)}%,${b})`;
}

/**
 * How many hard layers to spend: `n` rounded, at least `min`, never past `CAP`.
 *
 * @param {number} n the layer count the effect would like
 * @param {number} [min]
 */
export function layers(n, min = 1) {
  return Math.min(CAP, Math.max(min, Math.round(n)));
}

/**
 * The bleed box of ink `dist` u away at `angle` degrees: `dist` on each side the angle
 * points toward, 0 elsewhere. The axes are the shadow's own (0 = right, 90 = down), and an
 * angle exactly on an axis reserves that one side only. Reserving the full distance on a
 * diagonal over-budgets by `1 - cos`, which keeps the trigonometry out of JS.
 *
 * @param {number} angle degrees, 0 ≤ angle < 360
 * @param {number} dist u
 * @returns {Bleed}
 */
export function toward(angle, dist) {
  return {
    t: angle > 180 ? dist : 0,
    r: angle < 90 || angle > 270 ? dist : 0,
    b: angle > 0 && angle < 180 ? dist : 0,
    l: angle > 90 && angle < 270 ? dist : 0,
  };
}

/**
 * The four diagonals as exact ±1 `[x, y]` pairs, clockwise from down-right: a param that
 * picks a quadrant indexes this instead of an angle, so no trigonometry happens in JS.
 *
 * @type {readonly Pair[]}
 */
export const QUAD = Object.freeze(
  /** @type {Pair[]} */ (
    [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ].map((q) => Object.freeze(q))
  ),
);

/**
 * The horizontal sign of a falling diagonal: 45° falls right (1), 135° falls left (-1).
 * Both fall, so an effect drawing only these two never reaches up into the line above.
 *
 * @param {number} angle 45 or 135
 */
export function fall(angle) {
  return angle > 90 ? -1 : 1;
}

/**
 * `n` hard layers stepping along the diagonal `(sx, sy)` from `from` to `to` u per axis:
 * layer `i` (1 … n) sits at `from + (to - from) · i / n` and takes `colorAt(i)`. The
 * per-axis twin of `stack()`, for diagonals given as signs rather than angles.
 *
 * @param {number} n
 * @param {number} sx horizontal sign, usually ±1
 * @param {number} sy vertical sign, usually ±1
 * @param {number} from u per axis, exclusive
 * @param {number} to u per axis, inclusive
 * @param {(i: number) => string} colorAt
 * @returns {string} a `text-shadow` value
 */
export function march(n, sx, sy, from, to, colorAt) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    const k = from + ((to - from) * i) / n;
    out.push(`${u(sx * k)} ${u(sy * k)} 0 ${colorAt(i)}`);
  }
  return out.join(",");
}

/**
 * `stack()` with a colour per layer: `n` hard layers out to `dist` u at `angle` degrees,
 * `tint(t)` giving the colour at fraction `t` (1/n … 1) of the way out. Nearest layer
 * first, because the first-listed shadow paints on top.
 *
 * @param {number} n
 * @param {number} angle degrees
 * @param {number} dist u
 * @param {(t: number) => string} tint
 * @returns {string} a `text-shadow` value
 */
export function ramp(n, angle, dist, tint) {
  return Array.from({ length: n }, (_, i) =>
    stack(1, angle, (dist * (i + 1)) / n, tint((i + 1) / n)),
  ).join(",");
}

/**
 * A shape-B copy of each line on `::before` or `::after`: visible ink with an empty
 * accessible name, the one form §5.6 allows.
 *
 * @param {"before" | "after"} slot
 * @param {string} decls declarations for the copy, without braces
 */
export function copy(slot, decls) {
  return `.l::${slot}{content:attr(data-t) / "";${decls}}`;
}

/**
 * `image` clipped to the letters of each line and sized to the whole block, so one
 * gradient runs through both lines instead of restarting on the second. On `.l`, never on
 * `.n`: older engines drop positioned descendants from the clip.
 *
 * @param {string} image a CSS image, e.g. a `linear-gradient()`
 */
export function clipFill(image) {
  return (
    `.l{background-image:${image};` +
    `background-size:100% calc(var(--bh)*var(--u));` +
    `background-position:0 calc(-1*var(--y)*var(--u));background-repeat:no-repeat;` +
    `-webkit-background-clip:text;background-clip:text;` +
    `-webkit-text-fill-color:transparent;color:transparent}`
  );
}

/** The object handed to effects as `h`. Frozen: it is shared by every request. */
export const helpers = Object.freeze({
  REACH,
  OUTSET,
  CAP,
  BLURS,
  CHAIN,
  MAX_BLUR,
  QUAD,
  u,
  stack,
  ring,
  mix,
  layers,
  toward,
  fall,
  march,
  ramp,
  copy,
  clipFill,
});
