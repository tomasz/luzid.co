#!/usr/bin/env node
/**
 * The font pipeline: source rows in → committed WOFF2 subsets, metadata and licences out.
 * Every rule of PLAN §5.5 is enforced here and every one of them is a hard failure.
 *
 *   node scripts/fonts.mjs                    every batch in fonts/sources
 *   node scripts/fonts.mjs --batch seed       one batch
 *   node scripts/fonts.mjs --id pacifico      one font
 *   node scripts/fonts.mjs --check            rebuild into memory and diff, write nothing
 *
 * Nothing is ever written outside `fonts/`. Upstream originals are cached in the OS temp
 * directory, keyed by their sha256, so a re-run is offline and cannot be poisoned.
 *
 * The three deliberate choices worth knowing before changing anything here:
 *
 *  - The Google `css2` API is never a source. It silently strips `ssNN`, `salt`, `swsh` and
 *    `dlig` from what it serves (google/fonts#1335), which is exactly the material this site
 *    randomises over. Sources are raw files at an immutable commit, or a direct file URL plus
 *    a copy committed under `fonts/upstream/` when the upstream has no VCS at all.
 *  - A feature is "effective" only if shaping the two real words with it on differs from
 *    shaping them with it off. GSUB coverage tables over-report badly — they list every glyph
 *    a lookup *could* touch, including alternates of letters we do not ship.
 *  - Every shipped file is a fully pinned static instance. A variable font that keeps its
 *    `gvar` costs several times the budget, and pinning also lets the renderer avoid
 *    `font-variation-settings` entirely.
 */
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import * as hb from 'harfbuzzjs'
import subsetFont from 'subset-font'
import {
  build,
  deriveMetrics,
  hasOverlapFlags,
  normalizeMetrics,
  parse,
  readMetrics,
  readNames,
  setOverlapFlags,
  unitsPerEm,
  writeNames,
} from './sfnt.mjs'
import { decode, encode } from './woff2.mjs'

// ---------------------------------------------------------------- contract constants

/** The 23 code points every shipped file carries: 22 letters plus the space. */
export const TEXT = 'TOMASZCUDIŁ tomaszcudił'
export const LETTERS = [...TEXT].filter((c) => c !== ' ')

/** The two real words, per `text-transform`. Nothing else is ever shaped or measured. */
export const WORDS = {
  none: ['Tomasz', 'Cudziło'],
  uppercase: ['TOMASZ', 'CUDZIŁO'],
  lowercase: ['tomasz', 'cudziło'],
}

/** Always kept: without these the two words stop shaping correctly (PLAN §5.5 rule 5). */
export const BASE_FEATURES = [
  'kern',
  'liga',
  'clig',
  'calt',
  'rlig',
  'rclt',
  'curs',
  'ccmp',
  'locl',
  'mark',
  'mkmk',
  'rvrn',
]

/** Case-like: kept only when every letter including Ł/ł changes (PLAN §5.5 rule 4). */
const CASE_FEATURES = ['smcp', 'c2sc', 'unic', 'titl']

/**
 * Never candidates. `aalt` is an index of all alternates rather than a look, and the
 * numeric and positional features only bloat the glyph closure with junk forms of our
 * letters (superiors, inferiors, fractions) that the two words can never select.
 */
const FEATURE_DENY = new Set([
  'aalt',
  'sups',
  'subs',
  'sinf',
  'ordn',
  'numr',
  'dnom',
  'frac',
  'lnum',
  'onum',
  'pnum',
  'tnum',
  'vert',
  'vrt2',
  'vkrn',
  'valt',
  'vhal',
  'halt',
  'size',
  'cpsp',
])

export const LICENSE_IDS = new Set(['OFL-1.1', 'Apache-2.0', 'GUST'])

/** PLAN §5.5: closed enum, lint-enforced. Adding one is a `contract` PR. */
export const TRAITS = new Set([
  'serif',
  'sans',
  'slab',
  'script',
  'brush',
  'blackletter',
  'deco',
  'rounded',
  'unicase',
  'mono',
  'fat',
  'hairline',
  'condensed',
  'wide',
  'inline',
  'shaded',
  'stencil',
  'soft',
  'groovy',
  'connected',
  'capsOnly',
  'overlap',
  'jp',
])

/**
 * Traits the pipeline measures from the outlines. A source row may still declare one — a
 * reader of a batch file should be able to see that a face is caps-only without building
 * it — but the two have to agree; see `reconcileTraits`.
 */
export const MEASURED_TRAITS = ['capsOnly', 'unicase', 'connected', 'hairline', 'overlap']

/** The two labels for one measurement: the lowercase letters are the capitals. */
export const CASE_TRAITS = ['capsOnly', 'unicase']

export const ARCHETYPES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'X'])

export const BUDGET_BYTES = 10_500
export const MAX_VARIANTS = 12
export const MAX_STOPS = 4

/** PLAN §5.5 rule 8. Satisfies Apache §4(b) and LPPL §6; the licence file starts with it. */
export const changeNotice = (family, version, url) =>
  `Modified by luzid.co: 23-glyph subset of ${family} ${version}; hinting removed; ` +
  `vertical metrics changed. Original: ${url}`

/** PLAN §5.5 rule 7. The response budget (§9.1) is the final gate; this is the per-file one. */
export function checkBudget(id, bytes) {
  if (bytes > BUDGET_BYTES) throw new Error(`${id}: ${bytes} B is over the ${BUDGET_BYTES} B budget`)
  return bytes
}

// ---------------------------------------------------------------- small helpers

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const fail = (id, message) => {
  throw new Error(`${id}: ${message}`)
}

/**
 * HarfBuzz reports glyph extents with the y axis pointing up and `height` measured from the
 * top downwards, so `height` is negative for every horizontal glyph that has ink. PLAN §5.5
 * rule 2 asks for "width > 0 and height > 0"; the magnitude is what it means.
 */
function inkBox(font, glyphs) {
  let pen = 0
  let left = Infinity
  let right = -Infinity
  let top = -Infinity
  let bottom = Infinity
  let ink = false
  for (const g of glyphs) {
    const e = font.glyphExtents(g.codepoint)
    if (e && e.width !== 0 && e.height !== 0) {
      const x = pen + (g.xOffset ?? 0) + e.xBearing
      const y = (g.yOffset ?? 0) + e.yBearing
      left = Math.min(left, x)
      right = Math.max(right, x + e.width)
      top = Math.max(top, y, y + e.height)
      bottom = Math.min(bottom, y, y + e.height)
      ink = true
    }
    pen += g.xAdvance ?? 0
  }
  if (!ink) return null
  return { left, right, top, bottom, advance: pen }
}

/** Open a font buffer. Callers must `close()` or the wasm heap grows for the whole run. */
function open(buffer) {
  const blob = new hb.Blob(buffer)
  const face = new hb.Face(blob)
  const font = new hb.Font(face)
  return {
    face,
    font,
    upem: face.upem,
    close() {
      font.destroy?.()
      face.destroy?.()
      blob.destroy?.()
    },
  }
}

/** Shape one string, always as Polish Latin, with `tags` forced on and nothing else added. */
function shape(font, text, tags = []) {
  const buffer = new hb.Buffer()
  buffer.addText(text)
  buffer.guessSegmentProperties()
  buffer.setDirection(hb.Direction.LTR) // the enum, not the string: a bad value shapes to nothing
  buffer.setScript('Latn')
  buffer.setLanguage('pl')
  const features = tags.map((t) => hb.Feature.fromString(`${t}=1`)).filter(Boolean)
  hb.shape(font, buffer, features)
  const glyphs = buffer.getGlyphInfosAndPositions()
  buffer.destroy?.()
  return glyphs
}

