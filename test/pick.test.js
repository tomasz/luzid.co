import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BUCKET_ODDS, denied, LAYOUTS, PickError, pick, pickString } from '../src/pick.js'
import { fixtureCatalog, GOLDEN_SEEDS } from './catalog.js'

const catalog = await fixtureCatalog()
const str = (seed, pins = {}) => pickString(pick(seed, pins, catalog))

test('pick golden vectors', () => {
  // The frozen mini-catalog plus these seeds pin the whole sampler: the axis order, the
  // odds, the deny handling and the canonical string format. A diff here means the look of
  // every seed on the live site moved.
  assert.deepEqual(Object.fromEntries(GOLDEN_SEEDS.map((s) => [s, str(s)])), {
    'golden-001': 'f:fx-sans.up p:fx-ground.k10- e:depth-extrude(a=225,d=8) l:stack-fit(g=6,a=flex-start)',
    'golden-004': 'f:fx-sans.as p:fx-ground.w01- e:depth-extrude(a=45,d=3) l:stack-fit(g=8,a=flex-end,side)',
    'golden-005': 'f:fx-sans.lo p:fx-dusk.2103 e:plain l:stack-eq(g=6,a=flex-end)',
    'golden-006': 'f:fx-sans.up p:fx-ink.01-- e:plain l:stack-eq(g=4,a=flex-start,side)',
    k3f9x2m7qa: 'f:fx-sans.as p:fx-ink.10-- e:plain l:stack-fit(g=8,a=flex-end)',
    a: 'f:fx-sans.up p:fx-ground.k10- e:plain l:stack-fit(g=6,a=center)',
  })
})

test('the same seed always gives the same pick', () => {
  for (const s of ['a', 'golden-001', 'k3f9x2m7qa']) {
    assert.deepEqual(pick(s, {}, catalog), pick(s, {}, catalog))
  }
})

test('every pin is honoured exactly', () => {
  const p = pick(
    'golden-001',
    { f: 'fx-sans', v: 'lo', p: 'fx-dusk', r: '0123', e: 'plain', l: 'stack-eq' },
    catalog,
  )
  assert.equal(p.f, 'fx-sans')
  assert.equal(p.v, 'lo')
  assert.equal(p.p, 'fx-dusk')
  assert.equal(p.r, '0123')
  assert.equal(p.e, 'plain')
  assert.equal(p.l, 'stack-eq')
  assert.deepEqual(p.pinned, ['f', 'v', 'p', 'r', 'e', 'l'])
})

test('a pin fixes its axis while the rest still follow the seed', () => {
  const free = new Set()
  const pinnedLayout = new Set()
  for (let i = 0; i < 200; i++) {
    free.add(pick(`s${i}`, {}, catalog).l)
    const p = pick(`s${i}`, { l: 'stack-eq' }, catalog)
    pinnedLayout.add(p.l)
    // Pinning the layout must not move the earlier axes.
    assert.equal(p.f, pick(`s${i}`, {}, catalog).f)
    assert.equal(p.e, pick(`s${i}`, {}, catalog).e)
  }
  assert.equal(free.size, 2, 'both layouts should occur across 200 seeds')
  assert.deepEqual([...pinnedLayout], ['stack-eq'])
})

test('an unknown id is rejected, on every axis', () => {
  for (const [axis, value] of Object.entries({
    f: 'no-such-font',
    v: 'no-such-variant',
    p: 'no-such-palette',
    r: 'zzzz',
    e: 'no-such-effect',
    l: 'no-such-layout',
  })) {
    assert.throws(
      () => pick('a', { [axis]: value }, catalog),
      (err) => err instanceof PickError && err.kind === 'unknown' && err.axis === axis,
      `${axis}=${value} should be an unknown-id error`,
    )
  }
})

test('two pins that nothing satisfies are rejected', () => {
  // `w01-` is a role set of fx-ground only.
  assert.throws(
    () => pick('a', { p: 'fx-ink', r: 'w01-' }, catalog),
    (err) => err instanceof PickError && err.kind === 'incompatible' && err.axis === 'r',
  )
  // Both variant ids exist, but no single font carries both.
  const [as, lo] = catalog.fonts[0].variants
  const split = {
    ...catalog,
    fonts: [
      { ...catalog.fonts[0], id: 'one', variants: [as] },
      { ...catalog.fonts[0], id: 'two', variants: [lo] },
    ],
  }
  assert.throws(
    () => pick('a', { f: 'one', v: 'lo' }, split),
    (err) => err instanceof PickError && err.kind === 'incompatible' && err.axis === 'v',
  )
})

