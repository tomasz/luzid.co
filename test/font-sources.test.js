import assert from 'node:assert/strict'
import { glob, readFile } from 'node:fs/promises'
import { test } from 'node:test'

// §5.5 source-row schema. These files are hand-written data consumed by the Wave-2 batch
// agents and then by `scripts/fonts.mjs`; a bad row there stalls an agent or fails a build
// long after the mistake was made, so everything checkable is checked here.

const SOURCES = 'fonts/sources'
const ARCHETYPE_BATCHES = ['a', 'b', 'c', 'd', 'e', 'f']
const MIN_ROWS_PER_ARCHETYPE = 20

/** The closed trait enum (§5.5). Adding one is a `contract` PR, not a data PR. */
const TRAITS = new Set([
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

const LICENSES = new Set(['OFL-1.1', 'Apache-2.0', 'GUST'])
const ARCHETYPES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'X'])
const CASES = new Set(['none', 'uppercase', 'lowercase'])

/** Ids owned by WP-11's seed batch; they must not be duplicated into a Wave-2 batch. */
const WP11_IDS = new Set([
  'fraunces',
  'boldonse',
  'pacifico',
  'cyklop',
  'syncopate',
  'coconat',
  'bungee',
  'unbounded',
])

const KEYS = new Set([
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

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8')

async function loadBatches() {
  const batches = new Map()
  for await (const file of glob(`${SOURCES}/*.json`)) {
    const name = file
      .split('/')
      .pop()
      .replace(/\.json$/, '')
    batches.set(name, JSON.parse(await read(file)))
  }
  return batches
}

const batches = await loadBatches()

test('every batch file is a non-empty array of objects', () => {
  assert.ok(batches.size > 0, `no batch files found under ${SOURCES}/`)
  for (const [name, rows] of batches) {
    assert.ok(Array.isArray(rows), `${name}.json must be an array`)
    assert.ok(rows.length > 0, `${name}.json is empty`)
    for (const row of rows) {
      assert.equal(typeof row, 'object', `${name}.json has a non-object row`)
      assert.ok(row !== null && !Array.isArray(row), `${name}.json has a non-object row`)
    }
  }
})

test('every row matches the §5.5 source-row schema', () => {
  for (const [name, rows] of batches) {
    for (const row of rows) {
      const where = `${name}.json/${row.id ?? '<no id>'}`

      for (const key of Object.keys(row)) {
        assert.ok(KEYS.has(key), `${where}: unknown key "${key}"`)
      }
      for (const key of ['id', 'family', 'url', 'licenseId', 'licenseUrl', 'copyright']) {
        assert.equal(typeof row[key], 'string', `${where}: ${key} must be a string`)
        assert.ok(row[key].length > 0, `${where}: ${key} must not be empty`)
      }

      assert.match(row.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${where}: id must be kebab-case`)

      // sha256 is filled by the pipeline on first run, but the key must exist and be
      // either empty or a real digest — never a placeholder.
      assert.equal(typeof row.sha256, 'string', `${where}: sha256 must be a string`)
      assert.ok(row.sha256 === '' || /^[0-9a-f]{64}$/.test(row.sha256), `${where}: bad sha256`)

      assert.ok(LICENSES.has(row.licenseId), `${where}: licenseId "${row.licenseId}" not allowed`)

      assert.ok(Array.isArray(row.archetype) && row.archetype.length > 0, `${where}: archetype`)
      for (const a of row.archetype) {
        assert.ok(ARCHETYPES.has(a), `${where}: unknown archetype "${a}"`)
      }

      assert.ok(Array.isArray(row.traits) && row.traits.length > 0, `${where}: traits`)
      for (const t of row.traits) {
        assert.ok(TRAITS.has(t), `${where}: "${t}" is not in the trait enum`)
      }
      assert.equal(new Set(row.traits).size, row.traits.length, `${where}: duplicate traits`)

      assert.ok(Number.isInteger(row.odds), `${where}: odds must be an integer`)
      assert.ok(row.odds >= 0 && row.odds <= 16, `${where}: odds ${row.odds} outside 0-16`)

      if ('stops' in row) {
        assert.ok(Array.isArray(row.stops), `${where}: stops must be an array`)
        assert.ok(
          row.stops.length >= 1 && row.stops.length <= 4,
          `${where}: 1-4 stops, got ${row.stops.length}`,
        )
        const ids = new Set()
        for (const stop of row.stops) {
          assert.equal(typeof stop, 'object', `${where}: stop must be an object`)
          assert.equal(typeof stop.id, 'string', `${where}: stop needs a string id`)
          assert.match(stop.id, /^[a-z0-9-]+$/, `${where}: stop id "${stop.id}" must be kebab-case`)
          assert.ok(!ids.has(stop.id), `${where}: duplicate stop id "${stop.id}"`)
          ids.add(stop.id)
          const axes = Object.keys(stop).filter((k) => k !== 'id')
          assert.ok(axes.length > 0, `${where}: stop "${stop.id}" pins no axis`)
          for (const axis of axes) {
            assert.match(axis, /^[A-Za-z]{4}$/, `${where}: "${axis}" is not a 4-letter axis tag`)
            assert.equal(typeof stop[axis], 'number', `${where}: ${axis} must be a number`)
            assert.ok(Number.isFinite(stop[axis]), `${where}: ${axis} must be finite`)
          }
        }
        // Every stop must pin the same axis set, or the pipeline cannot instance them.
        const first = Object.keys(row.stops[0])
          .filter((k) => k !== 'id')
          .sort()
          .join(',')
        for (const stop of row.stops) {
          const got = Object.keys(stop)
            .filter((k) => k !== 'id')
            .sort()
            .join(',')
          assert.equal(got, first, `${where}: stop "${stop.id}" pins [${got}], expected [${first}]`)
        }
      }

      if ('features' in row) {
        assert.ok(Array.isArray(row.features) && row.features.length > 0, `${where}: features`)
        for (const f of row.features) {
          assert.match(f, /^[a-z0-9]{4}$/, `${where}: "${f}" is not an OpenType feature tag`)
        }
        assert.equal(new Set(row.features).size, row.features.length, `${where}: duplicate features`)
      }

      if ('cases' in row) {
        assert.ok(Array.isArray(row.cases) && row.cases.length > 0, `${where}: cases`)
        for (const c of row.cases) assert.ok(CASES.has(c), `${where}: unknown case "${c}"`)
        assert.equal(new Set(row.cases).size, row.cases.length, `${where}: duplicate cases`)
      }
    }
  }
})

test('urls are raw files at an immutable commit, never a zip or the css2 API', () => {
  for (const [name, rows] of batches) {
    for (const row of rows) {
      const where = `${name}.json/${row.id}`
      for (const [key, url] of [
        ['url', row.url],
        ['licenseUrl', row.licenseUrl],
      ]) {
        assert.match(url, /^https:\/\//, `${where}: ${key} must be https`)
        // The css2 API strips ssNN/salt/swsh/dlig (google/fonts#1335).
        assert.ok(!url.includes('fonts.googleapis.com'), `${where}: ${key} uses the Google CSS API`)
        assert.ok(!url.includes('fonts.gstatic.com'), `${where}: ${key} uses the Google font CDN`)
        assert.ok(!/\.(zip|tar|tgz|gz)(\?|$)/.test(url), `${where}: ${key} points at an archive`)
      }
      assert.match(row.url, /\.(ttf|otf|ttc)$/i, `${where}: url must be a font file`)

      // A mutable ref would make the pinned sha256 meaningless.
      for (const ref of ['/main/', '/master/', '/HEAD/', '/latest/']) {
        assert.ok(!row.url.includes(ref), `${where}: url uses the mutable ref "${ref}"`)
        assert.ok(!row.licenseUrl.includes(ref), `${where}: licenseUrl uses the mutable ref "${ref}"`)
      }
      if (row.url.includes('raw.githubusercontent.com') || row.url.includes('gitlab.com')) {
        assert.match(row.url, /\/[0-9a-f]{40}\//, `${where}: url lacks a full 40-char commit sha`)
        assert.match(row.licenseUrl, /\/[0-9a-f]{40}\//, `${where}: licenseUrl lacks a full commit sha`)
      }
    }
  }
})

test('ids are unique across every batch file including the seed', async () => {
  const seen = new Map()
  const all = new Map(batches)

  // `fonts/sources/seed.json` belongs to WP-11 and may not exist yet.
  try {
    all.set('seed', JSON.parse(await read(`${SOURCES}/seed.json`)))
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }

  for (const [name, rows] of all) {
    for (const row of rows) {
      const prev = seen.get(row.id)
      assert.equal(prev, undefined, `id "${row.id}" is in both ${prev} and ${name}.json`)
      seen.set(row.id, `${name}.json`)
    }
  }
})

test('WP-11 seed ids never appear in a Wave-2 batch', () => {
  for (const [name, rows] of batches) {
    if (name === 'seed') continue
    for (const row of rows) {
      assert.ok(!WP11_IDS.has(row.id), `${name}.json claims "${row.id}", which WP-11 owns`)
    }
  }
})

test('every archetype batch carries at least 20 rows', () => {
  for (const name of ARCHETYPE_BATCHES) {
    const rows = batches.get(name)
    assert.ok(rows, `${name}.json is missing`)
    assert.ok(
      rows.length >= MIN_ROWS_PER_ARCHETYPE,
      `${name}.json has ${rows.length} rows, needs ${MIN_ROWS_PER_ARCHETYPE}`,
    )
  }
})

test('every row in an archetype batch claims that archetype', () => {
  for (const name of ARCHETYPE_BATCHES) {
    const wanted = name.toUpperCase()
    for (const row of batches.get(name)) {
      assert.ok(row.archetype.includes(wanted), `${name}.json/${row.id} does not list archetype ${wanted}`)
    }
  }
})

test('capsOnly and connected fonts declare consistent cases', () => {
  for (const [name, rows] of batches) {
    for (const row of rows) {
      const where = `${name}.json/${row.id}`
      // Case randomization is invisible on a caps-only face, so it must be collapsed.
      if (row.traits.includes('capsOnly')) {
        assert.deepEqual(row.cases, ['none'], `${where}: capsOnly must set cases ["none"]`)
      }
      // Joining scripts break apart when set in capitals.
      if (row.traits.includes('connected')) {
        assert.ok(row.cases, `${where}: a connected script must declare cases`)
        assert.ok(!row.cases.includes('uppercase'), `${where}: connected scripts get no uppercase`)
      }
    }
  }
})
