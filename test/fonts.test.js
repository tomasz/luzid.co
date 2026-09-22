import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import * as hb from 'harfbuzzjs'
import {
  ARCHETYPES,
  BUDGET_BYTES,
  changeNotice,
  checkBudget,
  checkCoverage,
  declaresReservedFontName,
  effectiveFeatures,
  LETTERS,
  LICENSE_IDS,
  MAX_STOPS,
  MAX_VARIANTS,
  MEASURED_TRAITS,
  pinnedToCommit,
  planVariants,
  reconcileTraits,
  TEXT,
  TRAITS,
  traitDisagreements,
  upstreamPaths,
  validateRow,
  WORDS,
} from '../scripts/fonts.mjs'
import {
  deriveMetrics,
  hasOverlapFlags,
  normalizeMetrics,
  parse,
  readMetrics,
  unitsPerEm,
} from '../scripts/sfnt.mjs'
import { decode } from '../scripts/woff2.mjs'

const url = (p) => new URL(`../${p}`, import.meta.url)
const readJson = async (p) => JSON.parse(await readFile(url(p), 'utf8'))

// Every batch, not just the seed set: once a Wave-2 batch ships, its metas are on disk
// and a seed-only source list makes every cross-check below compare two different worlds.
const sources = []
for (const name of (await readdir(url('fonts/sources'))).filter((f) => f.endsWith('.json')).sort()) {
  sources.push(...(await readJson(`fonts/sources/${name}`)))
}
/** A known-good row for the negative cases below, found by id rather than by position. */
const seedRow = sources.find((r) => r.id === 'boldonse')
const metas = []
for (const name of (await readdir(url('fonts/meta'))).filter((f) => f.endsWith('.json')).sort()) {
  metas.push(await readJson(`fonts/meta/${name}`))
}

/** A font stand-in, so every branch of the coverage gate gets its own failing fixture. */
function stub(overrides = {}) {
  const gids = new Map([...TEXT].map((c, i) => [c.codePointAt(0), i + 1]))
  const font = {
    nominalGlyph: (cp) => gids.get(cp),
    glyphExtents: () => ({ xBearing: 0, yBearing: 700, width: 500, height: -700 }),
    glyphHAdvance: () => 500,
    ...overrides,
  }
  return { font, face: { collectUnicodes: () => new Uint32Array(23) }, gids }
}

// ---------------------------------------------------------------- rule 1: never the css2 API

test('rule 1: the Google css2 API is never a source, and neither is a zip', () => {
  const base = seedRow
  assert.throws(
    () => validateRow({ ...base, url: 'https://fonts.googleapis.com/css2?family=Boldonse&text=Tomasz' }),
    /css2 API is never a source/,
  )
  assert.throws(
    () => validateRow({ ...base, url: 'https://mirrors.ctan.org/fonts/cyklop.zip' }),
    /never a zip/,
  )
  for (const row of sources) {
    assert.doesNotMatch(row.url, /fonts\.googleapis\.com|css2\?/, `${row.id} is sourced from the css2 API`)
    assert.doesNotMatch(row.url, /\.zip($|\?)/i, `${row.id} is sourced from a zip`)
  }
})

test('rule 1: a source without an immutable commit ships the original alongside it', async () => {
  // CTAN has no VCS behind it, so the hash alone is not enough to reproduce the build.
  assert.equal(pinnedToCommit('https://mirrors.ctan.org/fonts/cyklop/cyklop-regular.otf'), false)
  assert.equal(
    pinnedToCommit(
      'https://raw.githubusercontent.com/google/fonts/5bf2c8330ab94bf00b354e40e5675f11ac819d4a/x.ttf',
    ),
    true,
  )
  // GitLab, Codeberg and sourcehut spell a raw URL differently; the commit is the point.
  assert.equal(
    pinnedToCommit(
      'https://gitlab.com/velvetyne/backout/-/raw/4f894ca0bf7d46e12a1e818d24a1234660e5848b/a.ttf',
    ),
    true,
  )
  assert.equal(pinnedToCommit('https://gitlab.com/velvetyne/backout/-/raw/main/a.ttf'), false)

  const committed = await readdir(url('fonts/upstream'))
  for (const row of sources) {
    // A queued row has no hash yet, so there is nothing on disk to compare it against.
    if (row.sha256 === '') continue
    const { original } = upstreamPaths(row)
    if (pinnedToCommit(row.url)) {
      assert.ok(!committed.includes(original), `${row.id}: pinned to a commit, so it needs no committed copy`)
      continue
    }
    assert.ok(committed.includes(original), `fonts/upstream/${original} is missing`)
    const bytes = await readFile(url(`fonts/upstream/${original}`))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256, `${row.id}: committed copy`)
  }
})

