/**
 * `docs/contracts.md` is the source of truth every other work package reads. These tests
 * stop it drifting away from the code it describes — a stale contract is worse than none.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { h32, mix32 } from '../src/rand.js'

const root = resolve(import.meta.dirname, '..')
const doc = await readFile(resolve(root, 'docs/contracts.md'), 'utf8')

test('the h32 listing in the contract is the code that actually runs', async () => {
  const src = await readFile(resolve(root, 'src/rand.js'), 'utf8')
  const listing = doc.match(/```js\n(export function h32[\s\S]*?)\n```/)?.[1]
  assert.ok(listing, 'docs/contracts.md has no h32 listing')

  const real = src.match(/(export function h32[\s\S]*?\n\})/)?.[1]
  assert.equal(listing, real, 'the h32 listing has drifted from src/rand.js')
})

test('the golden vectors in the contract are the ones h32 produces', () => {
  const hex = (n) => n.toString(16).padStart(8, '0')
  const rows = [...doc.matchAll(/^\| `([^|]+)` \| `([0-9a-f]{8})` \|$/gm)]
  assert.ok(rows.length >= 6, `expected the golden-vector table, found ${rows.length} rows`)

  for (const [, input, want] of rows) {
    // The table spells the separator out, because a literal control character in a Markdown
    // table is invisible and unreviewable.
    const parts = input.split(' + ').map((x) => (x === 'U+001F' ? '' : JSON.parse(x.replaceAll('`', ''))))
    assert.equal(hex(h32(parts.join(''))), want, `h32(${input})`)
  }

  assert.ok(doc.includes('`mix32(1) = 86d2fa73`'))
  assert.equal(hex(mix32(1)), '86d2fa73')
  assert.equal(hex(mix32(0xdeadbeef)), '2a2acaf2')
})

test('the contract carries §5 whole', () => {
  for (const heading of [
    '### 5.1 HTML skeleton',
    '### 5.2 Fit contract',
    '### 5.3 Randomization',
    '### 5.4 Palettes',
    '### 5.5 Fonts',
    '### 5.6 Effects',
    '### 5.7 Presets hook',
    '### 5.8 Accessibility gating',
  ]) {
    assert.ok(doc.includes(heading), `docs/contracts.md is missing "${heading}"`)
  }
  // Every resolution is numbered and referenced from nowhere else, so gaps are visible.
  const ids = [...doc.matchAll(/^### (R\d+) — /gm)].map((m) => m[1])
  assert.deepEqual(
    ids,
    ids.map((_, i) => `R${i + 1}`),
    'the resolutions are not numbered consecutively',
  )
})
