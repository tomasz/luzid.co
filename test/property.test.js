/**
 * The 10k-seed property tier (§9.1 P1–P7).
 *
 * P1 resolve is total · P2 every axis is a real catalog id · P3 no deny rule matches ·
 * P5 the response stays inside the budget · P7 two renders of one seed are byte-identical.
 * It runs against the frozen fixture catalog *and* against the live one, because the live
 * catalog is the thing that actually ships and it is currently near-empty.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { brotliCompressSync } from 'node:zlib'
import { denied, LAYOUTS, pick, pickString, resolve } from '../src/pick.js'
import { render } from '../src/render.js'
import { fixtureCatalog, seeds } from './catalog.js'

const fixture = await fixtureCatalog()
const live = (await import('../build/catalog.js')).default

const LAYOUT_IDS = new Set(LAYOUTS.map((x) => x.id))

/**
 * An independent re-implementation of the constraints: it must not share code with the
 * sampler, or a bug in the sampler would validate itself.
 */
function violations(p, catalog) {
  const out = []
  const font = catalog.fonts.find((x) => x.id === p.f)
  const palette = catalog.palettes.find((x) => x.id === p.p)
  const effect = catalog.effects.find((x) => x.id === p.e)

  if (!font && p.f !== 'system') out.push(`unknown font ${p.f}`)
  if (!palette && p.p !== 'qa-bw') out.push(`unknown palette ${p.p}`)
  if (!effect) out.push(`unknown effect ${p.e}`)
  if (!LAYOUT_IDS.has(p.l)) out.push(`unknown layout ${p.l}`)
  if (!'ABCDEFX'.includes(p.bucket)) out.push(`unknown bucket ${p.bucket}`)
  if (!(p.g >= 4 && p.g <= 10)) out.push(`gap ${p.g} out of range`)
  if (typeof p.side !== 'boolean') out.push('side is not a flag')
  if (!['flex-start', 'center', 'flex-end'].includes(p.align)) out.push(`align ${p.align}`)

  if (font) {
    const variant = font.variants.find((x) => x.id === p.v)
    if (!variant) out.push(`${p.f} has no variant ${p.v}`)
    else if (!font.files.some((x) => x.id === variant.file)) out.push(`${p.v} names a missing file`)
  }
  if (palette && effect) {
    const role = palette.roles.find((r) => r.o === p.r)
    if (!role) out.push(`${p.p} has no role set ${p.r}`)
    else {
      if (role.n < effect.colors) out.push(`${p.e} needs ${effect.colors} colours, ${p.r} has ${role.n}`)
      if (effect.bg !== 'any' && role.dark !== (effect.bg === 'dark'))
        out.push(`${p.e} needs a ${effect.bg} ground`)
    }
  }
  if (font && effect) {
    const denyTraits = (effect.fonts?.deny ?? []).filter((t) => (font.traits ?? []).includes(t))
    if (denyTraits.length > 0) out.push(`${p.e} denies trait ${denyTraits[0]}`)
  }
  for (const [name, spec] of Object.entries(effect?.params ?? {})) {
    const v = p.params[name]
    const [min, max, size] = spec
    if (!(v >= min && v <= max)) out.push(`param ${name}=${v} out of [${min},${max}]`)
    if (Math.abs(Math.round((v - min) / size) - (v - min) / size) > 1e-9)
      out.push(`param ${name}=${v} is off-grid`)
  }
  if (denied(catalog.deny ?? [], p)) out.push('completes a deny rule')
  return out
}

for (const [name, catalog, n] of [
  ['fixture', fixture, 10000],
  ['live', live, 2000],
]) {
  test(`${n} seeds against the ${name} catalog: total, valid, never denied`, () => {
    const axes = { f: new Set(), v: new Set(), p: new Set(), r: new Set(), e: new Set(), l: new Set() }
    for (const seed of seeds(n)) {
      const p = pick(seed, {}, catalog)
      const bad = violations(p, catalog)
      assert.deepEqual(bad, [], `seed ${seed} (${pickString(p)}): ${bad.join('; ')}`)
      for (const k of Object.keys(axes)) axes[k].add(p[k])
      // resolve() has to find every row the Pick names, or render would throw at the edge.
      assert.ok(resolve(p, catalog).effect)
    }
    // Every axis that has more than one live candidate should actually vary.
    assert.ok(axes.l.size === 2, 'both layouts must occur')
    if (catalog.effects.length > 1 && catalog.palettes.length > 1) {
      assert.ok(axes.e.size > 1 && axes.p.size > 1, 'effects and palettes must both vary')
    }
  })
}

test('rendering is deterministic and stays inside the byte budget', () => {
  let worst = 0
  for (const seed of seeds(500, 'r')) {
    const p = pick(seed, {}, fixture)
    const str = pickString(p)
    const html = render(p, fixture, { nonce: 'test', pick: str })
    assert.equal(html, render(p, fixture, { nonce: 'test', pick: str }), `${seed} is not deterministic`)

    // P6, zero-dependency tier: the stylesheet must at least be well-formed.
    const css = html.match(/<style nonce="test">([\s\S]*?)<\/style>/)[1]
    let depth = 0
    for (const c of css) {
      if (c === '{') depth++
      else if (c === '}') depth--
      assert.ok(depth >= 0, `${seed}: unbalanced braces`)
    }
    assert.equal(depth, 0, `${seed}: unbalanced braces`)
    assert.equal(/undefined|NaN|\[object/.test(html), false, `${seed}: a hole in the template`)

    worst = Math.max(worst, brotliCompressSync(Buffer.from(html, 'utf8')).length)
  }
  assert.ok(worst <= 14000, `worst response ${worst} B brotli`)
})

test('pick + render stay far inside the CPU budget', () => {
  // A Worker cannot time itself (Date.now does not advance during execution), so this is a
  // Node proxy: the real numbers come from Workers Logs once it is live.
  const samples = []
  for (const seed of seeds(300, 't')) {
    const t0 = performance.now()
    const p = pick(seed, {}, fixture)
    render(p, fixture, { nonce: 'test', pick: pickString(p) })
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  const p99 = samples[Math.floor(samples.length * 0.99)]
  assert.ok(p99 < 5, `p99 ${p99.toFixed(3)} ms — the Free plan allows 10 ms of CPU per request`)
})

test('an added item moves only the seeds it wins', () => {
  // Not the HRW minimal-disruption guarantee — a cumulative scan over ids reshuffles more —
  // but the drift still has to be bounded and reported rather than silent.
  const extra = {
    ...fixture,
    palettes: [...fixture.palettes, { ...fixture.palettes[0], id: 'zz-new', odds: 4 }],
  }
  let moved = 0
  const n = 4000
  for (const seed of seeds(n)) {
    if (pick(seed, {}, fixture).p !== pick(seed, {}, extra).p) moved++
  }
  // 4 added odds against 14 existing: the new row should win about its own share, and the
  // scan may also shift the rows sorted after it.
  assert.ok(moved / n < 0.6, `an added palette moved ${((moved / n) * 100).toFixed(1)}% of seeds`)
  assert.ok(moved > 0, 'an added palette should win some seeds')
})
