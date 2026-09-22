/**
 * WOFF2 encoder and decoder, `node:zlib` only (PLAN §5.5 rule 6).
 *
 * Why not an off-the-shelf encoder: the 2018-era `wawoff2` bundled with `fontverter`
 * re-encodes `glyf` with the WOFF2 glyph transform, and that transform has no room for
 * the per-glyph OVERLAP_SIMPLE / OVERLAP_COMPOUND flags `scripts/sfnt.mjs` sets — they are
 * silently dropped, and Apple's rasterizer then punches holes through the overlapping
 * contours of every pinned variable instance. So `glyf` and `loca` are written with
 * transform version 3, the null transform, which stores the tables verbatim.
 *
 * Brotli at quality 11 in BROTLI_MODE_FONT gets back more than the glyph transform gave up.
 */
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib'
import { build, parse } from './sfnt.mjs'

const SIGNATURE = 0x774f4632 // 'wOF2'

// Table tags 0..62 of the WOFF2 known-tag table; 63 means "a 4-byte tag follows".
const KNOWN_TAGS = [
  'cmap',
  'head',
  'hhea',
  'hmtx',
  'maxp',
  'name',
  'OS/2',
  'post',
  'cvt ',
  'fpgm',
  'glyf',
  'loca',
  'prep',
  'CFF ',
  'VORG',
  'EBDT',
  'EBLC',
  'gasp',
  'hdmx',
  'kern',
  'LTSH',
  'PCLT',
  'VDMX',
  'vhea',
  'vmtx',
  'BASE',
  'GDEF',
  'GPOS',
  'GSUB',
  'EBSC',
  'JSTF',
  'MATH',
  'CBDT',
  'CBLC',
  'COLR',
  'CPAL',
  'SVG ',
  'sbix',
  'acnt',
  'avar',
  'bdat',
  'bloc',
  'bsln',
  'cvar',
  'fdsc',
  'feat',
  'fmtx',
  'fvar',
  'gvar',
  'hsty',
  'just',
  'lcar',
  'mort',
  'morx',
  'opbd',
  'prop',
  'trak',
  'Zapf',
  'Silf',
  'Glat',
  'Gloc',
  'Feat',
  'Sill',
]

/** Transform version 3 is the null transform for glyf/loca; 0 is the null transform elsewhere. */
const nullTransform = (tag) => (tag === 'glyf' || tag === 'loca' ? 3 : 0)

function writeBase128(n) {
  const bytes = []
  do {
    bytes.unshift(n & 0x7f)
    n = Math.floor(n / 128)
  } while (n > 0)
  for (let i = 0; i < bytes.length - 1; i++) bytes[i] |= 0x80
  return Buffer.from(bytes)
}

function readBase128(buf, at) {
  let value = 0
  for (let i = 0; i < 5; i++) {
    const byte = buf[at++]
    if (i === 0 && byte === 0x80) throw new Error('woff2: UIntBase128 with a leading zero')
    value = value * 128 + (byte & 0x7f)
    if (!(byte & 0x80)) return [value, at]
  }
  throw new Error('woff2: UIntBase128 longer than five bytes')
}

/**
 * WOFF2 fixes the physical order of two tables: `loca` must come immediately after `glyf`,
 * whatever the SFNT directory said. Decoders reject the file outright otherwise, with no
 * useful message — Chromium only says "Failed to convert WOFF 2.0 font to SFNT".
 */
function orderTables(tables) {
  const out = tables.filter((t) => t.tag !== 'loca')
  const loca = tables.find((t) => t.tag === 'loca')
  if (!loca) return out
  const glyf = out.findIndex((t) => t.tag === 'glyf')
  if (glyf === -1) throw new Error('woff2: a font with loca must have glyf')
  out.splice(glyf + 1, 0, loca)
  return out
}

