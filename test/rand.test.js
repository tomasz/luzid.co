import assert from 'node:assert/strict'
import { glob, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { draw, flag, h32, mix32, round4, step, weighted } from '../src/rand.js'

const hex = (n) => n.toString(16).padStart(8, '0')
const root = resolve(import.meta.dirname, '..')

test('h32 golden vectors', () => {
  // These pin the construct itself. They were measured on Node 24 / V8 13.6 and are
  // reproduced verbatim in docs/contracts.md; any change to h32 is a contract change that
  // reshuffles every seed in existence.
  assert.equal(hex(h32('')), 'ab3e7c0b')
  assert.equal(hex(h32('a')), 'b3478aa8')
  assert.equal(hex(h32('font:rubik-mono-one')), '66cc69e9')
})

test('mix32 golden vectors', () => {
  assert.equal(hex(mix32(1)), '86d2fa73')
  assert.equal(hex(mix32(0xdeadbeef)), '2a2acaf2')
  assert.equal(hex(mix32(0)), '00000000', 'the splitmix32 finalizer fixes zero; harmless, but pinned')
})

test('draw is the keyed hash over seed + U+001F + key', () => {
  assert.equal(hex(h32('k3f9x2m7qa\u001ff')), '1a30d477')
  assert.equal(draw('k3f9x2m7qa', 'f'), h32('k3f9x2m7qa\u001ff') / 4294967296)
  // The research's own key vectors, with its axis paths.
  assert.equal(hex(h32('k3f9x2m7qa\u001ffont')), '76b82890')
  assert.equal(hex(h32('k3f9x2m7qa\u001ffx/depth')), '10a2f047')
})

test('every draw lands in [0, 1)', () => {
  for (let i = 0; i < 5000; i++) {
    const d = draw(`s${i}`, 'f')
    assert.ok(d >= 0 && d < 1, `draw out of range: ${d}`)
  }
})

test('draws on different axes are independent', () => {
  // A shared sequential stream would make these correlate; keyed draws cannot.
  let both = 0
  const n = 20000
  for (let i = 0; i < n; i++) {
    if (draw(`s${i}`, 'f') < 0.5 && draw(`s${i}`, 'e') < 0.5) both++
  }
  const p = both / n
  assert.ok(Math.abs(p - 0.25) < 0.015, `joint share ${p}, expected ~0.25`)
})

test('weighted picks proportionally to the odds and is order-independent', () => {
  const items = [
    { id: 'c', odds: 1 },
    { id: 'a', odds: 4 },
    { id: 'b', odds: 3 },
  ]
  const count = { a: 0, b: 0, c: 0 }
  const n = 40000
  for (let i = 0; i < n; i++) count[weighted(`s${i}`, 'x', items, (x) => x.odds).id]++

  assert.ok(Math.abs(count.a / n - 0.5) < 0.015, `a share ${count.a / n}`)
  assert.ok(Math.abs(count.b / n - 0.375) < 0.015, `b share ${count.b / n}`)
  assert.ok(Math.abs(count.c / n - 0.125) < 0.015, `c share ${count.c / n}`)

  // The scan sorts by id, so shuffling the array cannot change a single outcome.
  const shuffled = [items[1], items[2], items[0]]
  for (const s of ['a', 'zz', 'k3f9x2m7qa']) {
    assert.equal(weighted(s, 'x', items, (x) => x.odds).id, weighted(s, 'x', shuffled, (x) => x.odds).id)
  }
})

test('weighted never returns an odds-0 item unless every item is retired', () => {
  const items = [
    { id: 'live', odds: 4 },
    { id: 'retired', odds: 0 },
  ]
  for (let i = 0; i < 2000; i++) {
    assert.equal(weighted(`s${i}`, 'x', items, (x) => x.odds).id, 'live')
  }
  // Total 0: stay total rather than throw. `pick()` relaxes to this only as a last resort.
  const dead = [
    { id: 'a', odds: 0 },
    { id: 'b', odds: 0 },
  ]
  assert.equal(weighted('s', 'x', dead, (x) => x.odds).id, 'a')
})

test('weighted on an empty candidate set is null, never a throw', () => {
  assert.equal(
    weighted('s', 'x', [], () => 4),
    null,
  )
})

test('step lands on a quantized value and covers the whole range', () => {
  const spec = [3, 9, 1]
  const seen = new Set()
  for (let i = 0; i < 5000; i++) {
    const v = step(`s${i}`, 'p', spec)
    assert.ok(Number.isInteger(v) && v >= 3 && v <= 9, `off-grid value ${v}`)
    seen.add(v)
  }
  assert.equal(seen.size, 7)

  // A one-step spec must not divide by an empty range.
  assert.equal(step('s', 'p', [5, 5, 1]), 5)
  // Non-integer grids stay on the grid.
  for (let i = 0; i < 200; i++) {
    const v = step(`s${i}`, 'q', [0.1, 0.5, 0.1])
    assert.ok([0.1, 0.2, 0.3, 0.4, 0.5].includes(v), `off-grid ${v}`)
  }
})

test('flag hits its declared probability', () => {
  let on = 0
  const n = 40000
  for (let i = 0; i < n; i++) if (flag(`s${i}`, 'l/side', 1, 4)) on++
  assert.ok(Math.abs(on / n - 0.25) < 0.01, `side share ${on / n}`)
})

test('round4 kills the negative zero that would show up in a golden', () => {
  assert.equal(round4(1.23456789), 1.2346)
  assert.equal(String(round4(-0.00001)), '0')
})

test('src/ contains no engine-dependent maths and no clock', async () => {
  // Workers, Node, Firefox and Safari must agree bit for bit. Math.log/pow/sin/exp are
  // "implementation-approximated" in ECMA-262; Math.random and Date are not pure.
  const banned =
    /Math\.(random|pow|log|log2|log10|exp|sin|cos|tan|atan2|hypot|cbrt)\b|\bDate\.now\b|new Date\b/
  const files = []
  for await (const f of glob('src/*.js', { cwd: root })) files.push(f)
  assert.ok(files.length >= 5, 'expected the five engine files')

  for (const f of files) {
    const src = await readFile(resolve(root, f), 'utf8')
    // Strip comments: the ban is on calls, and the files explain why the ban exists.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const hit = code.match(banned)
    assert.equal(hit, null, `${f} uses ${hit?.[0]}`)
  }
})