const outlineCache = new WeakMap()

/** A glyph's outline, cached per font: the same gid is asked for many times per run. */
function outlineOf(font, gid) {
  let cache = outlineCache.get(font)
  if (!cache) {
    cache = new Map()
    outlineCache.set(font, cache)
  }
  if (!cache.has(gid)) cache.set(gid, font.glyphToPath(gid))
  return cache.get(gid)
}

/**
 * What a word actually draws: outlines and positions, deliberately not glyph ids.
 *
 * A feature that swaps one glyph for another that is drawn identically has changed the
 * glyph stream and changed nothing a reader can see. Boldonse's `ss01` in lowercase and
 * Instrument Serif Italic's do exactly that, and both shipped a variant indistinguishable
 * from plain text because the comparison was on ids.
 */
const rendered = (font, word, feats = []) =>
  shape(font, word, feats)
    .map((g) => `${outlineOf(font, g.codepoint)}@${g.xAdvance ?? 0},${g.xOffset ?? 0},${g.yOffset ?? 0}`)
    .join(' ')

// ---------------------------------------------------------------- gates

/** PLAN §5.5 rule 2. The `latin-ext` subset label is ignored: it is wrong in both directions. */
export function checkCoverage(id, { face, font }) {
  for (const ch of LETTERS) {
    const gid = font.nominalGlyph(ch.codePointAt(0))
    if (gid === undefined) fail(id, `no glyph for "${ch}"`)
    const e = font.glyphExtents(gid)
    if (!e || e.width <= 0 || Math.abs(e.height) <= 0) fail(id, `"${ch}" maps to a glyph with no ink`)
  }
  const space = font.nominalGlyph(0x20)
  if (space === undefined) fail(id, 'no space glyph')
  if (font.glyphHAdvance(space) <= 0) fail(id, 'the space glyph has no advance')
  const gid = (ch) => font.nominalGlyph(ch.codePointAt(0))
  if (gid('Ł') === gid('L')) fail(id, 'Ł is the same glyph as L')
  if (gid('ł') === gid('l')) fail(id, 'ł is the same glyph as l')
  const covered = face.collectUnicodes().length
  return covered
}

// ---------------------------------------------------------------- rule 3: reserved names

/**
 * The OFL's own definition of "Reserved Font Name" appears in the body of every OFL 1.1
 * text, so a whole-file search matches every OFL font there is. Only the copyright block
 * above the licence proper is read — everything before the first rule of dashes — plus
 * name ID 0 of the binary, which is where a declaration the licence file forgot shows up
 * (Oleo Script's table reserves "Oleo", Molle's reserves "Spinnaker").
 */
export const licenseHeader = (licenseText) => String(licenseText ?? '').split(/\n-{5,}/)[0]

/** Straight, typographic and guillemet quotes: OFL headers in the wild use all of them. */
const QUOTES = '"“”‘’«»„\''

/**
 * The names one `with Reserved Font Name …` clause reserves.
 *
 * Quoted is the common form and the only unambiguous one, so a clause with any quoted run
 * is read as quoted runs alone. Unquoted (Galada: `with Reserved Font Name Lobster.`) is
 * read as words up to the first sentence-ending punctuation, split on `and` and commas.
 */