test('the source rows carry only the keys §5.5 defines', () => {
  // The schema is shared with every other batch, so anything the pipeline needs beyond it
  // is found by id under fonts/upstream instead of being bolted onto the row.
  const allowed = new Set([
    'id',
    'family',
    'url',
    'sha256',
    'licenseId',
    'licenseUrl',
    'copyright',
    'archetype',
    'traits',
    'odds',
    'stops',
    'features',
    'cases',
  ])
  for (const row of sources) {
    for (const key of Object.keys(row)) assert.ok(allowed.has(key), `${row.id}: unknown key "${key}"`)
  }
})

// ---------------------------------------------------------------- rule 2: the 22 letters

test('rule 2: every shipped file maps the 22 letters, a space and a distinct Ł/ł', async () => {
  for (const meta of metas) {
    for (const file of meta.files) {
      const sfnt = decode(await readFile(url(`fonts/files/${meta.id}.${file.id}.woff2`)))
      const face = new hb.Face(new hb.Blob(sfnt))
      const font = new hb.Font(face)
      assert.equal(checkCoverage(meta.id, { face, font }), 23, `${meta.id}.${file.id}: not 23 code points`)
      assert.equal(file.glyphs, 23)
    }
  }
})

test('rule 2: the coverage gate fails on each way a font can be unusable', () => {
  const plain = stub()
  assert.equal(checkCoverage('ok', plain), 23)

  const missing = stub({ nominalGlyph: (cp) => (cp === 0x141 ? undefined : 1) })
  assert.throws(() => checkCoverage('missing', missing), /no glyph for "Ł"/)

  // Lombard ships an empty Ł, which the `latin-ext` label happily calls covered.
  const hollow = stub()
  const hollowGid = hollow.gids.get(0x141)
  assert.throws(
    () =>
      checkCoverage('hollow', {
        ...hollow,
        font: {
          ...hollow.font,
          glyphExtents: (g) =>
            g === hollowGid ? { xBearing: 0, yBearing: 0, width: 0, height: 0 } : { width: 5, height: -5 },
        },
      }),
    /"Ł" maps to a glyph with no ink/,
  )

  const sameAsL = stub({ nominalGlyph: (cp) => (cp === 0x141 || cp === 0x4c ? 9 : 1) })
  assert.throws(() => checkCoverage('same', sameAsL), /Ł is the same glyph as L/)

  const noSpace = stub({ glyphHAdvance: (g) => (g === stub().gids.get(0x20) ? 0 : 500) })
  assert.throws(() => checkCoverage('space', noSpace), /space glyph has no advance/)
})

// ---------------------------------------------------------------- rule 3: the licence gate

test('rule 3: a Reserved Font Name is rejected, and the OFL body is not a false positive', () => {
  const ofl = [
    'Copyright 2018 The Fraunces Project Authors (github.com/undercasetype/Fraunces)',
    '',
    'This Font Software is licensed under the SIL Open Font License, Version 1.1.',
    '',
    '-----------------------------------------------------------',
    'SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007',
    '-----------------------------------------------------------',
    '"Reserved Font Name" refers to any names specified as such after the',
    'copyright statement(s). No Modified Version of the Font Software may use',
    'the Reserved Font Name(s) unless explicit written permission is granted.',
  ].join('\n')
  assert.equal(declaresReservedFontName(ofl, 'Copyright 2018 The Fraunces Project Authors'), false)

  const reserved = ofl.replace('Authors (github', 'Authors, with Reserved Font Name "Fraunces" (github')
  assert.equal(declaresReservedFontName(reserved, ''), true)
  // Some binaries declare it only in name ID 0, where the licence file forgot to.
  assert.equal(declaresReservedFontName(ofl, 'Copyright 2010, with Reserved Font Name Lobster'), true)
})

