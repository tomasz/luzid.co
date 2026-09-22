/**
 * Deterministic randomness for the pick. Integer math only.
 *
 * Every draw is keyed: `draw(seed, key)` hashes the whole seed together with a stable
 * axis path, so call order is irrelevant and adding an axis never reshuffles the others.
 * There is no shared sequential stream; an extra draw somewhere cannot shift a later one.
 *
 * Nothing here may use `Math.random`, `Math.pow`, `Math.log` or any other
 * implementation-approximated function: Node, workerd and the browsers have to agree bit
 * for bit. `Math.imul`, the bitwise operators, `Math.floor` and division by 2**32 are all
 * exactly specified by ECMA-262.
 *
 * Golden vectors live in `docs/contracts.md` and `test/rand.test.js`.
 */

/** Unit separator: it cannot occur in a seed or an axis key, so `seed + US + key` is injective. */
const US = '\u001f'

const POW32 = 4294967296

/**
 * xmur3a, one-shot: a murmur3 block round per UTF-16 code unit over the FNV offset basis,
 * finished with murmur3's `fmix32`. Not byte-exact MurmurHash3_x86_32, so the standard
 * murmur3 vectors do not apply — use the golden vectors in `docs/contracts.md`.
 *
 * @param {string} str
 * @returns {number} uint32
 */
export function h32(str) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    let k = Math.imul(str.charCodeAt(i), 3432918353)
    k = (k << 15) | (k >>> 17)
    h ^= Math.imul(k, 461845907)
    h = (h << 13) | (h >>> 19)
    h = (Math.imul(h, 5) + 3864292196) | 0
  }
  h ^= str.length
  h ^= h >>> 16
  h = Math.imul(h, 2246822507)
  h ^= h >>> 13
  h = Math.imul(h, 3266489909)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * splitmix32's finalizer: a bijection on uint32, so it is equidistributed. It is not part
 * of `h32`; it is here for recipes that need to decorrelate a counter from one keyed draw
 * without spending a second string hash.
 *
 * @param {number} h uint32
 * @returns {number} uint32
 */
export function mix32(h) {
  let x = h | 0
  x ^= x >>> 16
  x = Math.imul(x, 0x21f0aaad)
  x ^= x >>> 15
  x = Math.imul(x, 0x735a2d97)
  x ^= x >>> 15
  return x >>> 0
}

/**
 * The one draw primitive: a stateless uniform in [0, 1).
 *
 * @param {string} seed
 * @param {string} key stable axis path, e.g. `f`, `e/depth-extrude/d`, `l/side`
 * @returns {number}
 */
export function draw(seed, key) {
  return h32(seed + US + key) / POW32
}

/**
 * Round to 4 decimals. Every number that reaches CSS text goes through this, so a golden
 * snapshot can never move because of a last-ulp difference.
 *
 * @param {number} n
 * @returns {number}
 */
export function round4(n) {
  return Math.round(n * 10000) / 10000
}

/**
 * Weighted pick: a cumulative scan over candidates sorted by id. Odds are integers; the
 * caller supplies them already clamped (item odds are 0–16, a `prefer` bonus doubles).
 *
 * Sorting by id — not by array order — is what makes the result independent of how the
 * catalog happened to be globbed.
 *
 * @template {{id: string}} T
 * @param {string} seed
 * @param {string} key
 * @param {readonly T[]} candidates
 * @param {(item: T) => number} oddsOf
 * @returns {T | null}
 */
export function weighted(seed, key, candidates, oddsOf) {
  const items = [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  if (items.length === 0) return null

  const odds = new Array(items.length)
  let total = 0
  for (let i = 0; i < items.length; i++) {
    const o = Math.floor(oddsOf(items[i]))
    odds[i] = o > 0 ? o : 0
    total += odds[i]
  }
  // Every odds is 0 (a catalog of retired items only). Stay total: return the first.
  if (total === 0) return items[0]

  let x = Math.floor(draw(seed, key) * total)
  for (let i = 0; i < items.length; i++) {
    x -= odds[i]
    if (x < 0) return items[i]
  }
  return items[items.length - 1]
}

/**
 * Quantized parameter: `[min, max, step]` becomes a step index, so a param can never land
 * between two authored values.
 *
 * @param {string} seed
 * @param {string} key
 * @param {readonly [number, number, number]} spec
 * @returns {number}
 */
export function step(seed, key, spec) {
  const [min, max, size] = spec
  const n = Math.floor((max - min) / size) + 1
  const i = n > 1 ? Math.floor(draw(seed, key) * n) : 0
  return round4(min + i * size)
}

/**
 * Keyed flag with probability `numer / denom`.
 *
 * @param {string} seed
 * @param {string} key
 * @param {number} numer
 * @param {number} denom
 * @returns {boolean}
 */
export function flag(seed, key, numer, denom) {
  return Math.floor(draw(seed, key) * denom) < numer
}