function reservedNamesInClause(clause) {
  const quoted = [...clause.matchAll(new RegExp(`[${QUOTES}]([^${QUOTES}\n]+)[${QUOTES}]`, 'g'))]
  if (quoted.length > 0) return quoted.map((m) => m[1].trim()).filter(Boolean)
  const bare = clause.match(/^\s*([A-Za-z0-9][A-Za-z0-9+-]*(?:\s+[A-Za-z0-9][A-Za-z0-9+-]*)*)/)
  if (!bare) return []
  return bare[1]
    .split(/\s+and\s+|\s*,\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
}

const RFN_CLAUSE = /Reserved\s+Font\s+Names?(?:\(s\))?\s*[:,-]?\s*([^\n]*)/gi

/**
 * The two sentences of the OFL body that contain the phrase without declaring anything:
 * `"Reserved Font Name" refers to any names specified as such…` and `…may not use the
 * Reserved Font Name(s) unless explicit written permission is granted`.
 *
 * The header split normally keeps both out of reach. This is the second line of defence,
 * for a licence file that has no rule of dashes to split on at all — reading the OFL's own
 * definition as a declaration would rename a font that reserves nothing.
 */
const RFN_DEFINITION = new RegExp(`^[\\s${QUOTES}]*(?:refers\\s+to|unless\\b)`, 'i')

/**
 * PLAN §5.5 rule 3. Every name the licence header and name ID 0 reserve, deduplicated and
 * compared case-insensitively. `[]` means the font reserves nothing and ships untouched.
 *
 * A clause the parser cannot read a name out of is a hard failure rather than an empty
 * array: silently shipping an unrenamed Modified Version is the one outcome the rule exists
 * to prevent, and a licence header this pipeline cannot parse is a font a human should look
 * at before it goes anywhere near the catalogue.
 */
export function reservedFontNames(licenseText, copyrightName = '') {
  const names = []
  let declared = false
  for (const text of [licenseHeader(licenseText), String(copyrightName ?? '')]) {
    for (const [, clause] of text.matchAll(RFN_CLAUSE)) {
      if (RFN_DEFINITION.test(clause)) continue
      declared = true
      names.push(...reservedNamesInClause(clause))
    }
  }
  if (declared && names.length === 0) {
    throw new Error('the licence declares a Reserved Font Name the parser cannot read')
  }
  const seen = new Map()
  for (const name of names) if (!seen.has(squash(name))) seen.set(squash(name), name)
  return [...seen.values()]
}

/** Kept for the tests and for reading a shipped licence file back: does it reserve anything? */
export const declaresReservedFontName = (licenseText, copyrightName) =>
  reservedFontNames(licenseText, copyrightName).length > 0

// ---------------------------------------------------------------- rule 3: renaming

/** The comparison the OFL cares about: case and spacing are not what makes a name distinct. */
export const squash = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')

/**
 * Name IDs that must keep carrying attribution, and are therefore the only ones exempt from
 * the lint below: 0 is the copyright, 13 the licence text and 14 the licence URL. The OFL
 * FAQ 2.4 asks for exactly these to survive a subset, and renaming is a requirement of the
 * licence rather than a way to obscure who drew the font.
 */
export const ATTRIBUTION_NAME_IDS = [0, 13, 14]

/**
 * A neutral internal family name: `LZ` and six hex digits derived from the font id. It is
 * not the CSS family — `src/render.js` already serves every face as `f` — but the name a
 * font manager, a PDF and `document.fonts` will show, and the OFL requires it to share
 * nothing with the reserved name.
 *
 * Six hex digits can spell a word (`facade`, `decade`), so a collision with a reserved name
 * re-rolls with a salt rather than failing. Deterministic in the id, so the same font
 * rebuilds to the same bytes, and recomputable from the metadata: `neutralName(meta.id,
 * [meta.family, ...meta.rfn])`.
 */
export function neutralName(id, forbidden = []) {
  const words = forbidden.map(squash).filter(Boolean)
  for (let salt = 0; salt < 64; salt++) {
    const hex = sha256(salt === 0 ? id : `${id}#${salt}`)
      .slice(0, 6)
      .toUpperCase()
    const name = `LZ ${hex}`
    if (!words.some((w) => squash(name).includes(w))) return name
  }
  throw new Error(`${id}: every neutral name collides with a reserved one`)
}

/**
 * Rewrite a subset's name records onto the neutral name.
 *
 * What survives: 0, 13 and 14 verbatim (attribution), and the six records an engine needs
 * to identify a face at all — 1 family, 2 subfamily, 3 unique id, 4 full name, 5 version,
 * 6 PostScript name. Everything else goes, which on a `subset-font` output is nothing:
 * hb-subset keeps name IDs 0-6 plus whatever `preserveNameIds` adds, so 16/17/21/22/25 and
 * the `ssNN` feature names above 255 are already gone by the time this runs.
 *
 * The version keeps only its number. Upstream version strings routinely embed the family
 * name ("Lobster Version 2.000") and the full string is in `fonts/licenses/<id>.txt` in the
 * change notice regardless, so nothing is lost by carrying the number alone.
 */
export function renameRecords(records, { name, version }) {
  // A PostScript name may not contain a space, `(`, `)`, `[`, `]`, `{`, `}`, `<`, `>`,
  // `/`, `%` or any character outside 33-126 (OpenType `name`, name ID 6).
  const written = new Map([
    [1, name],
    [2, 'Regular'],
    [3, name],
    [4, name],
    [5, version],
    [6, name.replace(/\s+/g, '')],
  ])
  const out = []
  for (const record of records) {
    // A language-tag record belongs to a format 1 table, which `writeNames` does not emit.
    if (record.languageID >= 0x8000) continue
    if (ATTRIBUTION_NAME_IDS.includes(record.nameID)) out.push(record)
    else if (written.has(record.nameID)) out.push({ ...record, text: written.get(record.nameID) })
  }
  // A record the subset did not carry still has to exist, on the platform everything reads.
  for (const [nameID, text] of written) {
    if (!out.some((r) => r.nameID === nameID)) {
      out.push({ platformID: 3, encodingID: 1, languageID: 0x409, nameID, text })
    }
  }
  return out
}

/**
 * PLAN §5.5 rule 3's lint. No name record but the three that carry attribution may contain
 * the upstream family name or any reserved word, compared with case and spacing ignored.
 */
export function lintNames(id, records, forbidden) {
  const words = forbidden.map((w) => [w, squash(w)]).filter(([, w]) => w)
  for (const record of records) {
    if (ATTRIBUTION_NAME_IDS.includes(record.nameID)) continue
    for (const [word, squashed] of words) {
      if (squash(record.text).includes(squashed)) {
        fail(id, `name ${record.nameID} "${record.text}" still contains the reserved name "${word}"`)
      }
    }
  }
  return records.length
}

// ---------------------------------------------------------------- measurement

const CASE_PAIRS = [
  ['T', 't'],
  ['O', 'o'],
  ['M', 'm'],
  ['A', 'a'],
  ['S', 's'],
  ['Z', 'z'],
  ['C', 'c'],
  ['U', 'u'],
  ['D', 'd'],
  ['I', 'i'],
  ['Ł', 'ł'],
]

/**
 * Whether the lowercase letters are the capitals: `capsOnly` when every pair draws exactly
 * the same glyph, `unicase` when they are cap height but some are drawn differently. Either
 * way `text-transform` stops being worth randomising over, which is what the pipeline uses
 * this for.
 *
 * The single test is that no lowercase letter is meaningfully shorter than its capital.
 * Measured over the catalogue, a bicameral face lands at 0.69 to 0.82 of cap height and a
 * small-caps face at 0.71 to 0.86 — both well clear of the 0.95 line, and both of them
 * cases where case randomisation is worth having.
 *
 * Extents cannot reliably split `capsOnly` from `unicase`: Vina Sans, a caps-only face,
 * redraws three of its eleven lowercase letters a percent or two off, while Syncopate, a
 * true unicase, keeps seven of eleven byte-identical. `reconcileTraits` therefore accepts
 * either label against either finding rather than pretending to a precision it has not got.
 */
function measureCase({ font }) {
  const box = (ch) => font.glyphExtents(font.nominalGlyph(ch.codePointAt(0)))
  let identical = 0
  let shortest = Number.POSITIVE_INFINITY
  for (const [upper, lower] of CASE_PAIRS) {
    const u = box(upper)
    const l = box(lower)
    if (!u || !l) continue
    if (
      u.xBearing === l.xBearing &&
      u.yBearing === l.yBearing &&
      u.width === l.width &&
      u.height === l.height
    ) {
      identical++
    }
    shortest = Math.min(shortest, Math.abs(l.height) / Math.abs(u.height))
  }
  const unicameral = shortest >= 0.95
  const capsOnly = unicameral && identical === CASE_PAIRS.length
  return { capsOnly, unicase: unicameral && !capsOnly }
}

/**
 * A connected script is one whose adjacent letters overlap when shaped.
 *
 * Known limit: this measures ink boxes, not ink, so a face whose letters are drawn as
 * horizontally offset pieces reads as connected even though nothing joins — Rubik Glitch
 * overlaps on all six pairs. The cost is one lost case axis on such a font, and the
 * alternatives are worse: neither `curs` nor the positional features separate them
 * (Licorice and Tagger are connected and have none of them).
 */
function measureConnected({ font, upem }) {
  const glyphs = shape(font, WORDS.lowercase[1])
  let pen = 0
  let previousRight = null
  let joined = 0
  let pairs = 0
  for (const g of glyphs) {
    const e = font.glyphExtents(g.codepoint)
    if (!e) continue
    const left = pen + (g.xOffset ?? 0) + e.xBearing
    if (previousRight !== null) {
      pairs++
      if (previousRight > left + 0.01 * upem) joined++
    }
    previousRight = left + e.width
    pen += g.xAdvance ?? 0
  }
  return pairs > 0 && joined / pairs >= 0.6
}

const FLATTEN_STEPS = 8

/** Flatten one glyph outline into polylines, one per contour. */
function contours(font, gid) {
  const out = []
  let current = null
  let from = [0, 0]
  const lerp = (a, b, t) => a + (b - a) * t
  for (const { type, values } of font.glyphToJson(gid)) {
    if (type === 'M') {
      if (current && current.length > 2) out.push(current)
      current = [[values[0], values[1]]]
      from = [values[0], values[1]]
    } else if (type === 'L') {
      current?.push([values[0], values[1]])
      from = [values[0], values[1]]
    } else if (type === 'Q' || type === 'C') {
      const points = [
        from,
        ...Array.from({ length: values.length / 2 }, (_, i) => values.slice(i * 2, i * 2 + 2)),
      ]
      for (let s = 1; s <= FLATTEN_STEPS; s++) {
        const t = s / FLATTEN_STEPS
        let p = points
        while (p.length > 1) p = p.slice(1).map(([x, y], i) => [lerp(p[i][0], x, t), lerp(p[i][1], y, t)])
        current?.push(p[0])
      }
      from = points.at(-1)
    } else if (type === 'Z') {
      if (current && current.length > 2) out.push(current)
      current = null
    }
  }
  if (current && current.length > 2) out.push(current)
  return out
}

/**
 * Widths of the ink runs a line cuts out of a set of closed contours, by the non-zero
 * winding rule. `axis` 1 scans horizontally at height `at`, 0 scans vertically at `at`.
 *
 * Winding rather than pairing up crossings, because pairing is exactly wrong on the one
 * condition rule 5 goes out of its way to flag: two contours that overlap. Baloo Bhaijaan
 * 2's capital I is two stems overlapping over a third of their height, so every scanline
 * crosses at 65, 65, 240, 240 — paired off that is two runs of zero width, and the stem
 * measures 0.000 em. Accumulating direction gives the one 175-unit stem that is really
 * there, and gives the same answer as pairing on every non-overlapping glyph.
 */
function scanline(rings, at, axis = 1) {
  const along = axis === 1 ? 0 : 1
  const crossings = []
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      if ((a[axis] - at) * (b[axis] - at) >= 0) continue
      crossings.push({
        at: a[along] + ((b[along] - a[along]) * (at - a[axis])) / (b[axis] - a[axis]),
        direction: b[axis] > a[axis] ? 1 : -1,
      })
    }
  }
  crossings.sort((p, q) => p.at - q.at)
  const runs = []
  let winding = 0
  let start = 0
  for (const crossing of crossings) {
    if (winding === 0) start = crossing.at
    winding += crossing.direction
    if (winding === 0 && crossing.at > start) runs.push(crossing.at - start)
  }
  return runs
}

