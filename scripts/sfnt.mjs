/**
 * Minimal SFNT (TrueType/OpenType) reader, writer and patcher. No dependencies.
 *
 * Four jobs, all of them required by PLAN §5.2 and §5.5 rules 3 and 5:
 *
 *  1. `withMetrics` rewrites the vertical metrics so that every engine and OS puts the
 *     baseline in the same place. Without this the pseudo-element copies an effect paints
 *     drift away from the real text on one platform or another, and `ascent-override` is not
 *     an option because Safari does not support it.
 *  2. `withOverlapFlags` sets OVERLAP_SIMPLE / OVERLAP_COMPOUND on every `glyf` glyph.
 *     A pinned instance of a variable font almost always has overlapping contours, and
 *     Apple's rasterizer punches holes through them unless the flag says not to.
 *  3. `readNames` / `withNames` rebuild the `name` table. The OFL requires a Modified
 *     Version of a font that declares a Reserved Font Name to carry a different name, and
 *     neither `subset-font` nor `hb-subset` can rewrite name IDs 1-6 (subset-font 2.9.0,
 *     verified in its source): hb-subset only chooses which records to *keep*.
 *  4. `serialize` reassembles a font with correct table checksums and
 *     `head.checkSumAdjustment`, which both WOFF2 encoding and decoding need (WOFF2 does not
 *     carry checksums).
 *
 * Every `with*` function returns a new `Sfnt` and leaves its argument alone: the pipeline
 * holds one parsed subset across several steps, and a step that patched it in place would
 * make the order of those steps matter.
 *
 * Offsets are hard-coded from the OpenType spec rather than parsed into structs: only a
 * dozen fields are ever touched and a table layout is the one thing that never changes.
 */

/** @typedef {{tag: string, data: Buffer}} Table */
/** @typedef {{flavor: number, tables: readonly Table[]}} Sfnt */
/**
 * @typedef {{platformID: number, encodingID: number, languageID: number, nameID: number,
 *   text: string}} NameRecord
 */

const HEAD_CHECKSUM_MAGIC = 0xb1b0afba;

/** Sum of the table data as big-endian uint32s, zero-padded to a 4-byte multiple. */
function checksum(data) {
  let sum = 0;
  const whole = data.length & ~3;
  for (let i = 0; i < whole; i += 4) sum = (sum + data.readUInt32BE(i)) >>> 0;
  if (whole !== data.length) {
    let tail = 0;
    for (let i = whole; i < data.length; i++) tail |= data[i] << (8 * (3 - (i - whole)));
    sum = (sum + (tail >>> 0)) >>> 0;
  }
  return sum >>> 0;
}

const pad4 = (n) => (n + 3) & ~3;

/** @param {Buffer} font @returns {Sfnt} tables in directory order. */
export function parse(font) {
  if (font.length < 12) throw new Error("sfnt: file shorter than the header");
  const flavor = font.readUInt32BE(0);
  if (flavor !== 0x00010000 && flavor !== 0x4f54544f && flavor !== 0x74727565) {
    throw new Error(`sfnt: unsupported flavor 0x${flavor.toString(16)}`);
  }
  const numTables = font.readUInt16BE(4);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const p = 12 + i * 16;
    const tag = font.toString("latin1", p, p + 4);
    const offset = font.readUInt32BE(p + 8);
    const length = font.readUInt32BE(p + 12);
    if (offset + length > font.length)
      throw new Error(`sfnt: table ${tag} runs past the end of the file`);
    tables.push({ tag, data: Buffer.from(font.subarray(offset, offset + length)) });
  }
  return { flavor, tables };
}

/** @param {Sfnt} sfnt @param {string} tag @returns {Buffer | undefined} */
export function table(sfnt, tag) {
  return sfnt.tables.find((t) => t.tag === tag)?.data;
}

/** A copy of `sfnt` with `tag` replaced by `data`, or appended if it was missing. */
function withTable(sfnt, tag, data) {
  const tables = sfnt.tables.some((t) => t.tag === tag)
    ? sfnt.tables.map((t) => (t.tag === tag ? { tag, data } : t))
    : [...sfnt.tables, { tag, data }];
  return { flavor: sfnt.flavor, tables };
}

