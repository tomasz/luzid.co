import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { brotliCompressSync, constants } from 'node:zlib'
import { build, parse } from '../scripts/sfnt.mjs'
import { decode, decodeTables, encode } from '../scripts/woff2.mjs'

const url = (p) => new URL(`../${p}`, import.meta.url)
const shipped = async () => (await readdir(url('fonts/files'))).filter((f) => f.endsWith('.woff2')).sort()
const read = (name) => readFile(url(`fonts/files/${name}`))

/** A minimal but structurally valid SFNT, for the cases no shipped font exercises. */
function fixture(tables) {
  return build({ flavor: 0x00010000, tables: tables.map(([tag, data]) => ({ tag, data })) })
}

test('decode(encode(x)) returns byte-identical tables', async () => {
  for (const name of await shipped()) {
    const sfnt = decode(await read(name))
    const again = decode(encode(sfnt))
    assert.ok(again.equals(sfnt), `${name}: the whole file changed across a round trip`)

    const before = parse(sfnt).tables
    const after = decodeTables(encode(sfnt)).tables
    assert.equal(after.length, before.length, `${name}: table count changed`)
    for (const table of before) {
      const match = after.find((t) => t.tag === table.tag)
      assert.ok(match, `${name}: lost the ${table.tag} table`)
      assert.ok(match.data.equals(table.data), `${name}: ${table.tag} changed across a round trip`)
    }
  }
})

test('the header is the 48 bytes the format specifies', async () => {
  for (const name of await shipped()) {
    const woff2 = await read(name)
    assert.equal(woff2.toString('latin1', 0, 4), 'wOF2', `${name}: bad signature`)
    assert.equal(woff2.readUInt32BE(8), woff2.length, `${name}: the length field disagrees with the file`)
    assert.equal(woff2.readUInt16BE(14), 0, `${name}: the reserved field must be zero`)
    assert.equal(woff2.readUInt16BE(24), 1, `${name}: majorVersion must be 1`)
    for (const [field, at] of [
      ['meta', 28],
      ['metaLength', 32],
      ['priv', 40],
    ]) {
      assert.equal(woff2.readUInt32BE(at), 0, `${name}: ${field} must be zero, nothing extra is shipped`)
    }
    const flavor = woff2.readUInt32BE(4)
    assert.ok(flavor === 0x00010000 || flavor === 0x4f54544f, `${name}: unexpected flavor`)
  }
})

test('the file is padded to a four-byte boundary', async () => {
  // Decoders reject an unpadded file outright, and whether one lands on a boundary by
  // accident is pure luck: eight of these ten did not, and failed in all three engines.
  for (const name of await shipped()) {
    assert.equal((await read(name)).length % 4, 0, `${name} is not 4-byte aligned`)
  }
})

test('glyf and loca carry the null transform, and loca follows glyf', async () => {
  // Transform version 3 is what preserves the per-glyph overlap flags; the 2018-era
  // encoder's glyph transform has nowhere to put them.
  const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post']
  for (const name of await shipped()) {
    const woff2 = await read(name)
    const numTables = woff2.readUInt16BE(12)
    let at = 48
    const order = []
    for (let i = 0; i < numTables; i++) {
      const flags = woff2[at++]
      const index = flags & 0x3f
      let tag
      if (index === 63) {
        tag = woff2.toString('latin1', at, at + 4)
        at += 4
      } else {
        tag = index < KNOWN.length ? KNOWN[index] : `#${index}`
      }
      while (woff2[at++] & 0x80);
      const version = flags >> 6
      if (tag === 'glyf' || tag === 'loca')
        assert.equal(version, 3, `${name}: ${tag} is not the null transform`)
      else if (!tag.startsWith('#')) assert.equal(version, 0, `${name}: ${tag} is transformed`)
      order.push({ index, version })
    }
    const glyf = order.findIndex((t) => t.index === 10)
    const loca = order.findIndex((t) => t.index === 11)
    if (loca !== -1) assert.equal(loca, glyf + 1, `${name}: loca must immediately follow glyf`)
  }
})

test('known tags use their index and unknown tags fall back to a literal tag', () => {
  const font = fixture([
    ['ABCD', Buffer.from('an unknown table')],
    ['cmap', Buffer.alloc(8, 1)],
    ['head', Buffer.alloc(54)],
  ])
  const woff2 = encode(font)
  assert.equal(woff2.readUInt16BE(12), 3)
  assert.equal(woff2[48] & 0x3f, 63, 'ABCD sorts first and must be flagged as a literal tag')
  assert.equal(woff2.toString('latin1', 49, 53), 'ABCD')
  // 1 flag byte + the 4-byte literal tag + a one-byte length, then the next entry.
  assert.equal(woff2[54] & 0x3f, 0, 'cmap is known tag index 0')
  assert.ok(decode(woff2).equals(font))
})

test('UIntBase128 lengths survive past one, two and three bytes', () => {
  for (const length of [0, 1, 127, 128, 16_383, 16_384, 200_000]) {
    const font = fixture([['cmap', Buffer.alloc(length, 7)]])
    const back = decodeTables(encode(font)).tables.find((t) => t.tag === 'cmap')
    assert.equal(back.data.length, length, `length ${length} did not survive the directory`)
  }
})

test('the payload is one brotli stream, and it is smaller than the tables', async () => {
  for (const name of await shipped()) {
    const woff2 = await read(name)
    const compressed = woff2.readUInt32BE(20)
    const sfnt = decode(woff2)
    assert.ok(compressed < sfnt.length, `${name}: compression made the font bigger`)
    assert.ok(48 + compressed <= woff2.length, `${name}: the compressed block runs past the file`)
    // Quality 11 is the setting. A weaker level is several percent worse on this material,
    // so comparing against one is a cheap way to catch the parameters going missing.
    const body = Buffer.concat(parse(sfnt).tables.map((t) => t.data))
    const weaker = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })
    assert.ok(compressed < weaker.length, `${name}: quality 5 matched the shipped settings`)
  }
})

test('decode refuses a file it cannot faithfully reverse', async () => {
  const good = await read((await shipped())[0])

  const notWoff2 = Buffer.from(good)
  notWoff2.write('wOFF', 0, 4, 'latin1')
  assert.throws(() => decode(notWoff2), /not a WOFF2 file/)

  const truncated = good.subarray(0, 40)
  assert.throws(() => decode(truncated), /not a WOFF2 file/)

  const wrongLength = Buffer.from(good)
  wrongLength.writeUInt32BE(good.length + 4, 8)
  assert.throws(() => decode(wrongLength), /length disagrees/)

  // Flip the first directory entry to claim a transform this decoder does not implement.
  const transformed = Buffer.from(good)
  transformed[48] = (transformed[48] & 0x3f) | 0x40
  assert.throws(() => decode(transformed), /transformed/)
})

test('encode refuses a font with loca but no glyf', () => {
  assert.throws(() => encode(fixture([['loca', Buffer.alloc(8)]])), /must have glyf/)
})
