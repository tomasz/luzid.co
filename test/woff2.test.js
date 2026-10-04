import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "vite-plus/test";
import { brotliCompressSync, constants } from "node:zlib";
import {
  canonical,
  overlapFlags,
  parse,
  serialize,
  table,
  withMetrics,
  withNames,
} from "../scripts/fonts/sfnt.js";
import { decode, decodeTables, encode } from "../scripts/fonts/woff2.js";

const url = (p) => new URL(`../${p}`, import.meta.url);
const shipped = async () =>
  (await readdir(url("fonts/files"))).filter((f) => f.endsWith(".woff2")).sort();
const read = (name) => readFile(url(`fonts/files/${name}`));

/** A minimal but structurally valid SFNT, for the cases no shipped font exercises. */
function fixture(tables) {
  return { flavor: 0x00010000, tables: tables.map(([tag, data]) => ({ tag, data })) };
}

/**
 * One shipped file of each flavour. Encoding runs brotli at quality 11, which costs
 * ~30 ms a file, so the round trip covers the two code paths instead of all 174 files;
 * the per-file invariants below only decode.
 */
async function samples() {
  const first = new Map();
  for (const name of await shipped()) {
    const flavor = (await read(name)).readUInt32BE(4);
    if (!first.has(flavor)) first.set(flavor, name);
  }
  assert.equal(first.size, 2, "expected both TrueType and CFF fonts among the shipped files");
  return [...first.values()];
}

test("decode(encode(x)) returns byte-identical tables, for TrueType and CFF", async () => {
  for (const name of await samples()) {
    const sfnt = decode(await read(name));
    const woff2 = encode(parse(sfnt));
    assert.ok(decode(woff2).equals(sfnt), `${name}: the whole file changed across a round trip`);

    const before = parse(sfnt).tables;
    const after = decodeTables(woff2).tables;
    assert.equal(after.length, before.length, `${name}: table count changed`);
    for (const table of before) {
      const match = after.find((t) => t.tag === table.tag);
      assert.ok(match, `${name}: lost the ${table.tag} table`);
      assert.ok(match.data.equals(table.data), `${name}: ${table.tag} changed across a round trip`);
    }

    // Quality 11 is the setting. A weaker level is several percent worse on this material,
    // so comparing against one is a cheap way to catch the parameters going missing.
    const body = Buffer.concat(before.map((t) => t.data));
    const weaker = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } });
    assert.ok(woff2.readUInt32BE(20) < weaker.length, `${name}: quality 5 matched encode()`);
  }
});

test("the header is the 48 bytes the format specifies", async () => {
  for (const name of await shipped()) {
    const woff2 = await read(name);
    assert.equal(woff2.toString("latin1", 0, 4), "wOF2", `${name}: bad signature`);
    assert.equal(
      woff2.readUInt32BE(8),
      woff2.length,
      `${name}: the length field disagrees with the file`,
    );
    assert.equal(woff2.readUInt16BE(14), 0, `${name}: the reserved field must be zero`);
    assert.equal(woff2.readUInt16BE(24), 1, `${name}: majorVersion must be 1`);
    for (const [field, at] of [
      ["meta", 28],
      ["metaLength", 32],
      ["priv", 40],
    ]) {
      assert.equal(
        woff2.readUInt32BE(at),
        0,
        `${name}: ${field} must be zero, nothing extra is shipped`,
      );
    }
    const flavor = woff2.readUInt32BE(4);
    assert.ok(flavor === 0x00010000 || flavor === 0x4f54544f, `${name}: unexpected flavor`);
  }
});

test("the file is padded to a four-byte boundary", async () => {
  // Decoders reject an unpadded file outright, and whether one lands on a boundary by
  // accident is pure luck: eight of these ten did not, and failed in all three engines.
  for (const name of await shipped()) {
    assert.equal((await read(name)).length % 4, 0, `${name} is not 4-byte aligned`);
  }
});

test("glyf and loca carry the null transform, and loca follows glyf", async () => {
  // Transform version 3 is what preserves the per-glyph overlap flags; the 2018-era
  // encoder's glyph transform has nowhere to put them.
  const KNOWN = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post"];
  for (const name of await shipped()) {
    const woff2 = await read(name);
    const numTables = woff2.readUInt16BE(12);
    let at = 48;
    const order = [];
    for (let i = 0; i < numTables; i++) {
      const flags = woff2[at++];
      const index = flags & 0x3f;
      let tag;
      if (index === 63) {
        tag = woff2.toString("latin1", at, at + 4);
        at += 4;
      } else {
        tag = index < KNOWN.length ? KNOWN[index] : `#${index}`;
      }
      while (woff2[at++] & 0x80);
      const version = flags >> 6;
      if (tag === "glyf" || tag === "loca")
        assert.equal(version, 3, `${name}: ${tag} is not the null transform`);
      else if (!tag.startsWith("#")) assert.equal(version, 0, `${name}: ${tag} is transformed`);
      order.push({ index, version });
    }
    const glyf = order.findIndex((t) => t.index === 10);
    const loca = order.findIndex((t) => t.index === 11);
    if (loca !== -1) assert.equal(loca, glyf + 1, `${name}: loca must immediately follow glyf`);
  }
});

test("known tags use their index and unknown tags fall back to a literal tag", () => {
  const font = fixture([
    ["ABCD", Buffer.from("an unknown table")],
    ["cmap", Buffer.alloc(8, 1)],
    ["head", Buffer.alloc(54)],
  ]);
  const woff2 = encode(font);
  assert.equal(woff2.readUInt16BE(12), 3);
  assert.equal(woff2[48] & 0x3f, 63, "ABCD sorts first and must be flagged as a literal tag");
  assert.equal(woff2.toString("latin1", 49, 53), "ABCD");
  // 1 flag byte + the 4-byte literal tag + a one-byte length, then the next entry.
  assert.equal(woff2[54] & 0x3f, 0, "cmap is known tag index 0");
  assert.ok(decode(woff2).equals(serialize(font)));
});