/**
 * Stem width, from the capital I — the one letter that is nothing but a stem.
 *
 * Measured across the outline, not around it: the ink bounding box is not the stem. In an
 * inline, outline or looped-script face the box spans the whole letter while the strokes
 * themselves are hairlines, which is how Bungee Hairline (stem 0.010 em, box 0.318 em) and
 * Rubik Scribble (0.012 vs 0.309) both read as heavyweight if you measure the box.
 *
 * Three scanlines across the middle, widest run on each, median of the three. Widest rather
 * than median-of-all because a textured face — Rubik Burned, Rubik Dirt — is a fat letter
 * with holes punched through it, and pooling every run through the holes makes it look like
 * a hairline. The widest run on a scanline is the stroke itself in both cases.
 */
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

/** Stem width in em, from the capital I — the one letter that is nothing but a stem. */
export function measureStem({ font, upem }) {
  const gid = font.nominalGlyph('I'.codePointAt(0))
  const extents = font.glyphExtents(gid)
  if (!extents) return null
  const top = extents.yBearing
  const bottom = extents.yBearing + extents.height
  const rings = contours(font, gid)
  const widest = [0.4, 0.5, 0.6]
    .map((at) => scanline(rings, bottom + (top - bottom) * at))
    .filter((runs) => runs.length > 0)
    .map((runs) => Math.max(...runs))
  return widest.length === 0 ? null : median(widest) / upem
}

/**
 * The narrowest stroke anywhere in Ł and ł, in em.
 *
 * On these two letters that is the crossbar, and it is the number that decides whether a
 * stroke, an inline or a hollow outline closes the letter up into a blob. Gloock and Rozha
 * One are the shape of the problem: a thick stem with a hairline crossbar, which a stem
 * measurement calls robust and which `outline-hollow` fills in solid.
 *
 * Scanned both ways — a horizontal cut measures an upright stroke, a vertical one measures
 * a flat crossbar — over the middle 90% of each axis, because the outermost slices catch
 * the tapering tip of a curve rather than a stroke. The tenth percentile rather than the
 * minimum for the same reason.
 */
export function measureCrossbar({ font, upem }) {
  const runs = []
  for (const ch of ['Ł', 'ł']) {
    const gid = font.nominalGlyph(ch.codePointAt(0))
    const extents = font.glyphExtents(gid)
    if (!extents) continue
    const rings = contours(font, gid)
    const box = {
      1: [extents.yBearing + extents.height, extents.yBearing],
      0: [extents.xBearing, extents.xBearing + extents.width],
    }
    for (const axis of [1, 0]) {
      const [low, high] = box[axis]
      for (let step = 0; step <= 40; step++) {
        const at = low + (high - low) * (0.05 + (0.9 * step) / 40)
        runs.push(...scanline(rings, at, axis))
      }
    }
  }
  if (runs.length === 0) return null
  runs.sort((a, b) => a - b)
  return runs[Math.floor(runs.length * 0.1)] / upem
}

function measureHairline(opened) {
  const stem = measureStem(opened)
  // A regular sans sits near 0.08 em and a light weight at 0.055 to 0.07; below 0.05 is a
  // hairline in the sense the effects care about (it cannot carry a stroke or an inline).
  return stem !== null && stem < 0.05
}

const crosses = (a, b, c, d) => {
  const side = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
}

/**
 * Whether any two contours of a shipped glyph cross. Read overlap flags are not a usable
 * signal here — almost no upstream sets them — so the geometry is tested directly. This is
 * only a trait for effect matching; `setOverlapFlags` is applied unconditionally regardless.
 */
function measureOverlap({ font }) {
  for (const ch of LETTERS) {
    const rings = contours(font, font.nominalGlyph(ch.codePointAt(0))).map((points) => ({
      points,
      box: points.reduce(
        (b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)],
        [Infinity, Infinity, -Infinity, -Infinity],
      ),
    }))
    for (let i = 0; i < rings.length; i++) {
      for (let j = i + 1; j < rings.length; j++) {
        const [a, b] = [rings[i], rings[j]]
        if (a.box[2] < b.box[0] || b.box[2] < a.box[0] || a.box[3] < b.box[1] || b.box[3] < a.box[1]) continue
        for (let p = 0; p < a.points.length; p++) {
          for (let q = 0; q < b.points.length; q++) {
            const segA = [a.points[p], a.points[(p + 1) % a.points.length]]
            const segB = [b.points[q], b.points[(q + 1) % b.points.length]]
            if (crosses(segA[0], segA[1], segB[0], segB[1])) return true
          }
        }
      }
    }
  }
  return false
}

/**
 * The five traits the outlines can settle, as a record so a declaration can be diffed.
 *
 * `axes` is the stop that will ship. It matters: a variable font's default instance is
 * often nowhere near the weight we pin it to, and measuring Big Shoulders at its default
 * rather than at its Black stop calls it a hairline. Measured through a throwaway font so
 * the caller's own font keeps its default variations for feature shaping.
 */
export function measureTraits({ face, upem }, axes = {}) {
  const font = new hb.Font(face)
  // `hb.Variation` instances, not plain objects: setVariations serializes them itself.
  const variations = Object.entries(axes).map(([tag, value]) => new hb.Variation(tag, value))
  if (variations.length > 0) font.setVariations(variations)
  try {
    const { capsOnly, unicase } = measureCase({ font })
    return {
      capsOnly,
      unicase,
      connected: measureConnected({ font, upem }),
      hairline: measureHairline({ font, upem }),
      overlap: measureOverlap({ font }),
    }
  } finally {
    font.destroy?.()
  }
}

/**
 * Merge a source row's traits with the measured ones.
 *
 * A row may declare a measured trait, because a batch file should read as a description of
 * the face and not only as build input. The pipeline measures it anyway and the two have to
 * agree: a curator who believes a font is caps-only when it is not has made an error worth
 * surfacing, so a disagreement is a hard failure rather than a silent override in either
 * direction. Traits the row leaves out are filled in from the measurement.
 */
/** Every measured trait the row declares that the outlines do not bear out. */
export function traitDisagreements(declared, measured) {
  return MEASURED_TRAITS.filter((trait) => {
    if (!declared.includes(trait)) return false
    // `capsOnly` and `unicase` are one measurement under two names; see `measureCase`.
    const accepts = CASE_TRAITS.includes(trait) ? CASE_TRAITS : [trait]
    return !accepts.some((t) => measured[t])
  })
}