test('a pin resolves a retired (odds 0) item — QA mask mode', () => {
  const live = {
    ...catalog,
    palettes: [
      ...catalog.palettes,
      {
        id: 'qa-bw',
        src: 'qa',
        tier: 'editorial',
        odds: 0,
        names: ['Black', 'White'],
        hex: ['#000000', '#ffffff'],
        roles: [{ o: '10--', dark: false, n: 2, derivedBg: null }],
      },
    ],
  }
  const p = pick('a', { p: 'qa-bw', e: 'plain' }, live)
  assert.equal(p.p, 'qa-bw')
  assert.equal(p.e, 'plain')

  // …and is never drawn without the pin.
  for (let i = 0; i < 2000; i++) assert.notEqual(pick(`s${i}`, {}, live).p, 'qa-bw')
})

test('no drawn pick completes a deny rule', () => {
  assert.equal(catalog.deny.length, 2, 'the fixture must actually carry rules')
  for (let i = 0; i < 4000; i++) {
    const p = pick(`s${i}`, {}, catalog)
    assert.equal(denied(catalog.deny, p), false, `seed s${i} is denied: ${pickString(p)}`)
  }
})

test('a deny rule that would empty an axis is relaxed rather than deadlocking', () => {
  // Every effect denied against this font: the sampler still has to return something.
  const all = catalog.effects.map((e) => ({ f: 'fx-sans', e: e.id }))
  const p = pick('a', {}, { ...catalog, deny: all })
  assert.ok(p.e)
})

test('an effect never lands on a font whose traits it denies', () => {
  const scripty = {
    ...catalog,
    fonts: [{ ...catalog.fonts[0], traits: ['script'] }],
  }
  for (let i = 0; i < 500; i++) assert.equal(pick(`s${i}`, {}, scripty).e, 'plain')
})

test('an effect never lands on a role set with too few colours or the wrong ground', () => {
  for (let i = 0; i < 4000; i++) {
    const p = pick(`s${i}`, {}, catalog)
    const effect = catalog.effects.find((e) => e.id === p.e)
    const role = catalog.palettes.find((x) => x.id === p.p).roles.find((r) => r.o === p.r)
    assert.ok(role.n >= effect.colors, `${pickString(p)}: role set has ${role.n} colours`)
    if (effect.bg !== 'any') assert.equal(role.dark, effect.bg === 'dark')
  }
})

test('weights override the item odds', () => {
  const only = { ...catalog, weights: { l: { 'stack-eq': 0, 'stack-fit': 4 } } }
  for (let i = 0; i < 500; i++) assert.equal(pick(`s${i}`, {}, only).l, 'stack-fit')

  const flipped = { ...catalog, weights: { l: { 'stack-eq': 16, 'stack-fit': 0 } } }
  for (let i = 0; i < 500; i++) assert.equal(pick(`s${i}`, {}, flipped).l, 'stack-eq')
})

test('D4: 90% of visits draw from the six taste archetypes', () => {
  // Against the default odds: the fixture's own weights.json boosts X on purpose, which is
  // what the weights test below relies on.
  const plainOdds = { ...catalog, weights: {} }
  let af = 0
  const n = 20000
  for (let i = 0; i < n; i++) if ('ABCDEF'.includes(pick(`s${i}`, {}, plainOdds).bucket)) af++
  const share = af / n
  const want = 18 / 20
  assert.ok(share >= 0.85, `A–F share ${share}`)
  assert.ok(Math.abs(share - want) < 0.02, `A–F share ${share}, expected ~${want}`)
  assert.equal(
    Object.values(BUCKET_ODDS).reduce((a, b) => a + b),
    20,
  )
})

test('D8: about a quarter of seeds add the rotated portrait variant', () => {
  let side = 0
  const n = 20000
  for (let i = 0; i < n; i++) if (pick(`s${i}`, {}, catalog).side) side++
  assert.ok(Math.abs(side / n - 0.25) < 0.01, `side share ${side / n}`)
})

test('the engine is total with an empty catalog', () => {
  // This is the live repo until WP-11 and WP-12 land: no fonts, one QA palette.
  const bare = { fonts: [], palettes: [], effects: catalog.effects, presets: [], deny: [], weights: {} }
  const p = pick('a', {}, bare)
  assert.equal(p.f, 'system')
  assert.equal(p.p, 'qa-bw')
  assert.ok(LAYOUTS.some((l) => l.id === p.l))
})

test('the canonical string round-trips through the deny matcher', () => {
  const p = pick('golden-001', {}, catalog)
  assert.equal(denied([{ f: p.f, e: p.e }], p), true)
  assert.equal(denied([{ f: p.f, e: 'nope' }], p), false)
  assert.equal(denied([{}], p), false, 'an empty rule must never match everything')
  assert.match(pickString(p), /^f:[\w.-]+ p:[\w.-]+ e:\S+ l:\S+$/)
})