/** The SFNT table directory for `tables`, which must already be in their final order. */
function directory(flavor, tables) {
  const n = tables.length;
  let entrySelector = 0;
  while (1 << (entrySelector + 1) <= n) entrySelector++;
  const searchRange = (1 << entrySelector) * 16;
  const dir = Buffer.alloc(12 + n * 16);
  dir.writeUInt32BE(flavor, 0);
  dir.writeUInt16BE(n, 4);
  dir.writeUInt16BE(searchRange, 6);
  dir.writeUInt16BE(entrySelector, 8);
  dir.writeUInt16BE(n * 16 - searchRange, 10);
  let offset = dir.length;
  tables.forEach((t, i) => {
    const p = 12 + i * 16;
    dir.write(t.tag, p, 4, "latin1");
    dir.writeUInt32BE(checksum(t.data), p + 4);
    dir.writeUInt32BE(offset, p + 8);
    dir.writeUInt32BE(t.data.length, p + 12);
    offset += pad4(t.data.length);
  });
  return dir;
}

/**
 * The tables exactly as `serialize` lays them out: sorted by tag, with
 * `head.checkSumAdjustment` filled in. `woff2.encode` stores these, which is what makes
 * `woff2.decode(woff2.encode(x))` equal `serialize(x)` without a parse in between.
 *
 * Every table starts on a 4-byte boundary and `checksum` zero-pads, so the checksum of the
 * whole file is the directory's plus every table's; the file never has to be assembled to
 * know it. The adjustment is computed with itself zeroed, as is the directory's head entry.
 *
 * @param {Sfnt} sfnt @returns {{dir: Buffer, sfnt: Sfnt}}
 */
function canonicalLayout({ flavor, tables }) {
  const sorted = tables
    .map((t) => {
      if (t.tag !== "head" || t.data.length < 12) return t;
      const data = Buffer.from(t.data);
      data.writeUInt32BE(0, 8);
      return { tag: t.tag, data };
    })
    .sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const dir = directory(flavor, sorted);
  const head = sorted.find((t) => t.tag === "head");
  if (head && head.data.length >= 12) {
    const sum = sorted.reduce((s, t) => (s + checksum(t.data)) >>> 0, checksum(dir));
    head.data.writeUInt32BE((HEAD_CHECKSUM_MAGIC - sum) >>> 0, 8);
  }
  return { dir, sfnt: { flavor, tables: sorted } };
}

/** @param {Sfnt} sfnt @returns {Sfnt} the tables `serialize` writes, in its order. */
export function canonical(sfnt) {
  return canonicalLayout(sfnt).sfnt;
}

/**
 * Serialize tables into a canonical SFNT: directory sorted by tag, data in directory order,
 * every table 4-byte aligned, all checksums recomputed. Canonical means `parse` →
 * `serialize` is a fixed point, which is what makes `woff2.decode(woff2.encode(x))`
 * byte-identical.
 * @param {Sfnt} sfnt @returns {Buffer}
 */
export function serialize(sfnt) {
  const { dir, sfnt: laid } = canonicalLayout(sfnt);
  const parts = [dir];
  for (const t of laid.tables)
    parts.push(t.data, Buffer.alloc(pad4(t.data.length) - t.data.length));
  return Buffer.concat(parts);
}

/**
 * Vertical metrics, PLAN §5.2. All arguments and results are in font units.
 *
 * `tops` and `depths` are the per-word ink extremes over every variant that will be shaped
 * with this file: `top` is the height of the ink above the baseline, `depth` its reach below.
 *
 * The third term of `desc` is what keeps every emitted line-height positive. The renderer
 * emits `L = 2·top − ASC + DESC` per line; substituting `DESC ≥ ASC − 2·min(top) + 0.05·upm`
 * gives `L ≥ 2·(top − min(top)) + 0.05 ≥ 0.05`.
 */
export function deriveMetrics({ upm, tops, depths }) {
  if (!tops.length || !depths.length)
    throw new Error("sfnt: no ink measurements to derive metrics from");
  const asc = Math.ceil(Math.max(...tops));
  const desc = Math.max(
    0,
    Math.ceil(Math.max(...depths)),
    asc - 2 * Math.min(...tops) + 0.05 * upm,
  );
  const rounded = { asc, desc: Math.ceil(desc) };
  if (rounded.asc > 32767 || rounded.desc > 32767) {
    throw new Error(`sfnt: metrics do not fit in int16 (asc ${rounded.asc}, desc ${rounded.desc})`);
  }
  if (rounded.asc <= 0) throw new Error(`sfnt: non-positive ascender ${rounded.asc}`);
  return rounded;
}

/**
 * Write the derived metrics into `hhea` and `OS/2`, PLAN §5.2.
 * `sTypo*` are signed, `usWin*` unsigned; `fsSelection` is deliberately left alone.
 * @param {Sfnt} sfnt @param {{asc: number, desc: number}} metrics @returns {Sfnt}
 */
