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
  setOverlapFlags,
  unitsPerEm,
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

const signature = (glyphs) =>
  glyphs.map((g) => `${g.codepoint}/${g.xAdvance ?? 0}/${g.xOffset ?? 0}/${g.yOffset ?? 0}`).join(' ')

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

/**
 * PLAN §5.5 rule 3. The phrase "Reserved Font Name" appears in the body of every OFL 1.1
 * text, so only the copyright block above the licence proper is searched, plus name ID 0
 * of the binary, which is where a declaration that the licence file forgot would show up.
 */
export function declaresReservedFontName(licenseText, copyrightName) {
  const header = licenseText.split(/\n-{5,}/)[0]
  const rfn = /with\s+Reserved\s+Font\s+Name/i
  return rfn.test(header) || rfn.test(copyrightName ?? '')
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

/** Widths of the ink runs a horizontal line at `y` cuts out of a set of closed contours. */
function scanline(rings, y) {
  const xs = []
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      if ((a[1] - y) * (b[1] - y) < 0) xs.push(a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]))
    }
  }
  xs.sort((p, q) => p - q)
  const runs = []
  for (let i = 0; i + 1 < xs.length; i += 2) runs.push(xs[i + 1] - xs[i])
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
function measureHairline({ font, upem }) {
  const gid = font.nominalGlyph('I'.codePointAt(0))
  const extents = font.glyphExtents(gid)
  if (!extents) return false
  const top = extents.yBearing
  const bottom = extents.yBearing + extents.height
  const rings = contours(font, gid)
  const widest = [0.4, 0.5, 0.6]
    .map((at) => scanline(rings, bottom + (top - bottom) * at))
    .filter((runs) => runs.length > 0)
    .map((runs) => Math.max(...runs))
  if (widest.length === 0) return false
  widest.sort((a, b) => a - b)
  // A regular sans sits near 0.08 em and a light weight at 0.055 to 0.07; below 0.05 is a
  // hairline in the sense the effects care about (it cannot carry a stroke or an inline).
  return widest[Math.floor(widest.length / 2)] / upem < 0.05
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
      if (signature(before) !== signature(after)) differs = true
      if (before.length !== after.length) {
        everyLetter = false
      } else {
        for (let i = 0; i < before.length; i++) {
          if (before[i].codepoint === after[i].codepoint) everyLetter = false
        }
      }
    }
    if (!differs) continue
    if (CASE_FEATURES.includes(tag) && !everyLetter) continue
    kept.push(tag)
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

/** Subset one stop, normalize it, set the overlap flags and pack it. Returns the WOFF2. */
async function buildFile({ id, original, axes, keepFeatures, metrics }) {
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
  if (!metrics) return { sfnt: build(parsed), parsed }
  normalizeMetrics(parsed.tables, metrics)
  const finished = build(parsed)
  const woff2 = encode(finished)
  checkBudget(id, woff2.length)
  return { sfnt: finished, woff2, parsed }
}

