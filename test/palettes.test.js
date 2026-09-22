import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { colors } from '../scripts/palette-sources/wada1.mjs'
import { contrast, grounds, roleSets } from '../scripts/roles.mjs'

const HEX = /^#[0-9a-f]{6}$/
const path = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url))
const wada1 = JSON.parse(await readFile(path('data/palettes/wada1.json'), 'utf8'))

/** `o` resolves to four concrete colours: a digit indexes `hex`, `w`/`k` are the grounds. */
function resolve(row) {
  const [bg, fg, a1, a2] = [...row.o0].map((c) =>
    c === 'w' ? row.hex[row.n] : c === 'k' ? row.hex[row.n + 1] : row.hex[Number(c)],
  )
  return { bg, fg, a1: a1 ?? fg, a2: a2 ?? bg }
}

const sets = wada1.flatMap((r) => r.roles.map((s) => ({ ...s, id: r.id, hex: r.hex, o0: s.o })))

test('the committed data is what the generator produces', () => {
  // The roles are committed so a deploy never runs colour maths; this is what keeps them honest.
  execFileSync(process.execPath, [path('scripts/palettes.mjs'), '--check'], { stdio: 'pipe' })
})

test('Wada vol. 1 has 159 colours', async () => {
  const cs = await colors()
  assert.equal(cs.length, 159)
  assert.equal(new Set(cs.map((c) => c.hex)).size, 159, 'colours must be distinct by hex')
  assert.equal(new Set(cs.map((c) => c.name)).size, 159, 'colours must be distinct by name')
  assert.equal(new Set(wada1.flatMap((r) => r.hex.slice(0, r.names.length))).size, 159)
})

test('Wada vol. 1 has 348 combos, 120 duos / 120 trios / 108 quads', () => {
  assert.equal(wada1.length, 348)
  const sizes = { 2: 0, 3: 0, 4: 0 }
  for (const row of wada1) sizes[row.names.length]++
  assert.deepEqual(sizes, { 2: 120, 3: 120, 4: 108 })
})

test('every combo id is unique and namespaced wada1-001…wada1-348', () => {
  const ids = wada1.map((r) => r.id)
  assert.equal(new Set(ids).size, 348, 'duplicate combo id')
  assert.deepEqual(
    ids,
    Array.from({ length: 348 }, (_, i) => `wada1-${String(i + 1).padStart(3, '0')}`),
  )
})

test('every row has the §5.4 shape', () => {
  for (const row of wada1) {
    assert.equal(row.src, 'wada1', `${row.id}: src`)
    assert.equal(row.tier, 'historical', `${row.id}: tier`)
    assert.equal(row.odds, 4, `${row.id}: odds`)
    assert.ok(
      row.names.every((n) => typeof n === 'string' && n.length > 0),
      `${row.id}: names`,
    )
    assert.ok(row.roles.length > 0, `${row.id}: no role set`)
    assert.equal(new Set(row.roles.map((s) => s.o)).size, row.roles.length, `${row.id}: duplicate role set`)
    // Derived grounds are appended after the palette's own colours, washi then sumi.
    const derived = row.roles.some((s) => s.derivedBg)
    assert.equal(row.hex.length, row.names.length + (derived ? 2 : 0), `${row.id}: hex length`)
    if (derived) assert.deepEqual(row.hex.slice(row.names.length), grounds(row.hex), `${row.id}: grounds`)
  }
})

test('every hex is a lowercase six-digit sRGB literal', () => {
  for (const row of wada1) {
    for (const hex of row.hex) assert.match(hex, HEX, `${row.id}`)
  }
})

test('every role set names a background and a foreground, and aliases the rest', () => {
  for (const s of sets) {
    assert.match(s.o, /^[0-3wk][0-3][0-3-][0-3-]$/, `${s.id}: o "${s.o}"`)
    assert.equal(s.n, wada1.find((r) => r.id === s.id).names.length, `${s.id}: n`)
    assert.equal(s.derivedBg, 'wk'.includes(s.o[0]) ? s.o[0] : null, `${s.id}: derivedBg`)
    const used = [...s.o].filter((c) => c !== '-')
    assert.equal(new Set(used).size, used.length, `${s.id}: a colour holds two roles in "${s.o}"`)
    for (const c of used) {
      if (!'wk'.includes(c)) assert.ok(Number(c) < s.n, `${s.id}: "${s.o}" indexes a derived ground`)
    }
    // With two colours --a1 is fg and --a2 is bg, so all four properties are always defined.
    const roles = resolve(s)
    for (const [role, hex] of Object.entries(roles)) assert.match(hex, HEX, `${s.id}: ${role}`)
  }
})

test('every emitted role set reaches WCAG 3:1 between bg and fg', () => {
  for (const s of sets) {
    const { bg, fg } = resolve(s)
    const ratio = contrast(bg, fg)
    assert.ok(ratio >= 3, `${s.id} "${s.o}": ${bg} on ${fg} is ${ratio.toFixed(2)}:1`)
    assert.equal(s.dark, contrast(bg, '#ffffff') > contrast(bg, '#000000'), `${s.id} "${s.o}": dark`)
  }
})

test('a combo falls back to a derived ground only when no pair of its own colours passes', () => {
  for (const row of wada1) {
    const own = row.hex.slice(0, row.names.length)
    const best = Math.max(...own.flatMap((a) => own.map((b) => contrast(a, b))))
    assert.equal(
      row.roles.some((s) => s.derivedBg),
      best < 3,
      `${row.id}: best pair is ${best.toFixed(2)}:1`,
    )
  }
})

test('the hand-rolled WCAG maths matches its reference values', () => {
  assert.equal(contrast('#000000', '#ffffff'), 21)
  assert.equal(contrast('#ffffff', '#ffffff'), 1)
  assert.ok(Math.abs(contrast('#888888', '#ffffff') - 3.54) < 0.01)
  // Wada's palettes are hue-contrast, not luminance-contrast: combo 1 is 1.03:1.
  assert.ok(Math.abs(contrast('#d96629', '#0093a5') - 1.03) < 0.01)
})

test('role assignment always terminates', () => {
  // Washi clears 3:1 against anything with Y <= .275, sumi against anything with Y >= .112;
  // the ranges overlap, so every colour reaches one of the two grounds.
  for (const hex of ['#ffffff', '#000000', '#808080', '#7f7f7f', '#111314', '#d96629']) {
    assert.ok(roleSets([hex, hex]).length > 0, hex)
  }
})

test('the vendored MIT licence ships with the data', async () => {
  await access(path('data/sources/wada1/LICENSE'))
  const licence = await readFile(path('data/sources/wada1/LICENSE'), 'utf8')
  assert.match(licence, /MIT License/)
  assert.match(licence, /Copyright/)
})

test('report: role sets and derived grounds', () => {
  const derived = sets.filter((s) => s.derivedBg)
  const combos = wada1.filter((r) => r.roles.some((s) => s.derivedBg)).length
  console.log(
    `wada1: ${wada1.length} combos → ${sets.length} role sets; derivedBg on ${derived.length} ` +
      `(${derived.filter((s) => s.derivedBg === 'w').length} washi, ` +
      `${derived.filter((s) => s.derivedBg === 'k').length} sumi) across ${combos} combos; ` +
      `${sets.filter((s) => s.dark).length} dark grounds`,
  )
})
