/**
 * The layout registry. Layouts are engine, not data: a new one is a row here, and its
 * `divisors` are the whole of what the fit maths needs to know about it (§5.2).
 */

/** @import { Align, Chance, Layout, ParamSpec } from "./types.js" */

export const LAYOUTS = Object.freeze(
  /** @type {Layout[]} */ ([
    // Both lines share one scale, so the wider line sets it.
    {
      id: "stack-eq",
      odds: 4,
      divisors: (w1, w2) => {
        const wide = Math.max(w1.W, w2.W);
        return [wide, wide];
      },
    },
    // Each line fills the block width on its own.
    {
      id: "stack-fit",
      odds: 12,
      divisors: (w1, w2) => [w1.W, w2.W],
    },
  ]),
);

/**
 * Cross-axis alignment of the two lines. Only `stack-eq` can show a difference.
 * @type {readonly {id: Align, odds: number}[]}
 */
export const ALIGNS = [
  { id: "center", odds: 8 },
  { id: "flex-end", odds: 4 },
  { id: "flex-start", odds: 4 },
];

/** @type {ParamSpec} Gap between the two lines, in u. */
export const GAP = [4, 10, 2];

/** @type {Chance} D8: about a quarter of seeds add the rotated portrait variant. */
export const SIDE = [1, 4];