/** @param {Buffer} sfnt a complete TrueType/OpenType file @returns {Buffer} */
export function encode(sfnt) {
  const { flavor, tables: parsed } = parse(sfnt)
  const tables = orderTables(parsed)
  const directory = []
  for (const { tag, data } of tables) {
    const index = KNOWN_TAGS.indexOf(tag)
    const flags = (index === -1 ? 63 : index) | (nullTransform(tag) << 6)
    const head = Buffer.from([flags])
    const name = index === -1 ? Buffer.from(tag, 'latin1') : Buffer.alloc(0)
    directory.push(Buffer.concat([head, name, writeBase128(data.length)]))
  }
  const compressed = brotliCompressSync(Buffer.concat(tables.map((t) => t.data)), {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_FONT,
      [constants.BROTLI_PARAM_SIZE_HINT]: tables.reduce((n, t) => n + t.data.length, 0),
    },
  })
  const totalSfntSize = 12 + tables.length * 16 + tables.reduce((n, t) => n + ((t.data.length + 3) & ~3), 0)

  const header = Buffer.alloc(48)
  const body = Buffer.concat(directory)
  // The font data block is padded to a 4-byte boundary. Decoders reject an unpadded file
  // flatly, which is easy to miss: whether one happens to be 4-aligned already is luck.
  const padding = Buffer.alloc((4 - ((48 + body.length + compressed.length) % 4)) % 4)
  header.writeUInt32BE(SIGNATURE, 0)
  header.writeUInt32BE(flavor, 4)
  header.writeUInt32BE(48 + body.length + compressed.length + padding.length, 8)
  header.writeUInt16BE(tables.length, 12)
  header.writeUInt16BE(0, 14) // reserved
  header.writeUInt32BE(totalSfntSize, 16)
  header.writeUInt32BE(compressed.length, 20)
  header.writeUInt16BE(1, 24) // majorVersion
  header.writeUInt16BE(0, 26) // minorVersion
  // metaOffset/metaLength/metaOrigLength/privOffset/privLength at 28..48 stay zero.
  return Buffer.concat([header, body, compressed, padding])
}

/** @param {Buffer} woff2 @returns {{flavor: number, tables: {tag: string, data: Buffer}[]}} */
export function decodeTables(woff2) {
  if (woff2.length < 48 || woff2.readUInt32BE(0) !== SIGNATURE) throw new Error('woff2: not a WOFF2 file')
  const flavor = woff2.readUInt32BE(4)
  if (woff2.readUInt32BE(8) !== woff2.length) throw new Error('woff2: header length disagrees with the file')
  const numTables = woff2.readUInt16BE(12)
  const compressedLength = woff2.readUInt32BE(20)

  const entries = []
  let at = 48
  for (let i = 0; i < numTables; i++) {
    const flags = woff2[at++]
    const index = flags & 0x3f
    let tag
    if (index === 63) {
      tag = woff2.toString('latin1', at, at + 4)
      at += 4
    } else {
      tag = KNOWN_TAGS[index]
    }
    let length
    ;[length, at] = readBase128(woff2, at)
    if (flags >> 6 !== nullTransform(tag)) throw new Error(`woff2: ${tag} is transformed, which is not read`)
    entries.push({ tag, length })
  }

  const data = brotliDecompressSync(woff2.subarray(at, at + compressedLength))
  const tables = []
  let cursor = 0
  for (const { tag, length } of entries) {
    if (cursor + length > data.length) throw new Error(`woff2: ${tag} runs past the decompressed stream`)
    tables.push({ tag, data: Buffer.from(data.subarray(cursor, cursor + length)) })
    cursor += length
  }
  return { flavor, tables }
}

/**
 * The inverse of `encode`. WOFF2 carries no table checksums, so the SFNT directory is
 * rebuilt from scratch; for a canonically ordered input `decode(encode(x))` is `x`.
 * @param {Buffer} woff2 @returns {Buffer}
 */
export function decode(woff2) {
  return build(decodeTables(woff2))
}