export function withMetrics(sfnt, { asc, desc }) {
  const hheaIn = table(sfnt, "hhea");
  const os2In = table(sfnt, "OS/2");
  if (!hheaIn) throw new Error("sfnt: no hhea table");
  if (!os2In) throw new Error("sfnt: no OS/2 table");
  if (hheaIn.length < 10) throw new Error("sfnt: hhea table is too short");
  // sTypoLineGap ends at 74 and usWinDescent at 78, so version 0 (78 bytes) is the minimum.
  if (os2In.length < 78) throw new Error(`sfnt: OS/2 table is ${os2In.length} bytes, need >= 78`);

  const hhea = Buffer.from(hheaIn);
  const os2 = Buffer.from(os2In);
  hhea.writeInt16BE(asc, 4);
  hhea.writeInt16BE(-desc, 6);
  hhea.writeInt16BE(0, 8);
  os2.writeInt16BE(asc, 68);
  os2.writeInt16BE(-desc, 70);
  os2.writeInt16BE(0, 72);
  os2.writeUInt16BE(asc, 74);
  os2.writeUInt16BE(desc, 76);
  return withTable(withTable(sfnt, "hhea", hhea), "OS/2", os2);
}

/** `OS/2.usWeightClass`, the `css.weight` fallback; `undefined` for a font without OS/2. */
export function readWeightClass(sfnt) {
  return table(sfnt, "OS/2")?.readUInt16BE(4);
}

/** Read back what `withMetrics` wrote, for verification. */
export function readMetrics(sfnt) {
  const hhea = table(sfnt, "hhea");
  const os2 = table(sfnt, "OS/2");
  if (!hhea || !os2 || os2.length < 78) throw new Error("sfnt: cannot read metrics");
  return {
    ascender: hhea.readInt16BE(4),
    descender: hhea.readInt16BE(6),
    lineGap: hhea.readInt16BE(8),
    sTypoAscender: os2.readInt16BE(68),
    sTypoDescender: os2.readInt16BE(70),
    sTypoLineGap: os2.readInt16BE(72),
    usWinAscent: os2.readUInt16BE(74),
    usWinDescent: os2.readUInt16BE(76),
  };
}

// ---------------------------------------------------------------- the name table

/**
 * Platform 1 (Macintosh) stores one byte per character; every other platform the spec
 * still allows in a `name` table stores UTF-16BE. MacRoman and latin1 agree over the ASCII
 * a name record is written in, and a record that is not ASCII is one we are about to
 * replace anyway.
 */
const decodeNameString = (data, platformID) => {
  if (platformID === 1) return data.toString("latin1");
  let out = "";
  for (let i = 0; i + 1 < data.length; i += 2) out += String.fromCharCode(data.readUInt16BE(i));
  return out;
};

const encodeNameString = (text, platformID) => {
  if (platformID === 1) return Buffer.from(text, "latin1");
  const out = Buffer.alloc(text.length * 2);
  for (let i = 0; i < text.length; i++) out.writeUInt16BE(text.charCodeAt(i), i * 2);
  return out;
};

/** Every record of the `name` table, in table order. @returns {NameRecord[]} */
export function readNames(sfnt) {
  const d = table(sfnt, "name");
  if (!d) return [];
  if (d.length < 6) throw new Error("sfnt: the name table is shorter than its header");
  const count = d.readUInt16BE(2);
  const storage = d.readUInt16BE(4);
  const out = [];
  for (let i = 0; i < count; i++) {
    const p = 6 + i * 12;
    if (p + 12 > d.length) throw new Error("sfnt: a name record runs past the end of the table");
    const length = d.readUInt16BE(p + 8);
    const at = storage + d.readUInt16BE(p + 10);
    if (at + length > d.length)
      throw new Error("sfnt: a name string runs past the end of the table");
    const platformID = d.readUInt16BE(p);
    out.push({
      platformID,
      encodingID: d.readUInt16BE(p + 2),
      languageID: d.readUInt16BE(p + 4),
      nameID: d.readUInt16BE(p + 6),
      text: decodeNameString(d.subarray(at, at + length), platformID),
    });
  }
  return out;
}

/**
 * Replace the `name` table with exactly these records, as a format 0 table.
 *
 * Format 0 rather than 1 because format 1's language-tag records are the only thing format
 * 1 adds, and a record that names a tag (`languageID >= 0x8000`) is dropped by the caller
 * before it gets here — see `renameRecords` in `scripts/fonts/licence.js`. The spec requires
 * the records to be sorted by platform, encoding, language and name ID; identical strings
 * share one run of storage, which is what keeps a rebuilt table from growing.
 * @param {Sfnt} sfnt @param {readonly NameRecord[]} records @returns {Sfnt}
 */
