/**
 * Regenerates the committed palette data: runs every adapter in `scripts/palette-sources/`,
 * assigns roles with `roles.mjs`, and writes `data/palettes/<source>.json`.
 *
 *   node scripts/palettes.mjs [--source <id>] [--check]
 *
 * `--check` writes nothing and fails if a file on disk differs from what this run produces,
 * which is what `test/palettes.test.js` and CI rely on. The roles are committed inside each
 * row on purpose (PLAN §5.4): a deploy never runs colour maths.
 *
 * Row shape:
 *
 *   {id, src, tier, odds, names[], namesJa[]?, hex[], roles[]}
 *
 * `hex` holds the palette's own colours first, `names` names them one for one. A row whose
 * combination has no pair reaching 3:1 gets both derived grounds appended after them, always
 * in this order, so the four-character `o` of a role set resolves without any colour maths:
 *
 *   digit → hex[digit]      w → hex[names.length]      k → hex[names.length + 1]
 *   o[2] === '-' → --a1 is var(--fg)   ·   o[3] === '-' → --a2 is var(--bg)
 *
 * An adapter is a module exporting `{id, tier, build()}`; `build()` returns rows of
 * `{id, names, namesJa?, hex}` and does its own count assertions. Adding a source is adding
 * a file — this driver needs no edit.
 */
import { glob, mkdir, readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { grounds, roleSets } from './roles.mjs'

const ROOT = new URL('../', import.meta.url)
const SOURCES = new URL('palette-sources/', import.meta.url)

const { values } = parseArgs({
  options: { source: { type: 'string' }, check: { type: 'boolean', default: false } },
})

const files = (await Array.fromAsync(glob('*.mjs', { cwd: SOURCES }))).sort()
let failed = false

for (const file of files) {
  const source = await import(new URL(file, SOURCES).href)
  const { id, tier, build } = source.default ?? source
  if (values.source && id !== values.source) continue

  const rows = (await build()).map((row) => {
    const roles = roleSets(row.hex)
    if (roles.length === 0) throw new Error(`${row.id}: no role set — roles.mjs must always emit one`)
    const hex = roles.some((r) => r.derivedBg) ? [...row.hex, ...grounds(row.hex)] : row.hex
    return {
      id: row.id,
      src: id,
      tier,
      odds: row.odds ?? 4,
      names: row.names,
      ...(row.namesJa ? { namesJa: row.namesJa } : {}),
      hex,
      roles,
    }
  })

  // One row per line: a diff then shows exactly which combinations moved.
  const json = `[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`
  const out = new URL(`data/palettes/${id}.json`, ROOT)

  const sets = rows.flatMap((r) => r.roles)
  const derived = sets.filter((r) => r.derivedBg)
  const combos = rows.filter((r) => r.roles.some((s) => s.derivedBg)).length
  console.log(
    `${id}: ${rows.length} combos → ${sets.length} role sets, ` +
      `${derived.length} on a derived ground (${combos} combos, ` +
      `${derived.filter((r) => r.derivedBg === 'w').length} washi / ` +
      `${derived.filter((r) => r.derivedBg === 'k').length} sumi), ` +
      `${sets.filter((r) => r.dark).length} dark · ${json.length} B`,
  )

  if (values.check) {
    const have = await readFile(out, 'utf8').catch(() => '')
    if (have !== json) {
      console.error(`${id}: data/palettes/${id}.json is stale — run \`pnpm run palettes\``)
      failed = true
    }
  } else {
    await mkdir(new URL('data/palettes/', ROOT), { recursive: true })
    await writeFile(out, json)
  }
}

if (failed) process.exitCode = 1
