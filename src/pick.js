/**
 * Ordered conditional sampling: one pass down a fixed axis order, one draw per axis.
 *
 *   mode -> bucket -> font -> file+variant -> effect -> effect params
 *        -> palette -> role set -> layout + side + g
 *
 * Pins are fixed before any draw. Each drawn axis filters against everything already
 * fixed and removes the candidates that would complete a `data/deny.json` rule. Every
 * axis keeps a universal fallback, so the candidate set is never empty and the pass
 * always terminates: there are no retries and no loops.
 *
 * `pick()` is pure. It never touches the network, the clock or `Math.random`.
 */

import { flag, step, weighted } from './rand.js'

/** A pin naming something that does not exist, or a pin combination nothing satisfies. */
export class PickError extends Error {
  /**
   * @param {'unknown' | 'incompatible'} kind
   * @param {string} axis
   */
  constructor(kind, axis) {
    super(`${kind} pin on axis ${axis}`)
    this.name = 'PickError'
    this.kind = kind
    this.axis = axis
  }
}

/** The pin query parameters, in axis order. They are also the `data/deny.json` rule keys. */
export const PIN_KEYS = /** @type {const} */ (['f', 'v', 'p', 'r', 'e', 'l'])

/** Layouts are engine, not data: adding one is a change to `render.js` as well. */
export const LAYOUTS = [
  { id: 'stack-eq', odds: 4 },
  { id: 'stack-fit', odds: 12 },
]

/** Cross-axis alignment of the two lines. Only `stack-eq` can show a difference. */
const ALIGNS = [
  { id: 'center', odds: 8 },
  { id: 'flex-end', odds: 4 },
  { id: 'flex-start', odds: 4 },
]

/**
 * D4: 90% of visits draw from the six taste archetypes, equal share each.
 *
 * A soft 70s display serif · B ultra-heavy wide caps with inline or stencil cuts ·
 * C bold casual brush script · D fat groovy psychedelic caps · E rounded geometric
 * display · F elegant deco and nouveau serif with alternates · X everything else.
 *
 * They are taste buckets from the owner's reference images, not technical classes: a font
 * belongs to one because it looks like the reference, not because it measures a certain way.
 */
export const BUCKET_ODDS = { A: 3, B: 3, C: 3, D: 3, E: 3, F: 3, X: 2 }

/** Gap between the two lines, in u. */
const G_SPEC = /** @type {const} */ ([4, 10, 2])

/** D8: about a quarter of seeds add the rotated portrait variant. */
const SIDE_ODDS = /** @type {const} */ ([1, 4])

const DEFAULT_ODDS = 4

/**
 * Stand-in used only while `fonts/meta/` is still empty (before WP-11 lands). Every real
 * font ships measured ink metrics; a system stack cannot, because the face that actually
 * resolves differs per platform.
 *
 * So these are a deliberate **upper bound**, not an estimate. Measured bold at 1em:
 * Georgia 3.94 / 3.84, Iowan Old Style 3.56 / 3.64, Palatino 3.39 / 3.58, Times New Roman
 * 3.19 / 3.26. The values below sit above all of them, which trades a slightly smaller
 * name for the guarantee that the ink never runs past the edge — under-fill is benign,
 * overflow is not. The pixel scan (§9.2) gates real fonts only, and this row disappears
 * the moment one font meta lands.
 */
export const FALLBACK_FONT = {
  id: 'system',
  family: 'Georgia,"Times New Roman",ui-serif,serif',
  licenseId: null,
  copyright: null,
  odds: 4,
  archetype: ['A', 'X'],
  traits: ['serif'],
  files: [{ id: 'r', asc: 0.78, desc: 0.22, bytes: 0, b64: null }],
  variants: [
    {
      id: 'r',
      file: 'r',
      case: 'none',
      css: { weight: 700, style: 'normal', feat: '' },
      w1: { W: 4.25, H: 0.73, X: 0.01, top: 0.71 },
      w2: { W: 4.15, H: 0.8, X: 0.03, top: 0.78 },
    },
  ],
}