/** Re-open what will actually ship and prove it, rather than trusting the encoder. */
function verifyFile(id, woff2, metrics) {
  const sfnt = decode(woff2)
  const { tables } = parse(sfnt)
  const written = readMetrics(tables)
  if (written.ascender !== metrics.asc || written.descender !== -metrics.desc) {
    fail(id, 'the re-parsed file does not carry the metrics that were written')
  }
  const overlap = hasOverlapFlags(tables)
  if (overlap.glyphs !== overlap.flagged) fail(id, 'the re-parsed file lost its overlap flags')
  const opened = open(sfnt)
  try {
    const covered = checkCoverage(id, opened)
    if (covered !== 23) fail(id, `the shipped file maps ${covered} code points, expected 23`)
    return { glyphs: covered, overlap, upm: unitsPerEm(tables) }
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
    if (declaresReservedFontName(license, name0)) fail(id, 'the licence declares a Reserved Font Name')
    if (!/Copyright|Prawa autorskie|©/i.test(license + name0)) fail(id, 'no copyright statement found')

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
    const featuresByCase = Object.fromEntries(
      cases.map((c) => [c, effectiveFeatures(upstream.font, c, candidates)]),
    )

    // Rule 7's ladder: drop features that buy nothing, then stops, then the font.
    let keptStops = stops
    let variants
    let files
    for (;;) {
      const tags = [...new Set(cases.flatMap((c) => featuresByCase[c]))].sort()
      variants = planVariants({ cases, featuresByCase, stops: keptStops })
      const used = [...new Set(variants.map((v) => v.stop))].sort((a, b) => a - b)
      const keepFeatures = [...BASE_FEATURES, ...tags]
      try {
        files = []
        for (const index of used) {
          const stop = keptStops[index]
          const draft = await buildFile({ id, original, axes: stop.axes, keepFeatures })
          files.push({ index, stop, draft })
        }
      } catch (error) {
        if (!/over the .* budget/.test(error.message)) throw error
        const droppable = cases.find((c) => featuresByCase[c].length > 0)
        if (droppable) {
          for (const c of cases) featuresByCase[c] = featuresByCase[c].slice(0, -1)
          log(`${id}: over budget, dropped the last effective feature`)
          continue
        }
        if (keptStops.length > 1) {
          keptStops = keptStops.slice(0, -1)
          log(`${id}: over budget, dropped a stop`)
          continue
        }
        fail(id, `${error.message} — drop the font`)
      }
      break
    }

    // Ink measurement happens on the subset, so the numbers describe exactly what ships.
    const measurements = new Map()
    for (const file of files) {
      const instance = open(file.draft.sfnt)
      try {
        for (const variant of variants.filter((v) => v.stop === file.index)) {
          const words = WORDS[variant.case].map((word) => {
            const box = inkBox(instance.font, shape(instance.font, word, variant.feats))
            if (!box) fail(id, `variant ${variant.id} shapes "${word}" to nothing`)
            return box
          })
          measurements.set(variant.id, { words, upem: instance.upem })
        }
        file.upem = instance.upem
        // referenceTable hands back a Uint8Array; usWeightClass is OS/2 offset 4.
        const os2 = instance.face.referenceTable('OS/2')
        file.weight = os2 ? (os2[4] << 8) | os2[5] : undefined
      } finally {
        instance.close()
      }
    }

    // PLAN §5.2: one pair of metrics per file, over every variant that uses it.
    for (const file of files) {
      const mine = variants.filter((v) => v.stop === file.index).map((v) => measurements.get(v.id))
      const tops = mine.flatMap((m) => m.words.map((w) => w.top))
      const depths = mine.flatMap((m) => m.words.map((w) => -w.bottom))
      file.metrics = deriveMetrics({ upm: file.upem, tops, depths })
      const built = await buildFile({
        id,
        original,
        axes: file.stop.axes,
        keepFeatures: [...BASE_FEATURES, ...new Set(cases.flatMap((c) => featuresByCase[c]))].sort(),
        metrics: file.metrics,
      })
      file.woff2 = built.woff2
      file.checked = verifyFile(id, built.woff2, file.metrics)
    }

    // PLAN §5.2 converts the written asc/desc back to em, so the grid they are on is part of
    // the contract. It belongs to the face, not to a pinned instance: pinning an axis cannot
    // change it, and the renderer should never have to ask which file it is looking at.
    const upm = files[0].checked.upm
    for (const file of files) {
      if (file.checked.upm !== upm)
        fail(id, `unitsPerEm differs between stops (${upm} and ${file.checked.upm})`)
      if (file.upem !== upm) fail(id, `unitsPerEm changed under subsetting (${file.upem} became ${upm})`)
    }

    const version = (upstream.face.getName(5, 'en').match(/Version\s+[\d.]+/) ?? ['unknown version'])[0]
    const notice = changeNotice(row.family, version, row.url)
    const em = (value, upem) => Number((value / upem).toFixed(5))

    result = {
      meta: {
        id,
        family: row.family,
        src: { url: row.url, sha256: digest },
        licenseId: row.licenseId,
        copyright: row.copyright,
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
  for (const { row } of rows) {
    const out = await processRow(row, dirs, log)
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
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
