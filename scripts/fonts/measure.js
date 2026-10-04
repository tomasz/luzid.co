/**
 * Outline geometry, PLAN §5.5 rule 5: the five traits the outlines can settle, the stroke
 * widths the effects match on, and the reconciliation of measured traits with declared ones.
 * Deterministic over a HarfBuzz font; no files, no network.
 */
import * as hb from "harfbuzzjs";
import { CASE_TRAITS, LETTERS, MEASURED_TRAITS, RowError, WORDS } from "./rules.js";
import { glyphBoxes, shape } from "./shape.js";

const CASE_PAIRS = [
  ["T", "t"],
  ["O", "o"],
  ["M", "m"],
  ["A", "a"],
  ["S", "s"],
  ["Z", "z"],
  ["C", "c"],
  ["U", "u"],
  ["D", "d"],
  ["I", "i"],
  ["Ł", "ł"],
];

/**
 * Whether the lowercase letters are the capitals: `capsOnly` when every pair draws exactly
 * the same glyph, `unicase` when they are cap height but some are drawn differently. Either
 * way `text-transform` stops being worth randomising over, which is what the pipeline uses
 * this for.
 *
 * The single test is that no lowercase letter is meaningfully shorter than its capital.
 * Measured over the catalogue, a bicameral face lands at 0.69 to 0.82 of cap height and a
 * small-caps face at 0.71 to 0.86 — both well clear of the 0.95 line, and both of them
 * cases where case randomisation is worth having.
 *
 * Extents cannot reliably split `capsOnly` from `unicase`: Vina Sans, a caps-only face,
 * redraws three of its eleven lowercase letters a percent or two off, while Syncopate, a
 * true unicase, keeps seven of eleven byte-identical. `reconcileTraits` therefore accepts
 * either label against either finding rather than pretending to a precision it has not got.
 */
function measureCase({ font }) {
  const box = (ch) => font.glyphExtents(font.nominalGlyph(ch.codePointAt(0)));
  let identical = 0;
  let shortest = Number.POSITIVE_INFINITY;
  for (const [upper, lower] of CASE_PAIRS) {
    const u = box(upper);
    const l = box(lower);
    if (!u || !l) continue;
    if (
      u.xBearing === l.xBearing &&
      u.yBearing === l.yBearing &&
      u.width === l.width &&
      u.height === l.height
    ) {
      identical++;
    }
    shortest = Math.min(shortest, Math.abs(l.height) / Math.abs(u.height));
  }
  const unicameral = shortest >= 0.95;
  const capsOnly = unicameral && identical === CASE_PAIRS.length;
  return { capsOnly, unicase: unicameral && !capsOnly };
}

/**
 * A connected script is one whose adjacent letters overlap when shaped.
 *
 * Known limit: this measures ink boxes, not ink, so a face whose letters are drawn as
 * horizontally offset pieces reads as connected even though nothing joins — Rubik Glitch
 * overlaps on all six pairs. The cost is one lost case axis on such a font, and the
 * alternatives are worse: neither `curs` nor the positional features separate them
 * (Licorice and Tagger are connected and have none of them).
 */
function measureConnected({ font, upem }) {
  const { boxes } = glyphBoxes(font, shape(font, WORDS.lowercase[1]));
  const pairs = boxes.length - 1;
  const joined = boxes.slice(1).filter((b, i) => boxes[i].right > b.left + 0.01 * upem).length;
  return pairs > 0 && joined / pairs >= 0.6;
}

const FLATTEN_STEPS = 8;

/** Flatten one glyph outline into polylines, one per contour. */
function contours(font, gid) {
  const out = [];
  let current = null;
  let from = [0, 0];
  const lerp = (a, b, t) => a + (b - a) * t;
  for (const { type, values } of font.glyphToJson(gid)) {
    if (type === "M") {
      if (current && current.length > 2) out.push(current);
      current = [[values[0], values[1]]];
      from = [values[0], values[1]];
    } else if (type === "L") {
      current?.push([values[0], values[1]]);
      from = [values[0], values[1]];
    } else if (type === "Q" || type === "C") {
      const points = [
        from,
        ...Array.from({ length: values.length / 2 }, (_, i) => values.slice(i * 2, i * 2 + 2)),
      ];
      for (let s = 1; s <= FLATTEN_STEPS; s++) {
        const t = s / FLATTEN_STEPS;
        let p = points;
        while (p.length > 1)
          p = p.slice(1).map(([x, y], i) => [lerp(p[i][0], x, t), lerp(p[i][1], y, t)]);
        current?.push(p[0]);
      }
      from = points.at(-1);
    } else if (type === "Z") {
      if (current && current.length > 2) out.push(current);
      current = null;
    }
  }
  if (current && current.length > 2) out.push(current);
  return out;
}

