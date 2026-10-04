/**
 * The font source-row schema and the contract constants the pipeline is built on (PLAN §5.5):
 * one home for both, so the CLI, the tests and the catalog build cannot disagree.
 *
 * The closed vocabularies (traits, archetypes, licence ids, cases) are not defined here. The
 * catalog build validates every font meta against them too, so they live in
 * `scripts/catalog/check.js` and are re-exported from this file.
 */
import { ARCHETYPES, CASES, LICENSE_IDS, TRAITS } from "../catalog/check.js";

export { ARCHETYPES, CASES, LICENSE_IDS, TRAITS };

// ---------------------------------------------------------------- contract constants

/** The 23 code points every shipped file carries: 22 letters plus the space. */
export const TEXT = "TOMASZCUDIŁ tomaszcudił";
export const LETTERS = [...TEXT].filter((c) => c !== " ");

/** The two real words, per `text-transform`. Nothing else is ever shaped or measured. */
export const WORDS = {
  none: ["Tomasz", "Cudziło"],
  uppercase: ["TOMASZ", "CUDZIŁO"],
  lowercase: ["tomasz", "cudziło"],
};

/** Always kept: without these the two words stop shaping correctly (PLAN §5.5 rule 5). */
export const BASE_FEATURES = [
  "kern",
  "liga",
  "clig",
  "calt",
  "rlig",
  "rclt",
  "curs",
  "ccmp",
  "locl",
  "mark",
  "mkmk",
  "rvrn",
];

/** Case-like: kept only when every letter including Ł/ł changes (PLAN §5.5 rule 4). */
export const CASE_FEATURES = ["smcp", "c2sc", "unic", "titl"];

/**
 * Never candidates. `aalt` is an index of all alternates rather than a look, and the
 * numeric and positional features only bloat the glyph closure with junk forms of our
 * letters (superiors, inferiors, fractions) that the two words can never select.
 */
export const FEATURE_DENY = new Set([
  "aalt",
  "sups",
  "subs",
  "sinf",
  "ordn",
  "numr",
  "dnom",
  "frac",
  "lnum",
  "onum",
  "pnum",
  "tnum",
  "vert",
  "vrt2",
  "vkrn",
  "valt",
  "vhal",
  "halt",
  "size",
  "cpsp",
]);

/**
 * Traits the pipeline measures from the outlines. A source row may still declare one — a
 * reader of a batch file should be able to see that a face is caps-only without building
 * it — but the two have to agree; see `reconcileTraits`.
 */
export const MEASURED_TRAITS = ["capsOnly", "unicase", "connected", "hairline", "overlap"];

/** The two labels for one measurement: the lowercase letters are the capitals. */
export const CASE_TRAITS = ["capsOnly", "unicase"];

/** The §5.5 source-row keys. Anything else the pipeline needs is found by id instead. */
const ROW_KEYS = new Set([
  "id",
  "family",
  "url",
  "sha256",
  "licenseId",
  "licenseUrl",
  "copyright",
  "archetype",
  "traits",
  "odds",
  "stops",
  "features",
  "cases",
]);

export const BUDGET_BYTES = 10_500;
export const MAX_VARIANTS = 12;
export const MAX_STOPS = 4;

// ---------------------------------------------------------------- source rows

/** A hard failure of one row. `reason` is the message without the id in front of it. */
export class RowError extends Error {
  constructor(id, reason) {
    super(`${id}: ${reason}`);
    this.id = id;
    this.reason = reason;
  }
}

const fail = (id, message) => {
  throw new RowError(id, message);
};