/** Stand-in used only if `data/palettes/` is empty. `data/palettes/qa.json` ships, so it is not. */
export const FALLBACK_PALETTE = {
  id: 'qa-bw',
  src: 'qa',
  tier: 'editorial',
  odds: 0,
  names: ['Black', 'White'],
  hex: ['#000000', '#ffffff'],
  roles: [{ o: '10--', dark: false, n: 2, derivedBg: null }],
}

/** Stand-in used only if `effects/` is empty. `effects/plain.js` ships, so it is not. */
const NULL_EFFECT = {
  id: 'plain',
  family: 'plain',
  shape: 'A',
  colors: 2,
  bg: 'any',
  fonts: { deny: [], prefer: [] },
  palettes: { prefer: [] },
  params: {},
  bleed: () => ({ t: 0, r: 0, b: 0, l: 0 }),
  css: () => '',
  hover: null,
  motion: null,
}

/** @param {number} n */
const odds16 = (n) => {
  const i = Math.floor(n)
  return i < 0 ? 0 : i > 16 ? 16 : i
}

/**
 * Does `rule` hold for a finished pick? A rule matches when every key it names equals the
 * pick's value on that axis.
 *
 * @param {readonly Record<string, string>[]} deny
 * @param {Record<string, string>} p
 */
export function denied(deny, p) {
  return deny.some((rule) => {
    const keys = Object.keys(rule).filter((k) => PIN_KEYS.includes(/** @type {never} */ (k)))
    return keys.length > 0 && keys.every((k) => p[k] === rule[k])
  })
}

/**
 * Would choosing `id` on `axis` complete a deny rule, given everything fixed so far? A
 * rule that also names an axis nobody has drawn yet is not completed — it will be checked
 * again when that axis comes up.
 *
 * @param {readonly Record<string, string>[]} deny
 * @param {string} axis
 * @param {string} id
 * @param {Record<string, string>} fixed
 */
function completes(deny, axis, id, fixed) {
  return deny.some((rule) => {
    if (rule[axis] !== id) return false
    return Object.keys(rule).every((k) => k === axis || fixed[k] === rule[k])
  })
}

/**
 * One axis: pin, then compatibility, then deny, then odds — each step relaxed rather than
 * allowed to empty the set, which is what makes the single pass total.
 *
 * @template {{id: string}} T
 * @param {object} a
 * @param {string} a.seed
 * @param {string} a.axis
 * @param {readonly T[]} a.pool every item the axis could ever produce
 * @param {(item: T) => boolean} [a.compatible]
 * @param {(item: T) => number} a.oddsOf
 * @param {readonly Record<string, string>[]} a.deny
 * @param {Record<string, string>} a.fixed
 * @param {string | null | undefined} a.pinned
 * @param {(items: readonly T[]) => readonly T[]} [a.fallback]
 * @returns {T}
 */
function axis({ seed, axis: name, pool, compatible, oddsOf, deny, fixed, pinned, fallback }) {
  if (pool.length === 0) throw new PickError('incompatible', name)

  if (pinned != null) {
    const hit = pool.find((item) => item.id === pinned)
    // A pin bypasses compatibility filtering on purpose: pins exist for tests, contact
    // sheets and bug reports, and a retired (odds 0) item stays resolvable by pin.
    if (!hit) throw new PickError('incompatible', name)
    return hit
  }

  let cands = compatible ? pool.filter(compatible) : pool
  if (cands.length === 0) cands = fallback ? fallback(pool) : pool
  if (cands.length === 0) cands = pool

  const allowed = cands.filter((item) => !completes(deny, name, item.id, fixed))
  if (allowed.length > 0) cands = allowed

  const live = cands.filter((item) => oddsOf(item) > 0)
  if (live.length > 0) cands = live

  const hit = weighted(seed, name, cands, oddsOf)
  if (!hit) throw new PickError('incompatible', name)
  return hit
}