/**
 * Widths of the ink runs a line cuts out of a set of closed contours, by the non-zero
 * winding rule. `axis` 1 scans horizontally at height `at`, 0 scans vertically at `at`.
 *
 * Winding rather than pairing up crossings, because pairing is exactly wrong on the one
 * condition rule 5 goes out of its way to flag: two contours that overlap. Baloo Bhaijaan
 * 2's capital I is two stems overlapping over a third of their height, so every scanline
 * crosses at 65, 65, 240, 240 — paired off that is two runs of zero width, and the stem
 * measures 0.000 em. Accumulating direction gives the one 175-unit stem that is really
 * there, and gives the same answer as pairing on every non-overlapping glyph.
 */
function scanline(rings, at, axis = 1) {
  const along = axis === 1 ? 0 : 1;
  const crossings = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if ((a[axis] - at) * (b[axis] - at) >= 0) continue;
      crossings.push({
        at: a[along] + ((b[along] - a[along]) * (at - a[axis])) / (b[axis] - a[axis]),
        direction: b[axis] > a[axis] ? 1 : -1,
      });
    }
  }
  crossings.sort((p, q) => p.at - q.at);
  const runs = [];
  let winding = 0;
  let start = 0;
  for (const crossing of crossings) {
    if (winding === 0) start = crossing.at;
    winding += crossing.direction;
    if (winding === 0 && crossing.at > start) runs.push(crossing.at - start);
  }
  return runs;
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/**
 * Stem width in em, from the capital I — the one letter that is nothing but a stem.
 *
 * Measured across the outline, not around it: the ink bounding box is not the stem. In an
 * inline, outline or looped-script face the box spans the whole letter while the strokes
 * themselves are hairlines, which is how Bungee Hairline (stem 0.010 em, box 0.318 em) and
 * Rubik Scribble (0.012 vs 0.309) both read as heavyweight if you measure the box.
 *
 * Three scanlines across the middle, widest run on each, median of the three. Widest rather
 * than median-of-all because a textured face — Rubik Burned, Rubik Dirt — is a fat letter
 * with holes punched through it, and pooling every run through the holes makes it look like
 * a hairline. The widest run on a scanline is the stroke itself in both cases.
 */
export function measureStem({ font, upem }) {
  const gid = font.nominalGlyph("I".codePointAt(0));
  const extents = font.glyphExtents(gid);
  if (!extents) return null;
  const top = extents.yBearing;
  const bottom = extents.yBearing + extents.height;
  const rings = contours(font, gid);
  const widest = [0.4, 0.5, 0.6]
    .map((at) => scanline(rings, bottom + (top - bottom) * at))
    .filter((runs) => runs.length > 0)
    .map((runs) => Math.max(...runs));
  return widest.length === 0 ? null : median(widest) / upem;
}

/**
 * The narrowest stroke anywhere in Ł and ł, in em.
 *
 * On these two letters that is the crossbar, and it is the number that decides whether a
 * stroke, an inline or a hollow outline closes the letter up into a blob. Gloock and Rozha
 * One are the shape of the problem: a thick stem with a hairline crossbar, which a stem
 * measurement calls robust and which `outline-hollow` fills in solid.
 *
 * Scanned both ways — a horizontal cut measures an upright stroke, a vertical one measures
 * a flat crossbar — over the middle 90% of each axis, because the outermost slices catch
 * the tapering tip of a curve rather than a stroke. The tenth percentile rather than the
 * minimum for the same reason.
 */
export function measureCrossbar({ font, upem }) {
  const runs = [];
  for (const ch of ["Ł", "ł"]) {
    const gid = font.nominalGlyph(ch.codePointAt(0));
    const extents = font.glyphExtents(gid);
    if (!extents) continue;
    const rings = contours(font, gid);
    const box = {
      1: [extents.yBearing + extents.height, extents.yBearing],
      0: [extents.xBearing, extents.xBearing + extents.width],
    };
    for (const axis of [1, 0]) {
      const [low, high] = box[axis];
      for (let step = 0; step <= 40; step++) {
        const at = low + (high - low) * (0.05 + (0.9 * step) / 40);
        runs.push(...scanline(rings, at, axis));
      }
    }
  }
  if (runs.length === 0) return null;
  runs.sort((a, b) => a - b);
  return runs[Math.floor(runs.length * 0.1)] / upem;
}

