/**
 * The cheap half of the bleed check (§5.6): does an effect's declared `bleed()` actually
 * bound the ink its own CSS paints?
 *
 * `e2e/bleed.spec.js` answers this properly, in pixels, in three engines. This runs in
 * milliseconds without a browser, so an effect author finds out at authoring time rather
 * than after a CI round trip. At the ~200 effects the catalogue is heading for, that
 * matters. It is a complement to the pixel test, never a replacement.
 *
 * Two rules, both learned from a first version of this audit that got it wrong:
 *
 *  - **Blur reaches 1.0x its radius, not 1.5x** (R14). The 1.5x figure came from the
 *    "Gaussian is visible to 3 sigma" folklore; measured against real pixels the answer is
 *    0.89-1.05. Using 1.5x here produced three false alarms and would have cost real size.
 *
 *  - **Anything unparsed is a FAILURE, not a pass.** A shadow-list scan cannot see shape-B
 *    geometry, `transform`, `clip-path` or `mask`, and scoring those zero reads as clean.
 *    The first version of this audit silently gave a pass to two effects that do overshoot
 *    and to one that it could not have judged at all.
 */
import assert from 'node:assert/strict'
import { glob } from 'node:fs/promises'
import { basename } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { helpers as h } from '../src/helpers.js'

/** R14: a blurred layer paints to about one radius beyond its offset. 1.1 is the safety factor. */
const BLUR_REACH = 1.1

/**
 * How far past its declaration an effect may score before this test complains, in u.
 *
 * This scan is an approximation and always reads high: it sums the worst corner of every
 * layer analytically, while ink is only ink where it is actually visible. Measured in
 * pixels by `e2e/bleed.spec.js`, `retro-deboss` overshoots by 0.32u where this scan says
 * 1.20u, and `glow-neon` is clean where this scan says 0.25u.
 *
 * So the threshold is set to catch the gross errors this is good at — an effect that
 * declares nothing, or is out by a multiple — and to leave the fine margin to the pixel
 * test, which is authoritative. Tightening it below the scan's own error would just
 * force effects to reserve space they never paint into, which costs real size.
 */
const TOLERANCE = 0.5

/** Plausible metrics; the audit is about an effect's own geometry, not a particular font. */
const M = {
  fs: [25, 25],
  H: [18, 18],
  top: [14, 14],
  asc: 0.75,
  desc: 0.25,
  G: 8,
  R: 0.5,
  layout: 'stack-fit',
}

/** Properties whose ink a shadow-list scan cannot bound. Seeing one means we must abstain. */
const OPAQUE = /^(transform|translate|scale|rotate|clip-path|mask|mask-image|filter|content)$/

/** Split `s` on `sep` at paren depth 0. */
function topSplit(s, sep) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === sep && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

/** A length in `u`, or null if it is not one the scan understands. */
function u(s) {
  const t = s.trim()
  if (t === '0') return 0
  let m = t.match(/^calc\(\s*(-?[\d.]+)\s*\*\s*var\(--u\)\s*\)$/)
  if (m) return Number(m[1])
  m = t.match(/^calc\(\s*(-?[\d.]+)\s*\*\s*(cos|sin)\(\s*(-?[\d.]+)deg\s*\)\s*\*\s*var\(--u\)\s*\)$/)
  if (m) {
    const rad = (Number(m[3]) * Math.PI) / 180
    return Number(m[1]) * (m[2] === 'cos' ? Math.cos(rad) : Math.sin(rad))
  }
  return null
}

/** Every combination of each parameter's two extremes. */
function corners(params) {
  let out = [{}]
  for (const [k, v] of Object.entries(params ?? {})) {
    out = out.flatMap((o) => [
      { ...o, [k]: v[0] },
      { ...o, [k]: v[1] },
    ])
  }
  return out.slice(0, 64)
}

/**
 * The painted extent of one CSS string, in u per side.
 * @returns {{ext: {l:number,r:number,t:number,b:number}, opaque: string[]}}
 */