/**
 * Does this palette prefer-token describe `palette` (with one of `sets` selected)?
 * Tokens: a source or id prefix (`kasane`), a polarity (`dark` / `light`), a colour count
 * (`n2`..`n4`) or a tier (`historical`).
 *
 * @param {string} token
 * @param {{id: string, src?: string, tier?: string}} palette
 * @param {readonly {dark: boolean, n: number}[]} sets
 */
function prefers(token, palette, sets) {
  if (token === 'dark') return sets.some((r) => r.dark)
  if (token === 'light') return sets.some((r) => !r.dark)
  if (/^n[234]$/.test(token)) return sets.some((r) => r.n === Number(token.slice(1)))
  if (palette.tier === token) return true
  return palette.src === token || palette.id.startsWith(`${token}-`)
}

/**
 * Role sets this effect can paint on: enough colours, and the right ground polarity.
 *
 * @param {{colors: number, bg: string}} effect
 * @param {{dark: boolean, n: number}} role
 */
const roleFits = (effect, role) =>
  role.n >= effect.colors && (effect.bg === 'any' || (effect.bg === 'dark') === role.dark)

/**
 * @typedef {object} Pick
 * @property {string} seed
 * @property {'free' | 'preset'} mode
 * @property {string | null} preset
 * @property {string} bucket
 * @property {string} f font id
 * @property {string} v variant id
 * @property {string} p palette id
 * @property {string} r role-set id (its `o` string)
 * @property {string} e effect id
 * @property {string} l layout id
 * @property {Record<string, number>} params effect params, quantized
 * @property {boolean} side
 * @property {number} g line gap in u
 * @property {string} align
 * @property {string[]} pinned axes the request froze
 */

/**
 * @param {string} seed
 * @param {Partial<Record<'f' | 'v' | 'p' | 'r' | 'e' | 'l', string>>} pins
 * @param {object} catalog
 * @returns {Pick}
 */