export function withNames(sfnt, records) {
  const sorted = [...records].sort(
    (a, b) =>
      a.platformID - b.platformID ||
      a.encodingID - b.encodingID ||
      a.languageID - b.languageID ||
      a.nameID - b.nameID,
  );
  const storage = [];
  const offsets = new Map();
  let length = 0;
  const place = (record) => {
    const bytes = encodeNameString(record.text, record.platformID);
    const key = `${record.platformID} ${record.text}`;
    if (!offsets.has(key)) {
      if (length + bytes.length > 0xffff)
        throw new Error("sfnt: the name table storage is over 64 KiB");
      offsets.set(key, length);
      storage.push(bytes);
      length += bytes.length;
    }
    return { offset: offsets.get(key), length: bytes.length };
  };

  const dir = Buffer.alloc(6 + sorted.length * 12);
  dir.writeUInt16BE(0, 0);
  dir.writeUInt16BE(sorted.length, 2);
  dir.writeUInt16BE(dir.length, 4);
  sorted.forEach((record, i) => {
    const p = 6 + i * 12;
    const { offset, length: bytes } = place(record);
    dir.writeUInt16BE(record.platformID, p);
    dir.writeUInt16BE(record.encodingID, p + 2);
    dir.writeUInt16BE(record.languageID, p + 4);
    dir.writeUInt16BE(record.nameID, p + 6);
    dir.writeUInt16BE(bytes, p + 8);
    dir.writeUInt16BE(offset, p + 10);
  });

  return withTable(sfnt, "name", Buffer.concat([dir, ...storage]));
}

// ---------------------------------------------------------------- overlap flags

/** Glyph data offsets from `loca`, honouring `head.indexToLocFormat`. */
function locaOffsets(sfnt) {
  const head = table(sfnt, "head");
  const loca = table(sfnt, "loca");
  const maxp = table(sfnt, "maxp");
  if (!head || !loca || !maxp) throw new Error("sfnt: a glyf font needs head, loca and maxp");
  const long = head.readInt16BE(50) === 1;
  const numGlyphs = maxp.readUInt16BE(4);
  const offsets = [];
  for (let i = 0; i <= numGlyphs; i++) {
    offsets.push(long ? loca.readUInt32BE(i * 4) : loca.readUInt16BE(i * 2) * 2);
  }
  return offsets;
}

/**
 * For every glyph that can carry an overlap flag, the `[byte offset in glyf, bit]` that
 * holds it, PLAN §5.5 rule 5. A simple glyph's OVERLAP_SIMPLE is 0x40 of its first flag
 * byte; a composite's OVERLAP_COMPOUND is 0x0400 of its first component's uint16 flags,
 * which is 0x04 of that field's high byte. Empty glyphs (a space) carry no outline and
 * are skipped.
 * @param {Sfnt} sfnt @returns {Generator<[number, number]>}
 */
function* glyfFlagOffsets(sfnt) {
  const glyf = table(sfnt, "glyf");
  if (!glyf) return;
  const offsets = locaOffsets(sfnt);
  for (let g = 0; g < offsets.length - 1; g++) {
    const start = offsets[g];
    if (offsets[g + 1] - start < 10) continue;
    const numberOfContours = glyf.readInt16BE(start);
    if (numberOfContours > 0) {
      // endPtsOfContours[n] then instructionLength then instructions, then the flag array.
      const instructionsAt = start + 10 + numberOfContours * 2;
      yield [instructionsAt + 2 + glyf.readUInt16BE(instructionsAt), 0x40];
    } else if (numberOfContours < 0) {
      yield [start + 10, 0x04];
    }
  }
}

/**
 * Set the overlap flag on every glyph that can carry one. CFF fonts have no `glyf` and
 * need nothing: the PostScript rasterizer uses the non-zero winding rule already.
 * @param {Sfnt} sfnt @returns {Sfnt}
 */
export function withOverlapFlags(sfnt) {
  const glyf = table(sfnt, "glyf");
  if (!glyf) return sfnt;
  const data = Buffer.from(glyf);
  for (const [at, bit] of glyfFlagOffsets(sfnt)) data[at] |= bit;
  return withTable(sfnt, "glyf", data);
}

/** How many glyphs can carry an overlap flag, and how many do. Used by the verifier. */
export function overlapFlags(sfnt) {
  const glyf = table(sfnt, "glyf");
  let glyphs = 0;
  let flagged = 0;
  for (const [at, bit] of glyfFlagOffsets(sfnt)) {
    glyphs++;
    if (glyf[at] & bit) flagged++;
  }
  return { glyphs, flagged };
}