/** Kebab-case: the form of a row id and of a stop id, which both end up in filenames. */
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The §5.5 source-row schema. Every rule is a hard failure naming the row. */
export function validateRow(row) {
  const id = row?.id ?? "<no id>";
  for (const key of Object.keys(row)) if (!ROW_KEYS.has(key)) fail(id, `unknown key ${key}`);
  if (!KEBAB.test(row.id ?? "")) fail(id, "id must be kebab-case");
  for (const key of ["family", "url", "licenseId", "licenseUrl", "copyright"]) {
    if (typeof row[key] !== "string" || row[key].length === 0) fail(id, `missing ${key}`);
  }
  if (typeof row.sha256 !== "string" || !/^([0-9a-f]{64})?$/.test(row.sha256)) {
    fail(id, "sha256 must be 64 lowercase hex characters, or empty to be filled on first run");
  }
  for (const key of ["url", "licenseUrl"]) {
    const url = row[key];
    if (!url.startsWith("https://")) fail(id, `${key} must be https`);
    // The css2 API and its CDN strip ssNN/salt/swsh/dlig (google/fonts#1335).
    if (/fonts\.(googleapis|gstatic)\.com|css2\?/.test(url))
      fail(id, `${key}: the Google css2 API is never a source`);
    if (/\.(zip|tar|tgz|gz)(\?|$)/i.test(url))
      fail(id, `${key}: a source must be a file, never a zip`);
    // A mutable ref would make the pinned sha256 meaningless.
    if (/\/(main|master|HEAD|latest)\//.test(url)) fail(id, `${key} uses a mutable ref`);
    if (/^https:\/\/(raw\.githubusercontent\.com|gitlab\.com)\//.test(url) && !pinnedToCommit(url))
      fail(id, `${key} lacks a full 40-character commit sha`);
  }
  if (!/\.(ttf|otf|ttc)$/i.test(row.url)) fail(id, "url must be a .ttf, .otf or .ttc file");
  if (!LICENSE_IDS.has(row.licenseId)) fail(id, `licenseId ${row.licenseId} is not allowed`);
  if (!Array.isArray(row.archetype) || row.archetype.length === 0)
    fail(id, "archetype must be a non-empty array");
  for (const a of row.archetype) if (!ARCHETYPES.has(a)) fail(id, `unknown archetype ${a}`);
  if (!Array.isArray(row.traits) || row.traits.length === 0)
    fail(id, "traits must be a non-empty array");
  // A measured trait is allowed here and checked against the outlines by `reconcileTraits`.
  for (const t of row.traits) if (!TRAITS.has(t)) fail(id, `unknown trait ${t}`);
  if (new Set(row.traits).size !== row.traits.length) fail(id, "duplicate traits");
  if (!Number.isInteger(row.odds) || row.odds < 0 || row.odds > 16)
    fail(id, "odds must be an integer 0-16");
  if (row.stops !== undefined) {
    if (!Array.isArray(row.stops) || row.stops.length === 0)
      fail(id, "stops must be a non-empty array");
    if (row.stops.length > MAX_STOPS)
      fail(id, `at most ${MAX_STOPS} stops, got ${row.stops.length}`);
    // The stop id becomes the shipped filename, so it has to be present and unique; every
    // stop pins the same axes, or the pipeline cannot instance them alike.
    const ids = new Set();
    const axesOf = (stop) =>
      Object.keys(stop)
        .filter((k) => k !== "id")
        .sort()
        .join(",");
    for (const stop of row.stops) {
      if (!KEBAB.test(stop.id ?? "")) fail(id, `stop id ${stop.id} must be kebab-case`);
      if (ids.has(stop.id)) fail(id, `duplicate stop id ${stop.id}`);
      ids.add(stop.id);
      if (axesOf(stop) === "") fail(id, `stop ${stop.id} pins no axis`);
      if (axesOf(stop) !== axesOf(row.stops[0]))
        fail(id, `stop ${stop.id} pins [${axesOf(stop)}], expected [${axesOf(row.stops[0])}]`);
      for (const [tag, value] of Object.entries(stop)) {
        if (tag === "id") continue;
        if (!/^[A-Za-z]{4}$/.test(tag)) fail(id, `${tag} is not a 4-letter axis tag`);
        if (!Number.isFinite(value)) fail(id, `stop ${stop.id}: ${tag} must be a finite number`);
      }
    }
  }
  if (row.features !== undefined) {
    if (!Array.isArray(row.features) || row.features.length === 0)
      fail(id, "features must be a non-empty array");
    for (const f of row.features)
      if (!/^[a-z0-9]{4}$/.test(f)) fail(id, `${f} is not an OpenType feature tag`);
    if (new Set(row.features).size !== row.features.length) fail(id, "duplicate features");
  }
  if (row.cases !== undefined) {
    if (!Array.isArray(row.cases) || row.cases.length === 0)
      fail(id, "cases must be a non-empty array");
    for (const c of row.cases) if (!CASES.has(c)) fail(id, `unknown case ${c}`);
    if (new Set(row.cases).size !== row.cases.length) fail(id, "duplicate cases");
  }
  // Case randomisation is invisible on a caps-only face, and joining scripts break apart
  // when set in capitals.
  if (row.traits.includes("capsOnly") && row.cases?.join() !== "none")
    fail(id, 'capsOnly must set cases ["none"]');
  if (row.traits.includes("connected") && (!row.cases || row.cases.includes("uppercase")))
    fail(id, "a connected script must declare cases without uppercase");
  return row;
}

/**
 * PLAN §5.5 rule 1: a source with no immutable commit behind it — GUST on CTAN, a foundry
 * download — has to ship the original too, because the hash alone cannot reproduce the
 * build once the file moves. A full 40-character hash somewhere in the path is what makes
 * a raw URL immutable; the host is not the point, and GitHub, GitLab, Codeberg and
 * sourcehut all spell the rest of it differently.
 */
export const pinnedToCommit = (url) => /^https:\/\/[^/]+\/\S*\/[0-9a-f]{40}\//.test(url);

/**
 * Where a committed original lives, and where extra licence material to append to it lives
 * (the upstream MANIFEST that rule 8 asks for on GUST fonts). Both are found by id rather
 * than named in the row: the source-row schema is fixed by §5.5 and shared with every other
 * batch, and a file that has to exist under a known name does not also need declaring.
 */
export const upstreamPaths = (row) => ({
  original: `${row.id}${(row.url.match(/\.(otf|ttf|ttc)(\?|$)/i) ?? [".ttf"])[0].toLowerCase()}`,
  notice: `${row.id}.notice.txt`,
});

/**
 * A source row's stop is `{id, ...axes}` — the curator names it, because the name ends up
 * in the shipped filename and `w900x` reads better than `wght900-wdth200`. A font with no
 * axes has one implicit stop, `static`.
 */
export function stopsOf(row) {
  return (row.stops ?? [{}]).map((stop) => {
    const { id, ...axes } = stop;
    return { id: id ?? "static", axes };
  });
}

/** Row ids name the shipped files, so two rows with one id would overwrite each other. */
export function assertUniqueIds(rows) {
  const ids = new Set();
  for (const row of rows) {
    if (ids.has(row.id)) fail(row.id, "duplicate id");
    ids.add(row.id);
  }
}

/**
 * The cases worth randomising over, given what the outlines measure. Case is invisible on a
 * caps-only or unicase face, and a joining script breaks apart when set in capitals.
 */
export function casesFor(row, { capsOnly, unicase, connected }) {
  if (capsOnly || unicase) return ["none"];
  const cases = row.cases ?? ["none", "uppercase", "lowercase"];
  return connected ? cases.filter((c) => c !== "uppercase") : cases;
}
