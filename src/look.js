/**
 * The wire format of a look: the query a request pins it with and the Pick string it is
 * reported as. Pure, no imports; the worker, the renderer and the e2e suite share it.
 */

/** @import { AxisKey, Look, Pins } from "./types.js" */

/** The pinnable axes, in draw order. They are also the `data/deny.json` rule keys. */
export const AXIS_KEYS = /** @type {readonly AxisKey[]} */ (
  Object.freeze(["f", "v", "p", "r", "e", "l"])
);

/** §5.3: Crockford base32, lowercase. */
export const SEED_RE = /^[0-9a-hjkmnp-tv-z]{1,16}$/;

const ID_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;

/**
 * The shape a pin must have on each axis. Role-set ids are the `o` string: hex indices,
 * `w`/`k` for a derived ground, `-` for an alias.
 * @type {Readonly<Record<AxisKey, RegExp>>}
 */
export const PIN_PATTERNS = Object.freeze({
  f: ID_RE,
  v: ID_RE,
  p: ID_RE,
  r: /^[0-9wk-]{4}$/,
  e: ID_RE,
  l: ID_RE,
});

/**
 * The request's seed and pins, shape-checked. Existence is `pick()`'s job.
 *
 * @param {URLSearchParams} query
 * @returns {{ok: true, seed: string | null, pins: Pins} | {ok: false, reason: "seed" | "pin"}}
 */
export function parseQuery(query) {
  const seed = query.get("seed");
  if (seed !== null && !SEED_RE.test(seed)) return { ok: false, reason: "seed" };
  /** @type {Pins} */
  const pins = {};
  for (const k of AXIS_KEYS) {
    const v = query.get(k);
    if (v === null) continue;
    if (!PIN_PATTERNS[k].test(v)) return { ok: false, reason: "pin" };
    pins[k] = v;
  }
  return { ok: true, seed, pins };
}

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

const PICK_RE =
  /^f:(\S+)\.([^.\s]+) p:(\S+)\.([0-9wk-]{4}) e:([a-z0-9.-]+)(?:\(([^)]*)\))? l:([a-z0-9-]+)\(g=([\d.]+),a=([a-z-]+)(,side)?\)$/;

/**
 * The inverse of `pickString()`, for tools that only have the header or the colophon.
 * The font id ends at the last dot: variant ids and role sets never contain one.
 *
 * @param {string} s
 * @returns {Pins & {params: Record<string, number>, g: number, align: string, side: boolean} | null}
 */
export function parsePickString(s) {
  const m = PICK_RE.exec(s);
  if (!m) return null;
  const [, f, v, p, r, e, kv, l, g, align, side] = /** @type {string[]} */ (m);
  /** @type {Record<string, number>} */
  const params = {};
  for (const pair of kv ? kv.split(",") : []) {
    const [k, n] = pair.split("=");
    params[/** @type {string} */ (k)] = Number(n);
  }
  return {
    f,
    v,
    p,
    r,
    e,
    l,
    params,
    g: Number(g),
    align: /** @type {string} */ (align),
    side: side !== undefined,
  };
}
