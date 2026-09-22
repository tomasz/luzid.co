/**
 * Sanzo Wada volume 1 — *A Dictionary of Color Combinations* (Seigensha 2010, reprinting
 * 配色總鑑, 博美社 1933–34). 159 colours, 348 combinations: 120 duos, 120 trios, 108 quads.
 *
 * Source: `data/sources/wada1/colors.json`, a byte-for-byte copy of mattdesl's MIT dataset
 * pinned at commit c142bd0. `data/sources/wada1/README.md` has the provenance and the
 * re-vendor command; `errata.json` next to it is our own reviewed patch.
 *
 * Never swap this for `dblodorn/sanzo-wada` or any of its copies: that data has 157 colours,
 * one-colour and five-colour combinations, and a naive CMYK→RGB conversion.
 *
 * The upstream file is colour-centric (each colour lists the combinations it appears in), so
 * the combinations are derived by inverting that. Within a combination the colours keep book
 * order, which is hue-chapter order; role assignment reorders them later.
 */
import { readFile } from 'node:fs/promises'

const DATA = new URL('../../data/sources/wada1/', import.meta.url)

export const id = 'wada1'
export const tier = 'historical'

/** The 159 colours, errata applied, in book order. */
export async function colors() {
  const upstream = JSON.parse(await readFile(new URL('colors.json', DATA), 'utf8'))
  const errata = JSON.parse(await readFile(new URL('errata.json', DATA), 'utf8'))
  expect(upstream.length === 159, `upstream has ${upstream.length} colours, expected 159`)

  const rows = upstream.map((c) => ({ ...c, cmyk: [...c.cmyk], name: errata.names[c.name] ?? c.name }))
  for (const fix of errata.cmyk) {
    const row = upstream[fix.index]
    expect(row?.name === fix.name, `errata index ${fix.index} is "${row?.name}", expected "${fix.name}"`)
    expect(
      String(row.cmyk) === String(fix.from),
      `errata for ${fix.name} expects CMYK ${fix.from}, upstream now has ${row.cmyk}`,
    )
    expect(row.hex === fix.keepHex, `errata for ${fix.name} expects hex ${fix.keepHex}, got ${row.hex}`)
    // The hex deliberately stays as published: recomputing it needs the SWOP v2 → sRGB ICC
    // transform, whose profile is not redistributable. See errata.json → hexPolicy.
    rows[fix.index].cmyk = [...fix.to]
  }

  for (const c of rows) {
    expect(/^#[0-9a-f]{6}$/.test(c.hex), `bad hex ${c.hex} on ${c.name}`)
    expect(
      c.cmyk.length === 4 && c.cmyk.every((v) => Number.isInteger(v) && v >= 0 && v <= 100),
      `bad CMYK ${c.cmyk} on ${c.name}`,
    )
  }
  expect(new Set(rows.map((c) => c.name)).size === 159, 'duplicate colour name after errata')
  return rows
}

/** The 348 combinations as palette rows: `{id, names, hex}`, ready for role assignment. */
export async function build() {
  const cs = await colors()
  const combos = new Map()
  cs.forEach((c, i) => {
    for (const n of c.combinations) {
      if (!combos.has(n)) combos.set(n, [])
      combos.get(n).push(i)
    }
  })

  const ids = [...combos.keys()].sort((a, b) => a - b)
  expect(ids.length === 348, `${ids.length} combinations, expected 348`)
  expect(ids[0] === 1 && ids.at(-1) === 348, `combination ids run ${ids[0]}–${ids.at(-1)}, expected 1–348`)

  const rows = ids.map((n) => {
    const members = combos.get(n)
    expect(members.length >= 2 && members.length <= 4, `combination ${n} has ${members.length} colours`)
    return {
      id: `${id}-${String(n).padStart(3, '0')}`,
      names: members.map((i) => cs[i].name),
      hex: members.map((i) => cs[i].hex),
    }
  })

  const sizes = {}
  for (const r of rows) sizes[r.hex.length] = (sizes[r.hex.length] ?? 0) + 1
  expect(
    sizes[2] === 120 && sizes[3] === 120 && sizes[4] === 108,
    `combination sizes are ${JSON.stringify(sizes)}, expected 120 duos / 120 trios / 108 quads`,
  )
  return rows
}

function expect(ok, message) {
  if (!ok) throw new Error(`wada1: ${message}`)
}

export default { id, tier, build }