test('rule 3: licenseId is one of the three allowed, and every shipped font ships a licence', async () => {
  assert.deepEqual([...LICENSE_IDS].sort(), ['Apache-2.0', 'GUST', 'OFL-1.1'])
  assert.throws(() => validateRow({ ...seedRow, licenseId: 'MIT' }), /licenseId MIT is not allowed/)
  for (const meta of metas) {
    assert.ok(LICENSE_IDS.has(meta.licenseId), `${meta.id}: ${meta.licenseId}`)
    const text = await readFile(url(`fonts/licenses/${meta.id}.txt`), 'utf8')
    assert.ok(text.length > 0, `${meta.id}: the licence file is empty`)
    assert.match(text, /Copyright/, `${meta.id}: the licence file has no copyright statement`)
    assert.equal(declaresReservedFontName(text, meta.copyright), false, `${meta.id}: shipped with an RFN`)
  }
})

// ---------------------------------------------------------------- rule 4: variants

test('rule 4: a feature that does not change the two words is dropped', async () => {
  // Bungee has ss01 through ss12; only some of them touch our letters at all.
  const sfnt = decode(await readFile(url('fonts/files/bungee.static.woff2')))
  const font = new hb.Font(new hb.Face(new hb.Blob(sfnt)))
  assert.deepEqual(effectiveFeatures(font, 'none', ['ss01']), ['ss01'])
  assert.deepEqual(effectiveFeatures(font, 'none', ['ss03', 'ss06', 'ss07']), [])
})

test('rule 4: a case-like feature is kept only when it changes every letter, Ł included', async () => {
  // Cyklop's small caps reach every lowercase letter, so they only qualify in lowercase:
  // in "Tomasz" the T is already a capital and stays put.
  const font = new hb.Font(new hb.Face(new hb.Blob(await readFile(url('fonts/upstream/cyklop.otf')))))
  assert.deepEqual(effectiveFeatures(font, 'lowercase', ['smcp']), ['smcp'])
  assert.deepEqual(effectiveFeatures(font, 'none', ['smcp']), [])
})

test('rule 4: at most twelve variants, and the plan degrades one feature at a time', () => {
  const plan = planVariants({
    cases: ['none', 'uppercase', 'lowercase'],
    featuresByCase: { none: ['ss01', 'ss02'], uppercase: ['ss01', 'ss02'], lowercase: ['ss01', 'ss02'] },
    stops: [{ wght: 400 }, { wght: 900 }],
  })
  assert.equal(plan.length, MAX_VARIANTS)
  assert.equal(plan.filter((v) => v.feats.length === 0).length, 6, 'every case keeps its plain variant')
  assert.ok(plan.every((v) => v.feats.length <= 1))

  for (const meta of metas) {
    assert.ok(meta.variants.length <= MAX_VARIANTS, `${meta.id} has ${meta.variants.length} variants`)
    assert.equal(
      new Set(meta.variants.map((v) => v.id)).size,
      meta.variants.length,
      `${meta.id}: duplicate ids`,
    )
    for (const v of meta.variants) assert.ok(v.case in WORDS, `${meta.id}: unknown case ${v.case}`)
  }
})

test('rule 4: capsOnly and unicase collapse the case axis, connected drops uppercase', () => {
  for (const meta of metas) {
    const cases = new Set(meta.variants.map((v) => v.case))
    if (meta.traits.includes('capsOnly') || meta.traits.includes('unicase')) {
      assert.deepEqual([...cases], ['none'], `${meta.id}: a caps-only or unicase face keeps one case`)
    }
    if (meta.traits.includes('connected')) {
      assert.ok(!cases.has('uppercase'), `${meta.id}: a connected script must not get uppercase`)
    }
  }
  // The seed set covers all three: Bungee is caps-only, Syncopate unicase, Pacifico connected.
  const traits = new Set(metas.flatMap((m) => m.traits))
  for (const t of ['capsOnly', 'unicase', 'connected']) assert.ok(traits.has(t), `no seed font measured ${t}`)
})

// ---------------------------------------------------------------- rule 5: pinned static instances

