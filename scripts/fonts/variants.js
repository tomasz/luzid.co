/**
 * PLAN §5.5 rules 4 and 7: which feature tags are worth a variant, which variants a font
 * ships, and the ladder that sheds them when a file comes back over budget. Deterministic
 * over a HarfBuzz font; no files, no network.
 */
import {
  BASE_FEATURES,
  CASE_FEATURES,
  FEATURE_DENY,
  MAX_VARIANTS,
  RowError,
  WORDS,
} from "./rules.js";
import { drawn, outlineOf, shape } from "./shape.js";

/** Rule 7's failure, the one the ladder in `shedToBudget` may recover from. */
export class BudgetError extends RowError {}

/** GSUB tags this font actually has, minus the base set and the junk list. */
export function candidateFeatures(face, allowed) {
  const tags = [...new Set(face.getTableFeatureTags("GSUB"))]
    .filter((t) => !BASE_FEATURES.includes(t) && !FEATURE_DENY.has(t))
    .sort();
  return allowed ? tags.filter((t) => allowed.includes(t)) : tags;
}

/** `drawn` for a run that is already shaped, so one shaping serves both comparisons below. */
const drawnRun = (font, glyphs) =>
  glyphs.map((g) => `${outlineOf(font, g.codepoint)}@${g.xAdvance ?? 0}`).join(" ");

/**
 * PLAN §5.5 rule 4. Shape both words with the tag off and with it on; keep the tag only if
 * the glyph and position stream really differs. Case-like tags additionally have to change
 * every letter, Ł and ł included, or they are a partial small-caps that looks like a bug.
 *
 * Each word is shaped once plain and once per tag, and both tests read those same runs.
 */
export function effectiveFeatures(font, caseName, candidates) {
  const plain = WORDS[caseName].map((word) => {
    const glyphs = shape(font, word);
    return { word, glyphs, drawn: drawnRun(font, glyphs) };
  });
  const kept = [];
  for (const tag of candidates) {
    let differs = false;
    let everyLetter = true;
    for (const { word, glyphs: before, drawn: plainDrawn } of plain) {
      const after = shape(font, word, [tag]);
      if (plainDrawn !== drawnRun(font, after)) differs = true;
      if (before.length !== after.length) {
        everyLetter = false;
      } else {
        for (let i = 0; i < before.length; i++) {
          const same = outlineOf(font, before[i].codepoint) === outlineOf(font, after[i].codepoint);
          if (same) everyLetter = false;
        }
      }
    }
    if (!differs) continue;
    if (CASE_FEATURES.includes(tag) && !everyLetter) continue;
    kept.push(tag);
  }
  return kept;
}

/**
 * Drop feature tags whose variant would shape the two words exactly like a variant that is
 * already being kept. Rule 4's on-versus-off test only ever compares a tag against plain
 * text, which lets three kinds of duplicate through, all of them seen in the batches:
 *
 *  - alias tags. `salt` and `ss01` are the same substitution in Playball, Moon Dance,
 *    Tagger and four of batch A, so both passed the on-versus-off test and shipped
 *    byte-identical files under two names;
 *  - a tag that only repeats what `text-transform` has already done;
 *  - `uppercase` + `c2sc` against `lowercase` + `smcp`, which arrive at the same small
 *    caps from opposite directions, so any font carrying both shipped a guaranteed pair;
 *  - and a feature that selects the same glyphs with the same advances and only moves them
 *    with a GPOS placement, which is the same question with the position dropped.
 *
 * That last one is why `drawn` leaves placement out. The fit normalises to the ink box —
 * the box top is pinned to the block top, the box width sets the font size — so moving the
 * whole word up, down or sideways is normalised straight back out, and what survives is at
 * most a per-glyph jitter nobody asked for.
 *
 * Bungee's `ss12` is the case that proved it: identical glyph ids, identical outlines and
 * identical advances to `ss01`, differing only by a y-placement of about -0.208 em. It
 * shipped as a separate variant that renders the same as `ss01` once fitted — and engines
 * disagree about it. Measuring the ink top of line 1 against the box top at 390x844 gives
 * -0.10 px on Firefox and Darwin WebKit, -1.11 px on Chromium, and -27.11 px on Linux
 * WebKit. That is 2.025x the shift, not the 1.0x of ignoring it: Linux WebKit applies the
 * placement with the opposite sign, and the name lands 12 px off centre there.
 *
 * x and y are treated alike, which is a choice rather than an assumption about symmetry.
 * Under the fit they really are symmetric — `W` is an ink width exactly as `top` is an ink
 * top, so both normalise away the absolute offset and expose only the relative arrangement.
 * What is not symmetric is the risk: a y-placement is the rare path engines get wrong, an
 * x-placement is the everyday kerning path they agree on. Rejecting both is the
 * conservative reading and costs nothing measurable — across the 692 variants in the
 * library there is exactly one placement-only pair, Bungee's, and no x-only pair at all.
 *
 * The plain variant of every case is seeded first and therefore always wins. After that the
 * order follows `planVariants` — round by round, cases in their given order — so the tag
 * that survives a collision is the one whose variant would have come first anyway.
 */