test("UIntBase128 lengths survive past one, two and three bytes", () => {
  for (const length of [0, 1, 127, 128, 16_383, 16_384, 200_000]) {
    const font = fixture([["cmap", Buffer.alloc(length, 7)]]);
    const back = decodeTables(encode(font)).tables.find((t) => t.tag === "cmap");
    assert.equal(back.data.length, length, `length ${length} did not survive the directory`);
  }
});

test("the payload is one brotli stream, and it is smaller than the tables", async () => {
  for (const name of await shipped()) {
    const woff2 = await read(name);
    const compressed = woff2.readUInt32BE(20);
    assert.ok(compressed < decode(woff2).length, `${name}: compression made the font bigger`);
    assert.ok(48 + compressed <= woff2.length, `${name}: the compressed block runs past the file`);
  }
});

test("decode refuses a file it cannot faithfully reverse", async () => {
  const good = await read((await shipped())[0]);

  const notWoff2 = Buffer.from(good);
  notWoff2.write("wOFF", 0, 4, "latin1");
  assert.throws(() => decode(notWoff2), /not a WOFF2 file/);

  const truncated = good.subarray(0, 40);
  assert.throws(() => decode(truncated), /not a WOFF2 file/);

  const wrongLength = Buffer.from(good);
  wrongLength.writeUInt32BE(good.length + 4, 8);
  assert.throws(() => decode(wrongLength), /length disagrees/);

  // Flip the first directory entry to claim a transform this decoder does not implement.
  const transformed = Buffer.from(good);
  transformed[48] = (transformed[48] & 0x3f) | 0x40;
  assert.throws(() => decode(transformed), /transformed/);
});

test("encode refuses a font with loca but no glyf", () => {
  assert.throws(() => encode(fixture([["loca", Buffer.alloc(8)]])), /must have glyf/);
});

/**
 * One simple glyph and one composite, neither flagged: every shipped font is flagged already,
 * so only a font like this one shows whether the verifier would notice a missing flag.
 */
function unflaggedGlyf() {
  const head = Buffer.alloc(54); // indexToLocFormat at 50 stays 0: short offsets
  head.writeUInt32BE(0x12345678, 8); // a stale checkSumAdjustment that serialize must not zero in place
  const maxp = Buffer.alloc(6);
  maxp.writeUInt16BE(2, 4);
  const glyf = Buffer.alloc(32);
  glyf.writeInt16BE(1, 0); // one contour; endPts, a zero instructionLength, then flags at 14
  glyf.writeInt16BE(-1, 16); // a composite; its first component's flags are at 26
  const loca = Buffer.alloc(6);
  [0, 8, 16].forEach((half, i) => loca.writeUInt16BE(half, i * 2));
  return fixture([
    ["glyf", glyf],
    ["head", head],
    ["hhea", Buffer.alloc(36)],
    ["loca", loca],
    ["maxp", maxp],
    ["name", Buffer.alloc(6)],
    ["OS/2", Buffer.alloc(78)],
  ]);
}

test("the overlap flags are read from the first flag byte and the first component", () => {
  const font = unflaggedGlyf();
  assert.deepEqual(overlapFlags(font), { glyphs: 2, flagged: 0 });
  const glyf = Buffer.from(table(font, "glyf"));
  glyf[14] = 0x40; // OVERLAP_SIMPLE
  glyf.writeUInt16BE(0x0400, 26); // OVERLAP_COMPOUND
  const flagged = {
    ...font,
    tables: font.tables.map((t) => (t.tag === "glyf" ? { ...t, data: glyf } : t)),
  };
  assert.deepEqual(overlapFlags(flagged), { glyphs: 2, flagged: 2 });
  assert.deepEqual(overlapFlags(fixture([["CFF ", Buffer.alloc(4)]])), { glyphs: 0, flagged: 0 });
});

test("no sfnt or woff2 function writes into its argument", () => {
  const font = unflaggedGlyf();
  const before = font.tables.map((t) => ({ tag: t.tag, data: Buffer.from(t.data) }));
  // Freezing catches a replaced table or array; a Buffer cannot be frozen, so its bytes are
  // compared against the copy instead.
  const frozen = Object.freeze({
    flavor: font.flavor,
    tables: Object.freeze(font.tables.map((t) => Object.freeze(t))),
  });
  const record = { platformID: 3, encodingID: 1, languageID: 0x409, nameID: 1, text: "LZ" };
  const records = Object.freeze([Object.freeze(record)]);

  const outputs = [
    withMetrics(frozen, { asc: 900, desc: 300 }),
    withNames(frozen, records),
    canonical(frozen),
  ];
  const bytes = serialize(frozen);
  const woff2 = encode(frozen);
  const sfnt = Buffer.from(bytes);
  parse(sfnt);
  decode(woff2);

  assert.deepEqual(
    frozen.tables.map((t) => [t.tag, t.data.toString("hex")]),
    before.map((t) => [t.tag, t.data.toString("hex")]),
  );
  assert.ok(sfnt.equals(bytes), "parse wrote into its buffer");
  // Each result really is different from the input, so the comparison above means something.
  for (const out of outputs) assert.notDeepEqual(out.tables, frozen.tables);
  assert.ok(decode(woff2).equals(bytes));
});
