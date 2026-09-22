/**
 * luzid.co — edge renderer.
 *
 * Skeleton (WP-00): one route, the real headers, the real document shell, a system font.
 * WP-10 replaces `renderSkeleton` with the pick/render engine; the routing and headers here
 * are the contract and stay as they are.
 */

const SEED_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz' // Crockford base32, lowercase
const SEED_RE = /^[0-9a-hjkmnp-tv-z]{1,16}$/

/** @param {number} n */
function randomSeed(n = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(n))
  let out = ''
  for (const b of bytes) out += SEED_ALPHABET[b & 31]
  return out
}

/** Base64 of 16 random bytes: the per-request CSP nonce. */
function nonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** @param {string} s */
const esc = (s) => s.replace(/[&<>"']/g, (c) => ESCAPES[c])

/**
 * @param {{seed: string, nonce: string, pick: string}} ctx
 */
function renderSkeleton({ seed, nonce: n, pick }) {
  const css = `
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
html,body{height:100%;margin:0;overflow:clip;background:var(--bg)}
body{display:grid;place-content:center;place-content:unsafe center}
h1{margin:0;font:inherit}
:root{--bg:#f3efe6;--fg:#1d1b18}
.n{--m:max(12px,2vmin);
 --aw:calc(100vw - 2*var(--m) - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px));
 --ah:calc(100svh - 2*var(--m) - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));
 --bw:calc(.985*min(var(--aw)/1,var(--ah)/.42));--u:calc(var(--bw)/100);
 display:flex;flex-direction:column;width:var(--bw);isolation:isolate;
 font-family:ui-serif,Georgia,serif;font-weight:700;font-synthesis:none;font-kerning:normal;
 text-rendering:geometricPrecision;white-space:nowrap;text-decoration:none;color:var(--fg)}
.l{display:block;position:relative}
.l1{font-size:calc(var(--bw)/3.6)}
.l2{font-size:calc(var(--bw)/4.1)}
a.n:focus-visible{outline:max(3px,.35vmin) solid var(--fg);outline-offset:max(4px,.5vmin)}
@media (prefers-contrast:more){:root{--bg:#fff;--fg:#000}}
@media print{html,body{background:none}.n{color:#000}}`.trim()

  return `<!doctype html>
<html lang="pl" translate="no" data-seed="${esc(seed)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Tomasz Cudziło</title>
<meta name="description" lang="en" content="Tomasz Cudziło on GitHub.">
<meta name="google" content="notranslate">
<link rel="canonical" href="https://luzid.co/">
<meta name="theme-color" content="#f3efe6"><meta name="color-scheme" content="light">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:title" content="Tomasz Cudziło"><meta property="og:type" content="profile">
<meta property="og:url" content="https://luzid.co/"><meta property="og:image" content="https://luzid.co/og.png">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Person","name":"Tomasz Cudziło","url":"https://luzid.co/","sameAs":["https://github.com/tomasz"]}</script>
<!-- ${esc(pick)} -->
<script nonce="${n}">addEventListener("pageshow",e=>{e.persisted&&location.reload()})</script>
<style nonce="${n}">${css}</style>
</head>
<body><h1><a class="n" href="https://github.com/tomasz" rel="me"><span class="l l1" data-t="Tomasz">Tomasz</span> <span class="l l2" data-t="Cudziło">Cudziło</span></a></h1></body>
</html>`
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

    const n = nonce()
    const pick = `seed:${seed} f:system p:skeleton e:plain l:stack-fit`
    const body = renderSkeleton({ seed, nonce: n, pick })

    console.log(JSON.stringify({ seed, pick }))
    return new Response(request.method === 'HEAD' ? null : body, { headers: headers(n, pick) })
  },
}