export function pick(seed, pins, catalog) {
  const weights = catalog.weights ?? {}
  const deny = catalog.deny ?? []
  const fonts = catalog.fonts?.length ? catalog.fonts : [FALLBACK_FONT]
  const palettes = catalog.palettes?.length ? catalog.palettes : [FALLBACK_PALETTE]
  const effects = catalog.effects?.length ? catalog.effects : [NULL_EFFECT]
  const presets = catalog.presets ?? []

  // Unknown ids are rejected before anything is drawn, so a typo never renders a page.
  const universe = {
    f: new Set(fonts.map((x) => x.id)),
    v: new Set(fonts.flatMap((x) => x.variants.map((y) => y.id))),
    p: new Set(palettes.map((x) => x.id)),
    r: new Set(palettes.flatMap((x) => x.roles.map((y) => y.o))),
    e: new Set(effects.map((x) => x.id)),
    l: new Set(LAYOUTS.map((x) => x.id)),
  }
  const pinned = []
  for (const k of PIN_KEYS) {
    const v = pins?.[k]
    if (v == null) continue
    if (!universe[k].has(v)) throw new PickError('unknown', k)
    pinned.push(k)
  }

  /** @type {Record<string, string>} */
  const fixed = {}
  for (const k of pinned) fixed[k] = pins[k]

  // --- mode -----------------------------------------------------------------
  /** @type {'free' | 'preset'} */
  let mode = 'free'
  let preset = null
  if (presets.length > 0) {
    const share = weights.mode ?? { free: 8, preset: 2 }
    const modes = [
      { id: 'free', odds: odds16(share.free ?? 8) },
      { id: 'preset', odds: odds16(share.preset ?? 2) },
    ]
    mode = /** @type {'free' | 'preset'} */ (weighted(seed, 'mode', modes, (m) => m.odds).id)
    if (mode === 'preset') {
      preset = weighted(seed, 'preset', presets, (x) =>
        odds16(weights.preset?.[x.id] ?? x.odds ?? DEFAULT_ODDS),
      )
    }
  }
  const pre = preset ?? {}
  // A preset's pins are data, not a request: an id that has been retired out of the catalog
  // must not turn a random visit into a 400. Unknown ones are dropped and the axis draws
  // normally. A request's own pins are never dropped — they were validated above.
  /** @type {Record<string, string>} */
  const soft = { ...pins }
  for (const [k, v] of Object.entries(pre.pins ?? {})) {
    if (soft[k] == null && universe[k]?.has(v)) soft[k] = v
  }

  // --- bucket ---------------------------------------------------------------
  const buckets = Object.keys(BUCKET_ODDS).map((id) => ({
    id,
    odds: odds16(weights.bucket?.[id] ?? BUCKET_ODDS[id]),
  }))
  const bucket = weighted(seed, 'b', buckets, (b) => b.odds).id

  // --- font -----------------------------------------------------------------
  const presetFonts = pre.fonts ?? {}
  const font = axis({
    seed,
    axis: 'f',
    pool: fonts,
    compatible: (x) => {
      if (presetFonts.ids && !presetFonts.ids.includes(x.id)) return false
      if (presetFonts.traits && !presetFonts.traits.every((t) => x.traits.includes(t))) return false
      if (soft.v && !x.variants.some((y) => y.id === soft.v)) return false
      return (x.archetype ?? []).includes(bucket)
    },
    // Universal fallback: an empty bucket falls back to the flat pool.
    fallback: (pool) => pool.filter((x) => !soft.v || x.variants.some((y) => y.id === soft.v)),
    oddsOf: (x) => odds16(weights.f?.[x.id] ?? x.odds ?? DEFAULT_ODDS),
    deny,
    fixed,
    pinned: soft.f,
  })
  fixed.f = font.id

  // --- file + variant -------------------------------------------------------
  const variant = axis({
    seed,
    axis: 'v',
    pool: font.variants,
    oddsOf: (x) => odds16(weights.v?.[`${font.id}.${x.id}`] ?? x.odds ?? DEFAULT_ODDS),
    deny,
    fixed,
    pinned: soft.v,
  })
  fixed.v = variant.id

  // --- effect ---------------------------------------------------------------
  // The effect's colour and polarity needs point *forward*, at the palette axis. They are
  // checked here rather than left to the palette's fallback: an effect that paints with
  // `--a1` on a 2-colour role set would paint its accent in the face colour and vanish.
  const groundPool = palettes
    .filter((x) => !soft.p || x.id === soft.p)
    .flatMap((x) => x.roles.filter((r) => !soft.r || r.o === soft.r))

  const traits = new Set(font.traits ?? [])
  const effect = axis({
    seed,
    axis: 'e',
    pool: effects,
    compatible: (x) =>
      !(x.fonts?.deny ?? []).some((t) => traits.has(t)) && groundPool.some((r) => roleFits(x, r)),
    // Universal fallback: `plain` fits every font, every palette and every layout.
    fallback: (pool) => pool.filter((x) => x.id === 'plain'),
    oddsOf: (x) => {
      const base = odds16(weights.e?.[x.id] ?? x.odds ?? DEFAULT_ODDS)
      return (x.fonts?.prefer ?? []).some((t) => traits.has(t)) ? base * 2 : base
    },
    deny,
    fixed,
    pinned: soft.e,
  })
  fixed.e = effect.id

  // --- effect params --------------------------------------------------------
  /** @type {Record<string, number>} */
  const params = {}
  for (const name of Object.keys(effect.params ?? {}).sort()) {
    const forced = pre.params?.[effect.id]?.[name]
    params[name] = forced ?? step(seed, `e/${effect.id}/${name}`, effect.params[name])
  }

  // --- palette --------------------------------------------------------------
  const preferTokens = [...(effect.palettes?.prefer ?? []), ...(pre.palettes?.prefer ?? [])]
  const setsOf = (x) => x.roles.filter((r) => roleFits(effect, r))
  const palette = axis({
    seed,
    axis: 'p',
    pool: palettes,
    compatible: (x) => setsOf(x).length > 0 && (!soft.r || x.roles.some((r) => r.o === soft.r)),
    oddsOf: (x) => {
      const base = odds16(weights.p?.[x.id] ?? x.odds ?? DEFAULT_ODDS)
      return preferTokens.some((t) => prefers(t, x, setsOf(x))) ? base * 2 : base
    },
    deny,
    fixed,
    pinned: soft.p,
  })
  fixed.p = palette.id

  // --- role set -------------------------------------------------------------
  const roles = palette.roles.map((r) => ({ ...r, id: r.o }))
  const role = axis({
    seed,
    axis: 'r',
    pool: roles,
    compatible: (r) => roleFits(effect, r),
    oddsOf: (r) => odds16(weights.r?.[`${palette.id}.${r.o}`] ?? r.odds ?? DEFAULT_ODDS),
    deny,
    fixed,
    pinned: soft.r,
  })
  fixed.r = role.o

  // --- layout + side + g ----------------------------------------------------
  const layout = axis({
    seed,
    axis: 'l',
    pool: LAYOUTS,
    oddsOf: (x) => odds16(weights.l?.[x.id] ?? x.odds),
    deny,
    fixed,
    pinned: soft.l,
  })
  fixed.l = layout.id

  const side = flag(seed, 'l/side', SIDE_ODDS[0], SIDE_ODDS[1])
  const g = step(seed, 'l/g', G_SPEC)
  const align = weighted(seed, 'l/a', ALIGNS, (x) => x.odds).id

  return {
    seed,
    mode,
    preset: preset?.id ?? null,
    bucket,
    f: font.id,
    v: variant.id,
    p: palette.id,
    r: role.o,
    e: effect.id,
    l: layout.id,
    params,
    side,
    g,
    align,
    pinned,
  }
}

