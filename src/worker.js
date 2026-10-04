/**
 * luzid.co — edge renderer.
 *
 * One route. The seed and the CSP nonce are the only two random values, both drawn inside
 * the fetch handler (Workers forbid random generation at global scope). Everything else is
 * `pick()`, `resolve()` and `render()`, which are pure: the same seed and the same catalog
 * give the same bytes in Node, in workerd and in a browser.
 */

import catalog from "../build/catalog.js";
import { parseQuery, pickString } from "./look.js";
import { PickError, pick, resolve } from "./pick.js";
import { render } from "./render.js";

const SEED_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford base32, lowercase

/** @param {number} n */
function randomSeed(n = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let out = "";
  for (const b of bytes) out += SEED_ALPHABET[b & 31];
  return out;
}

/** Base64 of 16 random bytes: the per-request CSP nonce. Never derived from the seed. */
function newNonce() {
  return crypto.getRandomValues(new Uint8Array(16)).toBase64();
}

/**
 * @param {string} nonce
 * @param {string} pickStr
 */
function headers(nonce, pickStr) {
  return {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": [
      "default-src 'none'",
      `style-src 'nonce-${nonce}'`,
      "style-src-attr 'none'",
      `script-src 'nonce-${nonce}'`,
      "font-src data:",
      "img-src 'self' data:",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
    "cache-control": "no-store",
    "strict-transport-security": "max-age=31536000",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "luzid-pick": pickStr,
  };
}

export default {
  /**
   * @param {Request} request
   */
  async fetch(request) {
    const url = new URL(request.url);

    // Cheapest branch first: anything that is not the one route never costs a render.
    if (url.pathname !== "/") return new Response("Not found", { status: 404 });
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }

    // Pins are ids. They are shape-checked here and existence-checked by `pick()`; raw
    // input is never echoed, not in the body, not in a header.
    const query = parseQuery(url.searchParams);
    if (!query.ok) {
      return new Response(query.reason === "seed" ? "Bad seed" : "Bad pin", { status: 400 });
    }
    const seed = query.seed ?? randomSeed();

    let look;
    try {
      look = pick(catalog, seed, query.pins);
    } catch (err) {
      if (err instanceof PickError) return new Response("Bad pin", { status: 400 });
      throw err;
    }

    const nonce = newNonce();
    const pickStr = pickString(look);
    const body = render(resolve(catalog, look), nonce);

    console.log(JSON.stringify({ seed, pick: pickStr }));
    return new Response(request.method === "HEAD" ? null : body, {
      headers: headers(nonce, pickStr),
    });
  },
};