export function reconcileTraits(id, declared, measured) {
  const wrong = traitDisagreements(declared, measured)
  if (wrong.length > 0) {
    const found = MEASURED_TRAITS.filter((t) => measured[t])
    fail(
      id,
      `the source row declares ${wrong.join(', ')}, the outlines measure ${wrong.length > 1 ? 'them' : 'it'} ` +
        `false (measured: ${found.join(', ') || 'none of the five'})`,
    )
  }
  const filled = MEASURED_TRAITS.filter((t) => measured[t])
  // When the row has already named one of the two case labels, keep its word for it.
  const named = declared.some((t) => CASE_TRAITS.includes(t))
  return [
    ...new Set([...declared, ...(named ? filled.filter((t) => !CASE_TRAITS.includes(t)) : filled)]),
  ].sort()
}

// ---------------------------------------------------------------- features

/**
 * PLAN §5.5 rule 4. Shape both words with the tag off and with it on; keep the tag only if
 * the glyph and position stream really differs. Case-like tags additionally have to change
 * every letter, Ł and ł included, or they are a partial small-caps that looks like a bug.
 */
export function effectiveFeatures(font, caseName, candidates) {
  const kept = []
  for (const tag of candidates) {
    let differs = false
    let everyLetter = true
    for (const word of WORDS[caseName]) {
      const before = shape(font, word)
      const after = shape(font, word, [tag])
      if (rendered(font, word) !== rendered(font, word, [tag])) differs = true
      if (before.length !== after.length) {
        everyLetter = false
      } else {
        for (let i = 0; i < before.length; i++) {
          const same = outlineOf(font, before[i].codepoint) === outlineOf(font, after[i].codepoint)
          if (same) everyLetter = false
        }
      }
    }
    if (!differs) continue
    if (CASE_FEATURES.includes(tag) && !everyLetter) continue
    kept.push(tag)
  }
  return kept
}

/**
 * Drop feature tags whose variant would shape the two words exactly like a variant that is
 * already being kept. Rule 4's on-versus-off test only ever compares a tag against plain
 * text, which lets three kinds of duplicate through, all of them seen in the batches:
 *
 *  - alias tags. `salt` and `ss01` are the same substitution in Playball, Moon Dance,
 *    Tagger and four of batch A, so both passed the on-versus-off test and shipped
 *    byte-identical files under two names;
 *  - a tag that only repeats what `text-transform` has already done;
 *  - `uppercase` + `c2sc` against `lowercase` + `smcp`, which arrive at the same small
 *    caps from opposite directions, so any font carrying both shipped a guaranteed pair.
 *
 * The plain variant of every case is seeded first and therefore always wins. After that the
 * order follows `planVariants` — round by round, cases in their given order — so the tag
 * that survives a collision is the one whose variant would have come first anyway.
 */
export function dedupeCombos(font, cases, featuresByCase) {
  const shaped = (caseName, feats) => WORDS[caseName].map((word) => rendered(font, word, feats)).join(' | ')
  const seen = new Set(cases.map((c) => shaped(c, [])))
  const kept = Object.fromEntries(cases.map((c) => [c, []]))
  const rounds = Math.max(0, ...cases.map((c) => featuresByCase[c].length))
  for (let round = 0; round < rounds; round++) {
    for (const caseName of cases) {
      const tag = featuresByCase[caseName][round]
      if (tag === undefined) continue
      const key = shaped(caseName, [tag])
      if (seen.has(key)) continue
      seen.add(key)
      kept[caseName].push(tag)
    }
  }
  return kept
}

/** GSUB tags this font actually has, minus the base set and the junk list. */
function candidateFeatures(face, allowed) {
  const tags = [...new Set(face.getTableFeatureTags('GSUB'))]
    .filter((t) => !BASE_FEATURES.includes(t) && !FEATURE_DENY.has(t))
    .sort()
  return allowed ? tags.filter((t) => allowed.includes(t)) : tags
}

// ---------------------------------------------------------------- source rows

/** `fvar` axis records. Needed because every axis has to be pinned, not just the ones we vary. */
function axisTags(tables) {
  const fvar = tables.find((t) => t.tag === 'fvar')
  if (!fvar) return []
  const at = fvar.data.readUInt16BE(4)
  const count = fvar.data.readUInt16BE(8)
  const size = fvar.data.readUInt16BE(10)
  return Array.from({ length: count }, (_, i) => {
    const p = at + i * size
    return {
      tag: fvar.data.toString('latin1', p, p + 4),
      min: fvar.data.readInt32BE(p + 4) / 65536,
      default: fvar.data.readInt32BE(p + 8) / 65536,
      max: fvar.data.readInt32BE(p + 12) / 65536,
    }
  })
}

export function validateRow(row, seen) {
  const id = row?.id ?? '<no id>'
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(row.id ?? '')) fail(id, 'id must be kebab-case')
  if (seen?.has(row.id)) fail(id, 'duplicate id')
  seen?.add(row.id)
  for (const key of ['family', 'url', 'licenseId', 'licenseUrl', 'copyright']) {
    if (typeof row[key] !== 'string' || row[key].length === 0) fail(id, `missing ${key}`)
  }
  if (typeof row.sha256 !== 'string' || !/^([0-9a-f]{64})?$/.test(row.sha256)) {
    fail(id, 'sha256 must be 64 lowercase hex characters, or empty to be filled on first run')
  }
  if (/fonts\.googleapis\.com|css2\?/.test(row.url)) fail(id, 'the Google css2 API is never a source')
  if (/\.zip(\?|$)/i.test(row.url)) fail(id, 'a source must be a file, never a zip')
  if (!LICENSE_IDS.has(row.licenseId)) fail(id, `licenseId ${row.licenseId} is not allowed`)
  if (!Array.isArray(row.archetype) || row.archetype.length === 0)
    fail(id, 'archetype must be a non-empty array')
  for (const a of row.archetype) if (!ARCHETYPES.has(a)) fail(id, `unknown archetype ${a}`)
  if (!Array.isArray(row.traits)) fail(id, 'traits must be an array')
  // A measured trait is allowed here and checked against the outlines by `reconcileTraits`.
  for (const t of row.traits) if (!TRAITS.has(t)) fail(id, `unknown trait ${t}`)
  if (!Number.isInteger(row.odds) || row.odds < 0 || row.odds > 16) fail(id, 'odds must be an integer 0-16')
  if (row.stops !== undefined) {
    if (!Array.isArray(row.stops) || row.stops.length === 0) fail(id, 'stops must be a non-empty array')
    if (row.stops.length > MAX_STOPS) fail(id, `at most ${MAX_STOPS} stops, got ${row.stops.length}`)
    // The stop id becomes the shipped filename, so it has to be present and unique.
    const ids = new Set()
    for (const stop of row.stops) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(stop.id ?? '')) fail(id, `stop id ${stop.id} must be kebab-case`)
      if (ids.has(stop.id)) fail(id, `duplicate stop id ${stop.id}`)
      ids.add(stop.id)
      if (Object.keys(stop).filter((k) => k !== 'id').length === 0) fail(id, `stop ${stop.id} pins no axis`)
    }
  }
  if (row.cases !== undefined) {
    for (const c of row.cases) if (!(c in WORDS)) fail(id, `unknown case ${c}`)
  }
  return row
}

/**
 * PLAN §5.5 rule 1: a source with no immutable commit behind it — GUST on CTAN, a foundry
 * download — has to ship the original too, because the hash alone cannot reproduce the
 * build once the file moves. A full 40-character hash somewhere in the path is what makes
 * a raw URL immutable; the host is not the point, and GitHub, GitLab, Codeberg and
 * sourcehut all spell the rest of it differently.
 */