/**
 * The canonical Pick string: the `Luzid-Pick` header, the colophon comment and the unit
 * that a deny rule or a bug report is written against.
 *
 *   f:<id>.<variant> p:<id>.<roles> e:<id>(k=v,…) l:<id>(g=…,a=…[,side])
 *
 * @param {Pick} p
 * @returns {string}
 */
export function pickString(p) {
  const kv = Object.keys(p.params)
    .sort()
    .map((k) => `${k}=${p.params[k]}`)
    .join(',')
  const lp = [`g=${p.g}`, `a=${p.align}`, ...(p.side ? ['side'] : [])].join(',')
  return `f:${p.f}.${p.v} p:${p.p}.${p.r} e:${p.e}${kv ? `(${kv})` : ''} l:${p.l}(${lp})`
}

/**
 * Resolve a Pick's ids back to the catalog rows the renderer needs.
 *
 * @param {Pick} p
 * @param {object} catalog
 */
export function resolve(p, catalog) {
  const fonts = catalog.fonts?.length ? catalog.fonts : [FALLBACK_FONT]
  const palettes = catalog.palettes?.length ? catalog.palettes : [FALLBACK_PALETTE]
  const effects = catalog.effects?.length ? catalog.effects : [NULL_EFFECT]

  const font = fonts.find((x) => x.id === p.f)
  const variant = font?.variants.find((x) => x.id === p.v)
  const file = font?.files.find((x) => x.id === variant?.file) ?? font?.files[0]
  const palette = palettes.find((x) => x.id === p.p)
  const role = palette?.roles.find((x) => x.o === p.r)
  const effect = effects.find((x) => x.id === p.e)
  if (!font || !variant || !file || !palette || !role || !effect) {
    throw new PickError('incompatible', 'resolve')
  }
  return { font, variant, file, palette, role, effect }
}