test('rule 5: nothing variable survives, and STAT and MVAR are dropped', async () => {
  for (const meta of metas) {
    for (const file of meta.files) {
      const { tables } = parse(decode(await readFile(url(`fonts/files/${meta.id}.${file.id}.woff2`))))
      const tags = tables.map((t) => t.tag)
      for (const gone of ['fvar', 'gvar', 'cvar', 'avar', 'HVAR', 'STAT', 'MVAR']) {
        assert.ok(!tags.includes(gone), `${meta.id}.${file.id} still carries ${gone}`)
      }
      // Hinting is off, so the bytecode tables must be gone too.
      for (const gone of ['fpgm', 'prep', 'cvt ']) {
        assert.ok(!tags.includes(gone), `${meta.id}.${file.id} still carries ${gone}`)
      }
    }
  }
})

test('rule 5: every glyf glyph carries an overlap flag', async () => {
  let glyfFiles = 0
  for (const meta of metas) {
    for (const file of meta.files) {
      const { tables } = parse(decode(await readFile(url(`fonts/files/${meta.id}.${file.id}.woff2`))))
      const { glyphs, flagged } = hasOverlapFlags(tables)
      if (glyphs === 0) continue // a CFF font has no glyf and needs no flag
      glyfFiles++
      assert.equal(
        flagged,
        glyphs,
        `${meta.id}.${file.id}: ${glyphs - flagged} glyphs without an overlap flag`,
      )
    }
  }
  assert.ok(glyfFiles > 0, 'no glyf-based font in the seed set')
})

test('rule 5: the written metrics are the ones the metadata promises', async () => {
  for (const meta of metas) {
    for (const file of meta.files) {
      const { tables } = parse(decode(await readFile(url(`fonts/files/${meta.id}.${file.id}.woff2`))))
      const m = readMetrics(tables)
      const where = `${meta.id}.${file.id}`
      assert.equal(m.ascender, file.asc, `${where}: hhea.ascender`)
      assert.equal(m.descender, file.desc === 0 ? 0 : -file.desc, `${where}: hhea.descender`)
      assert.equal(m.lineGap, 0, `${where}: hhea.lineGap`)
      assert.equal(m.sTypoAscender, file.asc, `${where}: sTypoAscender`)
      assert.equal(m.sTypoDescender, file.desc === 0 ? 0 : -file.desc, `${where}: sTypoDescender`)
      assert.equal(m.sTypoLineGap, 0, `${where}: sTypoLineGap`)
      assert.equal(m.usWinAscent, file.asc, `${where}: usWinAscent`)
      assert.equal(m.usWinDescent, file.desc, `${where}: usWinDescent`)
    }
  }
})

test('§5.2: the metadata records the em grid its metrics are on', async () => {
  // The fit maths converts asc/desc back to em, so `upm` is part of the contract rather
  // than something the renderer may assume. It belongs to the face: pinning cannot move it.
  for (const meta of metas) {
    assert.ok(Number.isInteger(meta.upm) && meta.upm > 0, `${meta.id}: upm must be a positive integer`)
    for (const file of meta.files) {
      const { tables } = parse(decode(await readFile(url(`fonts/files/${meta.id}.${file.id}.woff2`))))
      assert.equal(unitsPerEm(tables), meta.upm, `${meta.id}.${file.id}: head.unitsPerEm is not meta.upm`)
      assert.ok(!('upem' in file), `${meta.id}.${file.id}: upm is recorded once, at the top level`)
    }
  }
  // More than one em grid must be in play, so a hard-coded 1000 cannot pass. The exact set
  // is not pinned: which grids appear depends on which batches have shipped, and the
  // contract asks only for a positive integer equal to head.unitsPerEm.
  const grids = [...new Set(metas.map((m) => m.upm))]
  assert.ok(
    grids.every((g) => Number.isInteger(g) && g > 0),
    `upm must be a positive integer: ${grids}`,
  )
  assert.ok(grids.length > 1, `expected more than one em grid across the library, got ${grids}`)
})