function measureHairline(opened) {
  const stem = measureStem(opened);
  // A regular sans sits near 0.08 em and a light weight at 0.055 to 0.07; below 0.05 is a
  // hairline in the sense the effects care about (it cannot carry a stroke or an inline).
  return stem !== null && stem < 0.05;
}

const crosses = (a, b, c, d) => {
  const side = (p, q, r) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
};

/**
 * Whether any two contours of a shipped glyph cross. Read overlap flags are not a usable
 * signal here — almost no upstream sets them — so the geometry is tested directly. This is
 * only a trait for effect matching; `setOverlapFlags` is applied unconditionally regardless.
 */
function measureOverlap({ font }) {
  for (const ch of LETTERS) {
    const rings = contours(font, font.nominalGlyph(ch.codePointAt(0))).map((points) => ({
      points,
      box: points.reduce(
        (b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)],
        [Infinity, Infinity, -Infinity, -Infinity],
      ),
    }));
    for (let i = 0; i < rings.length; i++) {
      for (let j = i + 1; j < rings.length; j++) {
        const [a, b] = [rings[i], rings[j]];
        if (
          a.box[2] < b.box[0] ||
          b.box[2] < a.box[0] ||
          a.box[3] < b.box[1] ||
          b.box[3] < a.box[1]
        )
          continue;
        for (let p = 0; p < a.points.length; p++) {
          for (let q = 0; q < b.points.length; q++) {
            const segA = [a.points[p], a.points[(p + 1) % a.points.length]];
            const segB = [b.points[q], b.points[(q + 1) % b.points.length]];
            if (crosses(segA[0], segA[1], segB[0], segB[1])) return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * The five traits the outlines can settle, as a record so a declaration can be diffed.
 *
 * `axes` is the stop that will ship. It matters: a variable font's default instance is
 * often nowhere near the weight we pin it to, and measuring Big Shoulders at its default
 * rather than at its Black stop calls it a hairline. Measured through a throwaway font so
 * the caller's own font keeps its default variations for feature shaping.
 */
export function measureTraits({ face, upem }, axes = {}) {
  const font = new hb.Font(face);
  // `hb.Variation` instances, not plain objects: setVariations serializes them itself.
  const variations = Object.entries(axes).map(([tag, value]) => new hb.Variation(tag, value));
  if (variations.length > 0) font.setVariations(variations);
  try {
    const { capsOnly, unicase } = measureCase({ font });
    return {
      capsOnly,
      unicase,
      connected: measureConnected({ font, upem }),
      hairline: measureHairline({ font, upem }),
      overlap: measureOverlap({ font }),
    };
  } finally {
    font.destroy?.();
  }
}

/** Every measured trait the row declares that the outlines do not bear out. */
export function traitDisagreements(declared, measured) {
  return MEASURED_TRAITS.filter((trait) => {
    if (!declared.includes(trait)) return false;
    // `capsOnly` and `unicase` are one measurement under two names; see `measureCase`.
    const accepts = CASE_TRAITS.includes(trait) ? CASE_TRAITS : [trait];
    return !accepts.some((t) => measured[t]);
  });
}

/**
 * Merge a source row's traits with the measured ones.
 *
 * A row may declare a measured trait, because a batch file should read as a description of
 * the face and not only as build input. The pipeline measures it anyway and the two have to
 * agree: a curator who believes a font is caps-only when it is not has made an error worth
 * surfacing, so a disagreement is a hard failure rather than a silent override in either
 * direction. Traits the row leaves out are filled in from the measurement.
 */
export function reconcileTraits(id, declared, measured) {
  const wrong = traitDisagreements(declared, measured);
  if (wrong.length > 0) {
    const found = MEASURED_TRAITS.filter((t) => measured[t]);
    throw new RowError(
      id,
      `the source row declares ${wrong.join(", ")}, the outlines measure ${wrong.length > 1 ? "them" : "it"} ` +
        `false (measured: ${found.join(", ") || "none of the five"})`,
    );
  }
  const filled = MEASURED_TRAITS.filter((t) => measured[t]);
  // When the row has already named one of the two case labels, keep its word for it.
  const named = declared.some((t) => CASE_TRAITS.includes(t));
  return [
    ...new Set([...declared, ...(named ? filled.filter((t) => !CASE_TRAITS.includes(t)) : filled)]),
  ].sort();
}
