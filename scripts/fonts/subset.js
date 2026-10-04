/**
 * hb-subset, called straight through `harfbuzzjs/dist/harfbuzz-subset.wasm`. PLAN §5.5 rule 5.
 *
 * This is the usual hb-subset calling sequence, with no format conversion, plus the one flag
 * the npm wrapper around it never exposed: HB_SUBSET_FLAGS_SET_OVERLAPS_FLAG, which sets
 * OVERLAP_SIMPLE / OVERLAP_COMPOUND on every glyf glyph. Pinned variable fonts have
 * overlapping contours and Apple's rasterizer punches holes through them without that flag.
 * Input and output are both plain SFNT; every upstream is TrueType or CFF, never WOFF.
 */
import { readFile } from "node:fs/promises";

const HB_MEMORY_MODE_WRITABLE = 2;
const HB_SUBSET_SETS_DROP_TABLE_TAG = 3;
const HB_SUBSET_SETS_NAME_ID = 4;
const HB_SUBSET_SETS_LAYOUT_FEATURE_TAG = 6;
const HB_SUBSET_FLAGS_NO_HINTING = 0x01;
const HB_SUBSET_FLAGS_SET_OVERLAPS_FLAG = 0x10;

const tag = (s) => [...s].reduce((a, ch) => (a << 8) + ch.charCodeAt(0), 0);

let loaded;
const harfbuzz = () =>
  (loaded ??= (async () => {
    const wasm = await readFile(
      new URL(import.meta.resolve("harfbuzzjs/dist/harfbuzz-subset.wasm")),
    );
    const { exports } = (await WebAssembly.instantiate(wasm)).instance;
    exports._initialize();
    return exports;
  })());

/**
 * Subset `font` to the code points of `text`, keep `nameIds` and `features` on top of
 * hb-subset's defaults, drop `dropTables`, and pin every axis in `axes` (`{tag: value}`).
 * @returns {Promise<Buffer>} the subset as SFNT
 */
export async function subset(font, text, { axes, features, nameIds, dropTables }) {
  const hb = await harfbuzz();
  // The heap can grow during the subset, which detaches any view taken before it.
  const heap = () => new Uint8Array(hb.memory.buffer);
  const input = hb.hb_subset_input_create_or_fail();
  if (input === 0) throw new Error("hb_subset_input_create_or_fail failed");
  const buffer = hb.malloc(font.byteLength);
  heap().set(font, buffer);
  const blob = hb.hb_blob_create(buffer, font.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);
  let result = 0;
  try {
    const add = (set, values) => values.forEach((v) => hb.hb_set_add(set, v));
    const layout = hb.hb_subset_input_set(input, HB_SUBSET_SETS_LAYOUT_FEATURE_TAG);
    hb.hb_set_clear(layout);
    add(layout, features.map(tag));
    add(hb.hb_subset_input_set(input, HB_SUBSET_SETS_NAME_ID), nameIds);
    const flags = HB_SUBSET_FLAGS_NO_HINTING | HB_SUBSET_FLAGS_SET_OVERLAPS_FLAG;
    hb.hb_subset_input_set_flags(input, hb.hb_subset_input_get_flags(input) | flags);
    add(hb.hb_subset_input_set(input, HB_SUBSET_SETS_DROP_TABLE_TAG), dropTables.map(tag));
    add(
      hb.hb_subset_input_unicode_set(input),
      [...text].map((c) => c.codePointAt(0)),
    );
    for (const [axis, value] of Object.entries(axes)) {
      if (!hb.hb_subset_input_pin_axis_location(input, face, tag(axis), value))
        throw new Error(`hb-subset could not pin ${axis} to ${value}`);
    }
    const subsetFace = hb.hb_subset_or_fail(face, input);
    if (subsetFace === 0) throw new Error("hb_subset_or_fail failed");
    result = hb.hb_face_reference_blob(subsetFace);
    hb.hb_face_destroy(subsetFace);
    const at = hb.hb_blob_get_data(result, 0);
    const length = hb.hb_blob_get_length(result);
    if (length === 0) throw new Error("hb-subset produced an empty font");
    return Buffer.from(heap().subarray(at, at + length));
  } finally {
    if (result) hb.hb_blob_destroy(result);
    hb.hb_subset_input_destroy(input);
    hb.hb_face_destroy(face);
    hb.free(buffer);
  }
}