test('rule 5: the metrics keep every emitted line-height positive', () => {
  // The renderer emits L = 2·top − ASC + DESC per line (PLAN §5.2). If that can go to zero
  // or below, a line collapses and the effect copies stop lining up with the real text.
  for (const meta of metas) {
    for (const variant of meta.variants) {
      const file = meta.files.find((f) => f.id === variant.file)
      const asc = file.asc / meta.upm
      const desc = file.desc / meta.upm
      for (const word of [variant.w1, variant.w2]) {
        const lineHeight = 2 * word.top - asc + desc
        assert.ok(lineHeight > 0, `${meta.id}/${variant.id}: line-height ${lineHeight} is not positive`)
      }
    }
  }
})

test('rule 5: the metrics derivation refuses what it cannot write', () => {
  const { asc, desc } = deriveMetrics({ upm: 1000, tops: [700, 400], depths: [200] })
  assert.equal(asc, 700)
  assert.equal(desc, 200, 'the ink depth wins when it is the largest of the three terms')
  // asc − 2·min(top) + 0.05·upm takes over when one word sits much lower than the other.
  assert.equal(deriveMetrics({ upm: 1000, tops: [700, 100], depths: [0] }).desc, 550)
  assert.throws(() => deriveMetrics({ upm: 1000, tops: [], depths: [] }), /no ink measurements/)
  assert.throws(() => deriveMetrics({ upm: 1000, tops: [40_000], depths: [0] }), /do not fit in int16/)

  const short = [
    { tag: 'hhea', data: Buffer.alloc(36) },
    { tag: 'OS/2', data: Buffer.alloc(68) },
  ]
  assert.throws(() => normalizeMetrics(short, { asc: 700, desc: 200 }), /OS\/2 table is 68 bytes, need >= 78/)
  assert.throws(
    () => normalizeMetrics([{ tag: 'hhea', data: Buffer.alloc(36) }], { asc: 1, desc: 1 }),
    /OS\/2/,
  )
})

// ---------------------------------------------------------------- rule 7: the budget

test('rule 7: no file is over 10,500 bytes', async () => {
  assert.equal(BUDGET_BYTES, 10_500)
  assert.equal(checkBudget('ok', BUDGET_BYTES), BUDGET_BYTES)
  assert.throws(() => checkBudget('fat', BUDGET_BYTES + 1), /10501 B is over the 10500 B budget/)

  for (const meta of metas) {
    for (const file of meta.files) {
      const bytes = (await readFile(url(`fonts/files/${meta.id}.${file.id}.woff2`))).length
      assert.equal(bytes, file.bytes, `${meta.id}.${file.id}: the metadata byte count is stale`)
      assert.ok(bytes <= BUDGET_BYTES, `${meta.id}.${file.id} is ${bytes} B`)
    }
  }
})

// ---------------------------------------------------------------- rule 8: licence files

test('rule 8: every licence file starts with the change notice for its font', async () => {
  assert.equal(
    changeNotice('Bungee', 'Version 2.000', 'https://example.invalid/Bungee.ttf'),
    'Modified by luzid.co: 23-glyph subset of Bungee Version 2.000; hinting removed; ' +
      'vertical metrics changed. Original: https://example.invalid/Bungee.ttf',
  )
  for (const meta of metas) {
    const text = await readFile(url(`fonts/licenses/${meta.id}.txt`), 'utf8')
    assert.ok(
      text.startsWith(`Modified by luzid.co: 23-glyph subset of ${meta.family} Version `),
      `${meta.id}: the licence file does not open with the change notice`,
    )
    assert.ok(
      text.includes(`Original: ${meta.src.url}`),
      `${meta.id}: the notice does not point at the source`,
    )
  }
})

// ---------------------------------------------------------------- the source rows and metadata

test('source rows validate, with disjoint ids', () => {
  const seen = new Set()
  for (const row of sources) validateRow(row, seen)
  assert.equal(seen.size, sources.length)
  assert.throws(() => validateRow(seedRow, seen), /duplicate id/)

  const base = seedRow
  assert.throws(() => validateRow({ ...base, id: 'Not Kebab' }), /kebab-case/)
  assert.throws(() => validateRow({ ...base, odds: 17 }), /odds must be an integer 0-16/)
  assert.throws(() => validateRow({ ...base, archetype: ['Z'] }), /unknown archetype Z/)
  assert.throws(() => validateRow({ ...base, traits: ['wobbly'] }), /unknown trait wobbly/)
  assert.throws(() => validateRow({ ...base, sha256: 'cafe' }), /64 lowercase hex/)
  assert.throws(
    () => validateRow({ ...base, stops: Array.from({ length: MAX_STOPS + 1 }, () => ({})) }),
    /at most 4 stops/,
  )
  // A measured trait is legal in a row: the batch files are read by people, and the check
  // is against the outlines, not against the schema.
  for (const trait of MEASURED_TRAITS) {
    assert.doesNotThrow(() => validateRow({ ...base, traits: [trait] }), `${trait} must be declarable`)
  }
})

