/**
 * The wire format of a look: the Pick string it is reported as. Pure, no imports; the
 * worker and the renderer share it.
 */

/** @import { Look } from "./types.js" */

/**
 * The canonical Pick string (R9): the `Luzid-Pick` header, the colophon comment and the
 * unit that a deny rule or a bug report is written against.
 *
 *   f:<id>.<variant> p:<id>.<roles> e:<id>(k=v,…) l:<id>(g=…,a=…[,side])
 *
 * @param {Look} look
 * @returns {string}
 */
export function pickString(look) {
  const kv = Object.keys(look.params)
    .sort()
    .map((k) => `${k}=${look.params[k]}`)
    .join(",");
  const lp = [`g=${look.g}`, `a=${look.align}`, ...(look.side ? ["side"] : [])].join(",");
  return `f:${look.f}.${look.v} p:${look.p}.${look.r} e:${look.e}${kv ? `(${kv})` : ""} l:${look.l}(${lp})`;
}