export function dedupeCombos(font, cases, featuresByCase) {
  const shaped = (caseName, feats) =>
    WORDS[caseName].map((word) => drawn(font, word, feats)).join(" | ");
  const seen = new Set(cases.map((c) => shaped(c, [])));
  const kept = Object.fromEntries(cases.map((c) => [c, []]));
  const rounds = Math.max(0, ...cases.map((c) => featuresByCase[c].length));
  for (let round = 0; round < rounds; round++) {
    for (const caseName of cases) {
      const tag = featuresByCase[caseName][round];
      if (tag === undefined) continue;
      const key = shaped(caseName, [tag]);
      if (seen.has(key)) continue;
      seen.add(key);
      kept[caseName].push(tag);
    }
  }
  return kept;
}

const CASE_SHORT = { none: "n", uppercase: "u", lowercase: "l" };

/**
 * Case × effective feature sets × stops, capped at `MAX_VARIANTS`. Built round by round so
 * that trimming loses the most decorated variants first and every case keeps its plain one.
 */
export function planVariants({ cases, featuresByCase, stops }) {
  const rounds = Math.max(...cases.map((c) => featuresByCase[c].length + 1));
  const out = [];
  for (let round = 0; round < rounds; round++) {
    for (const caseName of cases) {
      const feats = round === 0 ? [] : featuresByCase[caseName].slice(round - 1, round);
      if (round > 0 && feats.length === 0) continue;
      for (const [index, stop] of stops.entries()) {
        if (out.length >= MAX_VARIANTS) return out;
        out.push({
          id: `${CASE_SHORT[caseName]}-${feats.length ? feats.join("-") : "base"}-${stop.id}`,
          case: caseName,
          feats,
          stop: index,
        });
      }
    }
  }
  return out;
}

/**
 * PLAN §5.5 rule 7's ladder. Run `attempt`; if it comes back over budget, shed the last
 * effective feature of every case, then whole stops, then give up and let the font be
 * dropped. Anything that is not a budget failure propagates untouched.
 *
 * `attempt` has to be the *whole* build, down to weighing the packed file, or the ladder
 * never runs: the budget is only knowable at the last step, so a build that stops short of
 * it and weighs the file afterwards throws from outside the `try` and takes the batch down
 * with it. That is precisely what used to happen, and it is why this is one function with
 * the attempt passed in rather than a loop wrapped around part of the work.
 */
export async function shedToBudget({ id, cases, featuresByCase, stops, log = () => {} }, attempt) {
  const state = { featuresByCase: { ...featuresByCase }, stops };
  for (;;) {
    try {
      return await attempt(state);
    } catch (error) {
      if (!(error instanceof BudgetError)) throw error;
      const over = error.reason;
      if (cases.some((c) => state.featuresByCase[c].length > 0)) {
        for (const c of cases) state.featuresByCase[c] = state.featuresByCase[c].slice(0, -1);
        log(`${id}: ${over}; dropped the last effective feature`);
        continue;
      }
      if (state.stops.length > 1) {
        state.stops = state.stops.slice(0, -1);
        log(`${id}: ${over}; dropped a stop`);
        continue;
      }
      throw new RowError(id, `${over} with nothing left to trim — drop the font`);
    }
  }
}