// ---------------------------------------------------------------- declared vs measured traits

const measurement = (overrides = {}) => ({
  capsOnly: false,
  unicase: false,
  connected: false,
  hairline: false,
  overlap: false,
  ...overrides,
})

test('a row that agrees with the outlines passes, and the measurement fills in the rest', () => {
  const measured = measurement({ connected: true, overlap: true })
  assert.deepEqual(reconcileTraits('agrees', ['script', 'connected'], measured), [
    'connected',
    'overlap',
    'script',
  ])
  // Declaring nothing measured is fine; the pipeline supplies all five.
  assert.deepEqual(reconcileTraits('silent', ['script'], measured), ['connected', 'overlap', 'script'])
  assert.deepEqual(traitDisagreements(['script', 'connected'], measured), [])
})

test('a row that disagrees with the outlines is a hard failure naming the trait', () => {
  const bicameral = measurement({ overlap: true })
  assert.throws(
    () => reconcileTraits('cinzel', ['serif', 'unicase'], bicameral),
    /cinzel: the source row declares unicase, the outlines measure it false \(measured: overlap\)/,
  )
  assert.throws(
    () => reconcileTraits('rancho', ['script', 'connected'], measurement()),
    /rancho: the source row declares connected, the outlines measure it false \(measured: none of the five\)/,
  )
  // Every one of the five is checked, and all of them are named at once.
  for (const trait of MEASURED_TRAITS) {
    assert.deepEqual(traitDisagreements([trait], measurement()), [trait])
  }
  assert.deepEqual(traitDisagreements(['hairline', 'overlap'], measurement()), ['hairline', 'overlap'])
  assert.throws(
    () => reconcileTraits('both', ['hairline', 'overlap'], measurement()),
    /declares hairline, overlap, the outlines measure them false/,
  )
})

test('capsOnly and unicase are one measurement, so either label satisfies either finding', () => {
  // Extents cannot split them: Vina Sans is caps-only with three redrawn lowercase letters,
  // Syncopate is unicase with seven identical ones. Both collapse the case axis, which is
  // the only thing the pipeline does with the answer.
  for (const declared of ['capsOnly', 'unicase']) {
    for (const found of ['capsOnly', 'unicase']) {
      assert.deepEqual(
        traitDisagreements([declared], measurement({ [found]: true })),
        [],
        `declaring ${declared} against a measured ${found} must be accepted`,
      )
      // The row's own word for it is what the metadata keeps.
      assert.deepEqual(reconcileTraits('case', [declared], measurement({ [found]: true })), [declared])
    }
  }
  // It is still a failure when the face is plainly bicameral.
  assert.deepEqual(traitDisagreements(['capsOnly'], measurement()), ['capsOnly'])
})

test('every shipped font agrees with its own source row', () => {
  // The metadata is the merge, so anything the row declared has to survive into it.
  for (const meta of metas) {
    const row = sources.find((r) => r.id === meta.id)
    assert.ok(row, `${meta.id} has no source row`)
    for (const trait of row.traits) {
      assert.ok(meta.traits.includes(trait), `${meta.id}: declared ${trait} is missing from the metadata`)
    }
    for (const trait of meta.traits) assert.ok(TRAITS.has(trait), `${meta.id}: unknown trait ${trait}`)
  }
})

