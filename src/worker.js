/**
 * luzid.co — edge renderer.
 *
 * One route. The seed and the CSP nonce are the only two random values, both drawn inside
 * the fetch handler (Workers forbid random generation at global scope). Everything else is
 * `pick()` and `render()`, which are pure: the same seed and the same catalog give the
 * same bytes in Node, in workerd and in a browser.
 */

import catalog from '../build/catalog.js'
import { PickError, pick, pickString } from './pick.js'
import { render } from './render.js'

const SEED_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz' // Crockford base32, lowercase
const SEED_RE = /^[0-9a-hjkmnp-tv-z]{1,16}$/
const PIN_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/
/** Role-set ids are the `o` string: hex indices, `w`/`k` for a derived ground, `-` for an alias. */
const ROLE_RE = /^[0-9wk-]{4}$/
const PINS = /** @type {const} */ (['f', 'v', 'p', 'r', 'e', 'l'])

/** @param {number} n */
function randomSeed(n = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(n))
  let out = ''
  for (const b of bytes) out += SEED_ALPHABET[b & 31]
  return out
}

/** Base64 of 16 random bytes: the per-request CSP nonce. Never derived from the seed. */
function nonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
}

/**
 * @param {string} n
 * @param {string} pick
 */
function headers(n, pick) {
  return {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': [
      "default-src 'none'",
      `style-src 'nonce-${n}'`,
      "style-src-attr 'none'",
      `script-src 'nonce-${n}'`,
      'font-src data:',
      "img-src 'self' data:",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
    'cache-control': 'no-store',
    'strict-transport-security': 'max-age=31536000',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'luzid-pick': pick,
  }
}

export default {
  /**
   * @param {Request} request
   */
  async fetch(request) {
    const url = new URL(request.url)

    // Cheapest branch first: anything that is not the one route never costs a render.
    if (url.pathname !== '/') return new Response('Not found', { status: 404 })
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
    }

    const given = url.searchParams.get('seed')
    if (given !== null && !SEED_RE.test(given)) return new Response('Bad seed', { status: 400 })
    const seed = given ?? randomSeed()

    // Pins are ids. They are shape-checked here and existence-checked by `pick()`; raw
    // input is never echoed, not in the body, not in a header.
    /** @type {Record<string, string>} */
    const pins = {}
    for (const k of PINS) {
      const v = url.searchParams.get(k)
      if (v === null) continue
      const ok = k === 'r' ? ROLE_RE.test(v) : PIN_RE.test(v)
      if (!ok) return new Response('Bad pin', { status: 400 })
      pins[k] = v
    }

    let chosen
    try {
      chosen = pick(seed, pins, catalog)
    } catch (err) {
      if (err instanceof PickError) return new Response('Bad pin', { status: 400 })
      throw err
    }

    const n = nonce()
    const pickStr = pickString(chosen)
    const body = render(chosen, catalog, { nonce: n, pick: pickStr })

    console.log(JSON.stringify({ seed, pick: pickStr }))
    return new Response(request.method === 'HEAD' ? null : body, { headers: headers(n, pickStr) })
  },
}