export const pinnedToCommit = (url) => /^https:\/\/[^/]+\/\S*\/[0-9a-f]{40}\//.test(url)

/**
 * Where a committed original lives, and where extra licence material to append to it lives
 * (the upstream MANIFEST that rule 8 asks for on GUST fonts). Both are found by id rather
 * than named in the row: the source-row schema is fixed by §5.5 and shared with every other
 * batch, and a file that has to exist under a known name does not also need declaring.
 */
export const upstreamPaths = (row) => ({
  original: `${row.id}${(row.url.match(/\.(otf|ttf)(\?|$)/i) ?? ['.ttf'])[0].toLowerCase()}`,
  notice: `${row.id}.notice.txt`,
})

// ---------------------------------------------------------------- fetching

const cacheDir = join(tmpdir(), 'luzid-fonts')

async function fetchBinary(url) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`GET ${url} → ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/**
 * Upstream original, from `fonts/upstream` when committed, else from a sha-keyed cache.
 * `readOnly` keeps the auditor from committing another batch's original into this branch.
 */
async function source(row, dirs, readOnly = false) {
  if (!pinnedToCommit(row.url)) {
    const path = join(dirs.upstream, upstreamPaths(row).original)
    const buffer = await readFile(path).catch(() => null)
    if (buffer) return buffer
    const fetched = await fetchBinary(row.url)
    if (readOnly) return fetched
    await mkdir(dirs.upstream, { recursive: true })
    await writeFile(path, fetched)
    return fetched
  }
  await mkdir(cacheDir, { recursive: true })
  if (row.sha256) {
    const cached = await readFile(join(cacheDir, `${row.sha256}.bin`)).catch(() => null)
    if (cached && sha256(cached) === row.sha256) return cached
  }
  const fetched = await fetchBinary(row.url)
  await writeFile(join(cacheDir, `${sha256(fetched)}.bin`), fetched)
  return fetched
}

async function licenseText(row, dirs) {
  await mkdir(cacheDir, { recursive: true })
  const parts = []
  for (const url of [row.licenseUrl]) {
    const key = join(cacheDir, `${createHash('sha256').update(url).digest('hex')}.txt`)
    let text = await readFile(key, 'utf8').catch(() => null)
    if (text === null) {
      text = (await fetchBinary(url)).toString('utf8')
      await writeFile(key, text)
    }
    parts.push(text.replace(/\r\n/g, '\n').trimEnd())
  }
  // Rule 8 wants the upstream MANIFEST appended for GUST fonts. It is committed rather
  // than fetched: CTAN has no immutable URLs, so a build must not depend on reaching it.
  const notice = await readFile(join(dirs.upstream, upstreamPaths(row).notice), 'utf8').catch(() => null)
  if (notice) parts.push(notice.replace(/\r\n/g, '\n').trimEnd())
  return parts
}

// ---------------------------------------------------------------- the pipeline

/**
 * A source row's stop is `{id, ...axes}` — the curator names it, because the name ends up
 * in the shipped filename and `w900x` reads better than `wght900-wdth200`. A font with no
 * axes has one implicit stop, `static`.
 */
export function normalizeStops(row) {
  return (row.stops ?? [{}]).map((stop) => {
    const { id, ...axes } = stop
    return { id: id ?? 'static', axes }
  })
}

const CASE_SHORT = { none: 'n', uppercase: 'u', lowercase: 'l' }

/**
 * Case × effective feature sets × stops, capped at `MAX_VARIANTS`. Built round by round so
 * that trimming loses the most decorated variants first and every case keeps its plain one.
 */
export function planVariants({ cases, featuresByCase, stops }) {
  const rounds = Math.max(...cases.map((c) => featuresByCase[c].length + 1))
  const out = []
  for (let round = 0; round < rounds; round++) {
    for (const caseName of cases) {
      const feats = round === 0 ? [] : featuresByCase[caseName].slice(round - 1, round)
      if (round > 0 && feats.length === 0) continue
      for (const [index, stop] of stops.entries()) {
        if (out.length >= MAX_VARIANTS) return out
        out.push({
          id: `${CASE_SHORT[caseName]}-${feats.length ? feats.join('-') : 'base'}-${stop.id}`,
          case: caseName,
          feats,
          stop: index,
        })
      }
    }
  }
  return out
}

/**
 * Subset one stop, normalize it, set the overlap flags and pack it. Returns the WOFF2.
 *
 * `rename` is `{name, version}` for a font whose licence reserves its name and `null` for
 * one that does not — a font with no Reserved Font Name keeps its own name table untouched.
 * The rename happens after subsetting rather than before: hb-subset can only choose which
 * name records to *keep*, so the table has to be rebuilt either way, and rebuilding the
 * short one costs less than rebuilding the upstream's hundred records.
 */
async function subsetStop({ original, axes, keepFeatures, rename }) {
  const sfnt = await subsetFont(original, TEXT, {
    targetFormat: 'sfnt',
    noHinting: true,
    preserveNameIds: [13, 14],
    dropTables: ['STAT', 'MVAR'],
    ...(Object.keys(axes).length > 0 ? { variationAxes: axes } : {}),
    keepFeatures,
  })
  const parsed = parse(sfnt)
  setOverlapFlags(parsed.tables)
  if (rename) writeNames(parsed.tables, renameRecords(readNames(parsed.tables), rename))
  // The ink has to be measured before the metrics can be derived, and the metrics have to
  // be written before the file can be weighed, so the subset is handed back in between.
  return { parsed, sfnt: build(parsed) }
}

/**
 * PLAN §5.5 rule 7's ladder. Run `attempt`; if it comes back over budget, shed the last
 * effective feature of every case, then whole stops, then give up and let the font be
 * dropped. Anything that is not a budget failure propagates untouched.
 *
 * `attempt` has to be the *whole* build, down to weighing the packed file, or the ladder
 * never runs: the budget is only knowable at the last step, so a build that stops short of
 * it and weighs the file afterwards throws from outside the `try` and takes the batch down
 * with it. That is precisely what used to happen, and it is why this is one function with
 * the attempt passed in rather than a loop wrapped around part of the work.
 */
export async function shedToBudget({ id, cases, featuresByCase, stops, log = () => {} }, attempt) {
  const state = { featuresByCase: { ...featuresByCase }, stops }
  for (;;) {
    try {
      return await attempt(state)
    } catch (error) {
      if (!/over the .* budget/.test(error.message)) throw error
      const over = error.message.replace(`${id}: `, '')
      if (cases.some((c) => state.featuresByCase[c].length > 0)) {
        for (const c of cases) state.featuresByCase[c] = state.featuresByCase[c].slice(0, -1)
        log(`${id}: ${over}; dropped the last effective feature`)
        continue
      }
      if (state.stops.length > 1) {
        state.stops = state.stops.slice(0, -1)
        log(`${id}: ${over}; dropped a stop`)
        continue
      }
      throw new Error(`${id}: ${over} with nothing left to trim — drop the font`)
    }
  }
}

/** Write the derived metrics into a subset, pack it, and weigh it against rule 7's budget. */
function packStop(id, parsed, metrics) {
  normalizeMetrics(parsed.tables, metrics)
  const finished = build(parsed)
  const woff2 = encode(finished)
  checkBudget(id, woff2.length)
  return { sfnt: finished, woff2 }
}

/**
 * Re-open what will actually ship and prove it, rather than trusting the encoder.
 * `forbidden` is rule 3's lint list — the upstream family plus every reserved name — and is
 * empty for a font that reserves nothing and therefore keeps its own name table.
 */
function verifyFile(id, woff2, metrics, forbidden = []) {
  const sfnt = decode(woff2)
  const { tables } = parse(sfnt)
  const written = readMetrics(tables)
  if (written.ascender !== metrics.asc || written.descender !== -metrics.desc) {
    fail(id, 'the re-parsed file does not carry the metrics that were written')
  }
  const overlap = hasOverlapFlags(tables)
  if (overlap.glyphs !== overlap.flagged) fail(id, 'the re-parsed file lost its overlap flags')
  const names = readNames(tables)
  lintNames(id, names, forbidden)
  const opened = open(sfnt)
  try {
    const covered = checkCoverage(id, opened)
    if (covered !== 23) fail(id, `the shipped file maps ${covered} code points, expected 23`)
    return { glyphs: covered, overlap, names, upm: unitsPerEm(tables) }
  } finally {
    opened.close()
  }
}

async function processRow(row, dirs, log) {
  const id = row.id
  const original = await source(row, dirs)
  const digest = sha256(original)
  if (row.sha256 && row.sha256 !== digest)
    fail(id, `sha256 mismatch: row says ${row.sha256}, file is ${digest}`)
  const filled = row.sha256 ? null : digest

  const upstream = open(original)
  let result
  try {
    checkCoverage(id, upstream)

    // Licence gate, PLAN §5.5 rule 3.
    const [license, ...notices] = await licenseText(row, dirs)
    const name0 = upstream.face.getName(0, 'en')
    if (!/Copyright|Prawa autorskie|©/i.test(license + name0)) fail(id, 'no copyright statement found')

    // A Reserved Font Name is no longer a refusal. The OFL does not forbid using the font;
    // it forbids a Modified Version — which a 23-glyph subset is (OFL FAQ 2.2, 2.5, 2.6) —
    // from carrying the reserved name. So the subset ships under a neutral internal name and
    // the attribution stays exactly where it was: name ID 0, the licence file, the change
    // notice and the source URL are all untouched, and the colophon still credits `family`.
    let rfn
    try {
      rfn = reservedFontNames(license, name0)
    } catch (error) {
      fail(id, error.message)
    }
    const version = (upstream.face.getName(5, 'en')?.match(/Version\s+[\d.]+/) ?? ['unknown version'])[0]
    // The lint list, and the rename, are only built for a font that reserves something: a
    // font with no Reserved Font Name keeps its own name table, byte for byte.
    const forbidden = rfn.length > 0 ? [row.family, ...rfn] : []
    const rename = rfn.length > 0 ? { name: neutralName(id, forbidden), version } : null
    if (rename) log(`${id}: reserves ${rfn.map((n) => `"${n}"`).join(', ')} — shipping as ${rename.name}`)

    const axes = axisTags(parse(original).tables)
    const stops = normalizeStops(row)
    if (axes.length > 0 && !row.stops) fail(id, 'a variable font must list its static stops')
    for (const stop of stops) {
      const pinned = Object.keys(stop.axes).sort().join(',')
      const wanted = axes
        .map((a) => a.tag)
        .sort()
        .join(',')
      if (pinned !== wanted) fail(id, `stop ${stop.id} pins {${pinned}}, the font has axes {${wanted}}`)
      for (const a of axes) {
        if (stop.axes[a.tag] < a.min || stop.axes[a.tag] > a.max) {
          fail(id, `stop ${stop.id}: ${a.tag}=${stop.axes[a.tag]} is outside [${a.min}, ${a.max}]`)
        }
      }
    }

    // Measured traits and the cases that are worth randomising over.
    // Traits describe the font as it ships, so they are measured at its first stop.
    const measured = measureTraits(upstream, stops[0].axes)
    const { capsOnly, unicase, connected } = measured
    const traits = reconcileTraits(id, row.traits, measured)
    let cases = row.cases ?? ['none', 'uppercase', 'lowercase']
    if (capsOnly || unicase) cases = ['none']
    else if (connected) cases = cases.filter((c) => c !== 'uppercase')

    const candidates = candidateFeatures(upstream.face, row.features)
    // Rule 4 keeps a tag that changes the words; the dedupe then drops the ones that all
    // change them the same way. Both are needed: the first is per tag, the second per pair.
    const featuresByCase = dedupeCombos(
      upstream.font,
      cases,
      Object.fromEntries(cases.map((c) => [c, effectiveFeatures(upstream.font, c, candidates)])),
    )

    /**
     * One full attempt: subset every stop, measure the ink on those subsets, derive the
     * metrics from those measurements, write them back and weigh the result.
     *
     * It is one function because rule 7's budget is only knowable at the very last step —
     * the file cannot be weighed until the metrics are in it — and the ladder below has to
     * be able to catch that and try again with less.
     */
    const attempt = async (state) => {
      const tags = [...new Set(cases.flatMap((c) => state.featuresByCase[c]))].sort()
      const keepFeatures = [...BASE_FEATURES, ...tags]
      const plan = planVariants({ cases, featuresByCase: state.featuresByCase, stops: state.stops })
      const used = [...new Set(plan.map((v) => v.stop))].sort((a, b) => a - b)
      const built = []
      const measured = new Map()

      for (const index of used) {
        const stop = state.stops[index]
        const file = {
          index,
          stop,
          ...(await subsetStop({ original, axes: stop.axes, keepFeatures, rename })),
        }
        const instance = open(file.sfnt)
        try {
          for (const variant of plan.filter((v) => v.stop === index)) {
            const words = WORDS[variant.case].map((word) => {
              const box = inkBox(instance.font, shape(instance.font, word, variant.feats))
              if (!box) fail(id, `variant ${variant.id} shapes "${word}" to nothing`)
              return box
            })
            measured.set(variant.id, { words, upem: instance.upem })
          }
          file.upem = instance.upem
          // Stroke widths are read off the shipped instance, so a pinned wght is included.
          file.stroke = { stem: measureStem(instance), crossbar: measureCrossbar(instance) }
          // referenceTable hands back a Uint8Array; usWeightClass is OS/2 offset 4.
          const os2 = instance.face.referenceTable('OS/2')
          file.weight = os2 ? (os2[4] << 8) | os2[5] : undefined
        } finally {
          instance.close()
        }
        built.push(file)
      }

      // PLAN §5.2: one pair of metrics per file, over every variant that uses it.
      for (const file of built) {
        const mine = plan.filter((v) => v.stop === file.index).map((v) => measured.get(v.id))
        file.metrics = deriveMetrics({
          upm: file.upem,
          tops: mine.flatMap((m) => m.words.map((w) => w.top)),
          depths: mine.flatMap((m) => m.words.map((w) => -w.bottom)),
        })
        file.woff2 = packStop(id, file.parsed, file.metrics).woff2
        file.checked = verifyFile(id, file.woff2, file.metrics, forbidden)
      }
      return { variants: plan, files: built, measurements: measured }
    }

    const { variants, files, measurements } = await shedToBudget(
      { id, cases, featuresByCase, stops, log },
      attempt,
    )

    // PLAN §5.2 converts the written asc/desc back to em, so the grid they are on is part of
    // the contract. It belongs to the face, not to a pinned instance: pinning an axis cannot
    // change it, and the renderer should never have to ask which file it is looking at.
    const upm = files[0].checked.upm
    for (const file of files) {
      if (file.checked.upm !== upm)
        fail(id, `unitsPerEm differs between stops (${upm} and ${file.checked.upm})`)
      if (file.upem !== upm) fail(id, `unitsPerEm changed under subsetting (${file.upem} became ${upm})`)
    }

    const notice = changeNotice(row.family, version, row.url)
    const em = (value, upem) => Number((value / upem).toFixed(5))

    result = {
      meta: {
        id,
        family: row.family,
        src: { url: row.url, sha256: digest },
        licenseId: row.licenseId,
        copyright: row.copyright,
        // Rule 3: the names the licence reserves, `[]` when it reserves none. A non-empty
        // array means the shipped files carry `neutralName(id, [family, ...rfn])` in their
        // name table instead of `family`; `family` above is still the upstream face, which
        // is what the colophon and `fonts/licenses/<id>.txt` credit.
        rfn,
        archetype: row.archetype,
        traits,
        odds: row.odds,
        upm,
        files: files.map((f) => ({
          id: f.stop.id,
          axes: f.stop.axes,
          bytes: f.woff2.length,
          sha256: sha256(f.woff2),
          asc: f.metrics.asc,
          desc: f.metrics.desc,
          // Both in em, both per stop because pinning wght moves them a long way. `stem` is
          // the capital I; `crossbar` is the narrowest stroke in Ł and ł, which is what
          // decides whether a stroke or a hollow outline closes the letter into a blob.
          stem: f.stroke.stem === null ? null : Number(f.stroke.stem.toFixed(4)),
          crossbar: f.stroke.crossbar === null ? null : Number(f.stroke.crossbar.toFixed(4)),
          glyphs: f.checked.glyphs,
        })),
        variants: variants.map((v) => {
          const { words, upem } = measurements.get(v.id)
          const file = files.find((f) => f.index === v.stop)
          const word = (w) => ({
            W: em(w.right - w.left, upem),
            H: em(w.top - w.bottom, upem),
            X: em(w.left, upem),
            top: em(w.top, upem),
          })
          return {
            id: v.id,
            file: file.stop.id,
            case: v.case,
            css: {
              weight: file.stop.axes.wght ?? file.weight ?? 400,
              style: row.italic ? 'italic' : 'normal',
              feat: v.feats.length ? v.feats.map((t) => `"${t}" 1`).join(',') : 'normal',
            },
            w1: word(words[0]),
            w2: word(words[1]),
          }
        }),
      },
      license: [notice, '', `Upstream copyright: ${name0}`, '', ...[license, ...notices]].join('\n'),
      files: files.map((f) => ({ name: `${id}.${f.stop.id}.woff2`, data: f.woff2 })),
      filled,
    }
  } finally {
    upstream.close()
  }
  return result
}

/**
 * `--traits`: download every selected source, measure the five geometric traits and diff
 * them against what the rows declare. It never subsets and never writes, so a whole batch
 * of curated lists can be checked in a couple of minutes before the build agents start.
 */
async function auditTraits(rows, dirs, log) {
  const disagreements = []
  const unreadable = []
  const added = new Map()
  for (const { row, batch } of rows) {
    let opened = null
    try {
      const original = await source(row, dirs, true)
      const digest = sha256(original)
      if (row.sha256 && row.sha256 !== digest) throw new Error(`sha256 mismatch, file is ${digest}`)
      opened = open(original)
      checkCoverage(row.id, opened)
      const measured = measureTraits(opened, normalizeStops(row)[0].axes)
      // Deliberately the same call the build makes, so the audit cannot drift away from it.
      try {
        reconcileTraits(row.id, row.traits, measured)
      } catch (error) {
        disagreements.push({ batch, id: row.id, why: error.message.replace(`${row.id}: `, '') })
      }
      for (const trait of MEASURED_TRAITS) {
        if (!row.traits.includes(trait) && measured[trait]) added.set(trait, (added.get(trait) ?? 0) + 1)
      }
    } catch (error) {
      unreadable.push({ batch, id: row.id, why: error.message.replace(`${row.id}: `, '') })
    } finally {
      opened?.close()
    }
  }

  log(`\nChecked ${rows.length} rows.`)
  log(`Traits the rows declare and the outlines disagree with: ${disagreements.length}`)
  for (const d of disagreements) log(`  ${d.batch} ${d.id}: ${d.why}`)
  log(
    `Traits the rows leave out and the pipeline fills in: ${[...added].map(([t, n]) => `${t} ${n}`).join(', ')}`,
  )
  if (unreadable.length > 0) {
    log(`Rows that could not be read at all: ${unreadable.length}`)
    for (const u of unreadable) log(`  ${u.batch} ${u.id}: ${u.why}`)
  }
  if (disagreements.length > 0 || unreadable.length > 0) process.exitCode = 1
}

// ---------------------------------------------------------------- entry point

async function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', default: '.' },
      batch: { type: 'string', multiple: true },
      id: { type: 'string', multiple: true },
      check: { type: 'boolean', default: false },
      traits: { type: 'boolean', default: false },
    },
  })
  const root = resolve(values.root)
  const dirs = {
    sources: join(root, 'fonts/sources'),
    files: join(root, 'fonts/files'),
    meta: join(root, 'fonts/meta'),
    licenses: join(root, 'fonts/licenses'),
    upstream: join(root, 'fonts/upstream'),
  }
  const wanted = values.id?.length ? new Set(values.id.flatMap((v) => v.split(','))) : null
  const batches = (await readdir(dirs.sources)).filter((f) => f.endsWith('.json'))
  const seen = new Set()
  const rows = []
  for (const batch of batches.sort()) {
    const name = batch.replace(/\.json$/, '')
    for (const row of JSON.parse(await readFile(join(dirs.sources, batch), 'utf8'))) {
      validateRow(row, seen)
      if (values.batch?.length && !values.batch.includes(name)) continue
      if (wanted && !wanted.has(row.id)) continue
      rows.push({ row, batch })
    }
  }
  if (rows.length === 0) throw new Error('no source rows selected')

  const log = (line) => console.log(line)
  if (values.traits) return await auditTraits(rows, dirs, log)
  const filled = new Map()
  // A row that cannot be built is still a hard failure — nothing is written for it and the
  // run exits non-zero — but the rest of the batch is built anyway. A curator needs the
  // whole list of fonts to replace, not just the first one that stopped the run.
  const refused = []
  for (const { row } of rows) {
    let out
    try {
      out = await processRow(row, dirs, log)
    } catch (error) {
      refused.push(error.message)
      log(`${error.message}`)
      continue
    }
    if (out.filled) filled.set(row.id, out.filled)
    const sizes = out.meta.files.map((f) => `${f.id} ${f.bytes} B`).join(' · ')
    log(`${row.id}: ${out.meta.files.length} file(s), ${out.meta.variants.length} variants — ${sizes}`)
    if (values.check) continue
    for (const dir of [dirs.files, dirs.meta, dirs.licenses]) await mkdir(dir, { recursive: true })
    const stale = (await readdir(dirs.files)).filter(
      (f) => f.startsWith(`${row.id}.`) && !out.files.some((w) => w.name === f),
    )
    for (const f of stale) await rm(join(dirs.files, f))
    for (const file of out.files) await writeFile(join(dirs.files, file.name), file.data)
    await writeFile(join(dirs.meta, `${row.id}.json`), `${JSON.stringify(out.meta, null, 1)}\n`)
    await writeFile(join(dirs.licenses, `${row.id}.txt`), `${out.license.trimEnd()}\n`)
  }
  if (filled.size > 0) {
    log('\nFill these sha256 values into the source rows and commit them:')
    for (const [id, digest] of filled) log(`  ${id}  ${digest}`)
  }
  if (refused.length > 0) {
    log(`\n${refused.length} of ${rows.length} rows were refused:`)
    for (const why of refused) log(`  ${why}`)
    process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