test('the metadata describes exactly what is on disk', async () => {
  const files = new Set((await readdir(url('fonts/files'))).filter((f) => f.endsWith('.woff2')))
  const licenses = new Set((await readdir(url('fonts/licenses'))).filter((f) => f.endsWith('.txt')))
  // Not every row ships: a batch agent drops a font whose licence reserves its name, whose
  // Ł does not read, or that does not belong to its archetype. The invariant is the other
  // direction — nothing on disk may lack a row.
  assert.ok(metas.length <= sources.length, `${metas.length} metas from ${sources.length} rows`)

  for (const meta of metas) {
    const row = sources.find((r) => r.id === meta.id)
    assert.ok(row, `${meta.id} has no source row`)
    assert.equal(meta.src.url, row.url)
    assert.equal(meta.src.sha256, row.sha256, `${meta.id}: the recorded source hash drifted`)
    for (const a of meta.archetype) assert.ok(ARCHETYPES.has(a))
    for (const t of meta.traits) assert.ok(TRAITS.has(t), `${meta.id}: unknown trait ${t}`)
    assert.ok(meta.files.length > 0 && meta.files.length <= MAX_STOPS)
    assert.ok(licenses.delete(`${meta.id}.txt`), `${meta.id}: no licence file`)

    for (const file of meta.files) {
      const name = `${meta.id}.${file.id}.woff2`
      assert.ok(files.delete(name), `${name} is missing`)
      const bytes = await readFile(url(`fonts/files/${name}`))
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `${name}: stale hash`)
    }
    for (const variant of meta.variants) {
      assert.ok(
        meta.files.some((f) => f.id === variant.file),
        `${meta.id}/${variant.id} points at a file that is not shipped`,
      )
      for (const word of [variant.w1, variant.w2]) {
        assert.ok(word.W > 0 && word.H > 0, `${meta.id}/${variant.id}: a word has no ink`)
        assert.ok(word.top > 0, `${meta.id}/${variant.id}: ink top must be above the baseline`)
      }
    }
    const used = new Set(meta.variants.map((v) => v.file))
    for (const file of meta.files) assert.ok(used.has(file.id), `${meta.id}.${file.id} has no variant`)
  }
  assert.deepEqual([...files], [], 'fonts/files has entries no metadata claims')
  assert.deepEqual([...licenses], [], 'fonts/licenses has entries no metadata claims')
})

test('the eight seed fonts cover the eight risky branches', () => {
  const byId = Object.fromEntries(metas.map((m) => [m.id, m]))
  // The seed set is what proves each branch of the pipeline; it is not the whole catalogue.
  // Wave-2 batches add to it, so assert the eight are PRESENT rather than alone.
  const ids = ['fraunces', 'boldonse', 'pacifico', 'cyklop', 'syncopate', 'coconat', 'bungee', 'unbounded']
  for (const id of ids) assert.ok(byId[id], `the ${id} seed font is missing from the catalogue`)

  assert.equal(byId.fraunces.files.length, 2, 'Fraunces ships static stops of a four-axis source')
  assert.deepEqual(Object.keys(byId.fraunces.files[0].axes).sort(), ['SOFT', 'WONK', 'opsz', 'wght'])
  assert.equal(byId.cyklop.licenseId, 'GUST')
  assert.equal(byId.syncopate.licenseId, 'Apache-2.0')
  assert.ok(byId.syncopate.traits.includes('unicase'))
  assert.ok(byId.bungee.traits.includes('capsOnly'))
  assert.ok(byId.pacifico.traits.includes('connected'))
  assert.ok(byId.unbounded.traits.includes('overlap'), 'a pinned variable font has overlapping contours')
  assert.equal(byId.coconat.files.length, 1)
  for (const id of ['boldonse', 'bungee', 'cyklop', 'pacifico']) {
    assert.ok(
      byId[id].variants.some((v) => v.css.feat !== 'normal'),
      `${id} was chosen for its alternates and must ship at least one`,
    )
  }
})

test('the shaped letters are the 22 the site draws, plus a space', () => {
  assert.equal([...TEXT].length, 23)
  assert.equal(LETTERS.length, 22)
  assert.deepEqual(WORDS.none, ['Tomasz', 'Cudziło'])
  // Both words, in every case, are drawn entirely from the 23 code points that ship.
  const used = new Set(Object.values(WORDS).flat().join(''))
  for (const ch of used) assert.ok(TEXT.includes(ch), `"${ch}" is shaped but never subset in`)
  assert.equal(new Set([...TEXT]).size, 23)
})