function extent(css) {
  const ext = { l: 0, r: 0, t: 0, b: 0 }
  const opaque = []
  let stroke = 0

  for (const rule of css.split('}')) {
    const body = rule.includes('{') ? rule.slice(rule.indexOf('{') + 1) : ''
    for (const decl of topSplit(body, ';')) {
      const i = decl.indexOf(':')
      if (i < 0) continue
      const prop = decl.slice(0, i).trim()
      const value = decl.slice(i + 1).trim()

      // Half a stroke lies outside the contour, and it adds to every shadow's reach.
      if (/^-webkit-text-stroke(-width)?$/.test(prop)) {
        const w = u(topSplit(value, ' ')[0])
        if (w === null) opaque.push(prop)
        else stroke = Math.max(stroke, w / 2)
        continue
      }
      // drop-shadow is the one filter whose geometry the scan understands; any other
      // filter function changes ink in ways a shadow list cannot describe.
      const onlyDropShadows =
        prop === 'filter' &&
        topSplit(value, ' ').every((f) => !f.trim() || f.trim().startsWith('drop-shadow('))
      if (OPAQUE.test(prop) && !onlyDropShadows) {
        opaque.push(prop)
        continue
      }

      const isShadow = prop === 'text-shadow'
      if (!isShadow && prop !== 'filter') continue
      const layers = isShadow
        ? topSplit(value, ',')
        : topSplit(value, ' ')
            .filter((f) => f.trim().startsWith('drop-shadow('))
            .map((f) => f.trim().slice('drop-shadow('.length, -1))

      for (const layer of layers) {
        const nums = []
        for (const part of topSplit(layer, ' ')) {
          if (!part.trim()) continue
          const v = u(part)
          if (v === null) break
          nums.push(v)
        }
        if (nums.length < 2) {
          opaque.push(`${prop} layer`)
          continue
        }
        const [x, y] = nums
        const reach = BLUR_REACH * (nums[2] ?? 0)
        ext.l = Math.max(ext.l, -(x - reach))
        ext.r = Math.max(ext.r, x + reach)
        ext.t = Math.max(ext.t, -(y - reach))
        ext.b = Math.max(ext.b, y + reach)
      }
    }
  }
  for (const k of /** @type {const} */ (['l', 'r', 't', 'b'])) ext[k] = Math.max(ext[k], 0) + stroke
  return { ext, opaque }
}

const effects = []
for await (const f of glob('effects/*.js')) {
  const mod = await import(pathToFileURL(new URL(`../${f}`, import.meta.url).pathname).href)
  effects.push([basename(f, '.js'), mod.default])
}
effects.sort(([a], [b]) => a.localeCompare(b))

test('every effect either bounds its own ink or says it cannot be scanned statically', () => {
  // Effects the scan provably cannot judge. Each one is covered by e2e/bleed.spec.js in
  // pixels instead; listing it here is an explicit abstention, not a silent pass.
  const abstain = new Set(effects.filter(([, e]) => e.shape === 'B').map(([id]) => id))

  const problems = []
  for (const [id, e] of effects) {
    for (const p of corners(e.params)) {
      const css = [e.css(p, h, M), e.hover?.(p, h, M) ?? ''].join(' ')
      const { ext, opaque } = extent(css)
      const declared = e.bleed?.(p, M) ?? { t: 0, r: 0, b: 0, l: 0 }

      if (opaque.length) {
        if (!abstain.has(id)) {
          problems.push(
            `${id}: emits ${[...new Set(opaque)].join(', ')}, which this scan cannot bound — ` +
              `declare shape 'B' or extend the scan; scoring it clean would be a lie`,
          )
        }
        break
      }
      for (const side of /** @type {const} */ (['l', 'r', 't', 'b'])) {
        const over = ext[side] - (Number(declared[side]) || 0)
        if (over > TOLERANCE) {
          problems.push(
            `${id} at ${JSON.stringify(p)}: paints ${ext[side].toFixed(2)}u ${side} ` +
              `but declares ${(Number(declared[side]) || 0).toFixed(2)}u (over by ${over.toFixed(2)}u)`,
          )
        }
      }
    }
  }
  assert.deepEqual(problems, [])
})

test('the scan refuses to score what it cannot parse', () => {
  // The guard that matters: a silent zero from an unparsed construct must never read as a pass.
  assert.ok(extent('.n{transform:translateX(5px)}').opaque.length, 'transform must be opaque')
  assert.ok(extent('.n{clip-path:inset(1px)}').opaque.length, 'clip-path must be opaque')
  assert.ok(extent('.n{text-shadow:1cm 1cm 0 red}').opaque.length, 'an unknown length must be opaque')
  assert.equal(extent('.n{text-shadow:0 0 calc(2*var(--u)) var(--a1)}').opaque.length, 0)
})

test('the scan measures reach the way R14 says', () => {
  const { ext } = extent('.n{text-shadow:calc(3*var(--u)) 0 calc(2*var(--u)) var(--a1)}')
  assert.equal(ext.r.toFixed(2), (3 + BLUR_REACH * 2).toFixed(2))
  // The blur reaches 2.2u back but the offset carries it 3u right, so nothing lands left
  // of the glyph: a side that is never painted contributes no bleed, and clamps at 0.
  assert.equal(ext.l, 0)
  // Half a stroke lies outside the contour and adds to every layer.
  const withStroke = extent('.n{-webkit-text-stroke:calc(4*var(--u)) var(--fg);text-shadow:0 0 0 var(--a1)}')
  assert.equal(withStroke.ext.l, 2)
})
