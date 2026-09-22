/**
 * Post-deploy smoke test.  node scripts/smoke.mjs https://luzid.co
 *
 * Worker-level failures justify a rollback. Zone-level ones (an injected beacon, Speed
 * Brain) fail the job but must NOT roll the Worker back — the fix is a dashboard toggle.
 */
import { get } from 'node:https'

const url = process.argv[2] ?? 'https://luzid.co'
const BUDGET = 14_000

/** @type {string[]} */
const worker = []
/** @type {string[]} */
const zone = []

/** Fetch once over raw https so we can count on-wire bytes; fetch() decompresses silently. */
function fetchRaw(target, encoding) {
  return new Promise((ok, fail) => {
    const req = get(
      target,
      { headers: { 'accept-encoding': encoding, 'user-agent': 'luzid-smoke' } },
      (res) => {
        let bytes = 0
        const chunks = []
        res.on('data', (c) => {
          bytes += c.length
          chunks.push(c)
        })
        res.on('end', () =>
          ok({ status: res.statusCode, headers: res.headers, bytes, raw: Buffer.concat(chunks) }),
        )
      },
    )
    req.on('error', fail)
    req.setTimeout(15_000, () => req.destroy(new Error('timeout')))
  })
}

const a = await fetchRaw(url, 'br')
const b = await fetchRaw(url, 'br')

if (a.status !== 200) worker.push(`status ${a.status}, expected 200`)
if (a.headers['cache-control'] !== 'no-store')
  worker.push(`cache-control is "${a.headers['cache-control']}", expected no-store`)
if (!/nonce-/.test(a.headers['content-security-policy'] ?? ''))
  worker.push('CSP header missing or has no nonce')
if (!a.headers['luzid-pick']) worker.push('Luzid-Pick header missing')
if (a.headers['luzid-pick'] === b.headers['luzid-pick'])
  worker.push('two requests returned the same pick — the page is not randomizing')
if ((a.headers['cf-cache-status'] ?? '') === 'HIT')
  worker.push('cf-cache-status is HIT — the HTML is being cached')

// Body checks need the decoded text; ask for identity so we can read it directly.
const plain = await fetchRaw(url, 'identity')
const html = plain.raw.toString('utf8')
if (!html.includes('https://github.com/tomasz')) worker.push('body is missing the GitHub link')
if (!html.includes('Tomasz Cudzi')) worker.push('body is missing the name')

if (a.bytes > BUDGET) worker.push(`on-wire size ${a.bytes} B exceeds the ${BUDGET} B budget`)
if (a.headers['content-encoding'] !== 'br')
  zone.push(`content-encoding is "${a.headers['content-encoding']}", expected br`)

for (const needle of ['<script src', 'cloudflareinsights', '/cdn-cgi/']) {
  if (html.includes(needle)) zone.push(`zone feature injected "${needle}" into the page`)
}
if (a.headers['speculation-rules']) zone.push('Speed Brain is on (speculation-rules header present)')

console.log(
  `${url} → ${a.status}, ${a.bytes} B on the wire (budget ${BUDGET}), pick "${a.headers['luzid-pick']}"`,
)
for (const f of worker) console.error(`worker: ${f}`)
for (const f of zone) console.error(`zone:   ${f}`)

if (worker.length) {
  console.error('\nWorker-level failures — the deploy should be rolled back.')
  process.exitCode = 1
} else if (zone.length) {
  console.error('\nZone-level failures only — fix the Cloudflare toggles; do NOT roll back.')
  process.exitCode = 2
} else {
  console.log('smoke: all checks passed')
}
