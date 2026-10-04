/**
 * The HarfBuzz boundary: open a font, shape a word as Polish Latin, and read back where its
 * ink lands and what it draws. Deterministic over the font bytes; no files, no network.
 */
import * as hb from "harfbuzzjs";

/** Open a font buffer. Callers must `close()` or the wasm heap grows for the whole run. */
export function openFont(buffer) {
  const blob = new hb.Blob(buffer);
  const face = new hb.Face(blob);
  const font = new hb.Font(face);
  return {
    face,
    font,
    upem: face.upem,
    close() {
      font.destroy?.();
      face.destroy?.();
      blob.destroy?.();
    },
  };
}

/** Shape one string, always as Polish Latin, with `tags` forced on and nothing else added. */
export function shape(font, text, tags = []) {
  const buffer = new hb.Buffer();
  buffer.addText(text);
  buffer.guessSegmentProperties();
  buffer.setDirection(hb.Direction.LTR); // the enum, not the string: a bad value shapes to nothing
  buffer.setScript("Latn");
  buffer.setLanguage("pl");
  const features = tags.map((t) => hb.Feature.fromString(`${t}=1`)).filter(Boolean);
  hb.shape(font, buffer, features);
  const glyphs = buffer.getGlyphInfosAndPositions();
  buffer.destroy?.();
  return glyphs;
}

/**
 * The ink box of every inked glyph in a shaped run, in run coordinates, and the run's total
 * advance. `inkBox` and `measureConnected` both walk the pen this way.
 *
 * HarfBuzz reports glyph extents with the y axis pointing up and `height` measured from the
 * top downwards, so `height` is negative for every horizontal glyph that has ink. PLAN §5.5
 * rule 2 asks for "width > 0 and height > 0"; the magnitude is what it means.
 */
export function glyphBoxes(font, glyphs) {
  let pen = 0;
  const boxes = [];
  for (const g of glyphs) {
    const e = font.glyphExtents(g.codepoint);
    if (e && e.width !== 0 && e.height !== 0) {
      const x = pen + (g.xOffset ?? 0) + e.xBearing;
      const y = (g.yOffset ?? 0) + e.yBearing;
      boxes.push({
        left: x,
        right: x + e.width,
        top: Math.max(y, y + e.height),
        bottom: Math.min(y, y + e.height),
      });
    }
    pen += g.xAdvance ?? 0;
  }
  return { boxes, advance: pen };
}

/** The ink box of a whole shaped run, or null when nothing in it has ink. */
export function inkBox(font, glyphs) {
  const { boxes, advance } = glyphBoxes(font, glyphs);
  if (boxes.length === 0) return null;
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    right: Math.max(...boxes.map((b) => b.right)),
    top: Math.max(...boxes.map((b) => b.top)),
    bottom: Math.min(...boxes.map((b) => b.bottom)),
    advance,
  };
}

const outlineCache = new WeakMap();

/** A glyph's outline, cached per font: the same gid is asked for many times per run. */
export function outlineOf(font, gid) {
  let cache = outlineCache.get(font);
  if (!cache) {
    cache = new Map();
    outlineCache.set(font, cache);
  }
  if (!cache.has(gid)) cache.set(gid, font.glyphToPath(gid));
  return cache.get(gid);
}

/**
 * What a word actually draws: the outline of each glyph and how far it advances.
 *
 * Deliberately not glyph ids. A feature that swaps one glyph for another that is drawn
 * identically has changed the glyph stream and changed nothing a reader can see; Boldonse's
 * `ss01` in lowercase and Instrument Serif Italic's do exactly that.
 *
 * Deliberately not GPOS placement either — see `effectiveFeatures` in fonts.mjs.
 */
export const drawn = (font, word, feats = []) =>
  shape(font, word, feats)
    .map((g) => `${outlineOf(font, g.codepoint)}@${g.xAdvance ?? 0}`)
    .join(" ");
