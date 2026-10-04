/**
 * Licence handling, PLAN §5.5 rules 3 and 8: which names an upstream licence reserves, the
 * neutral name a subset ships under when it reserves any, the name-table rewrite and its
 * lint, and the text of `fonts/licenses/<id>.txt`. Strings and name records only: no fonts,
 * no files, no network.
 */
import { hash } from "node:crypto";
import { RowError } from "./rules.js";

const sha256 = (data) => hash("sha256", data);
const fail = (id, message) => {
  throw new RowError(id, message);
};

// ---------------------------------------------------------------- rule 3: reserved names

/**
 * The OFL's own definition of "Reserved Font Name" appears in the body of every OFL 1.1
 * text, so a whole-file search matches every OFL font there is. Only the copyright block
 * above the licence proper is read — everything before the first rule of dashes — plus
 * name ID 0 of the binary, which is where a declaration the licence file forgot shows up
 * (Oleo Script's table reserves "Oleo", Molle's reserves "Spinnaker").
 */
export const licenseHeader = (licenseText) => String(licenseText ?? "").split(/\n-{5,}/)[0];

/** Straight, typographic and guillemet quotes: OFL headers in the wild use all of them. */
const QUOTES = "\"“”‘’«»„'";

/**
 * The names one `with Reserved Font Name …` clause reserves.
 *
 * Quoted is the common form and the only unambiguous one, so a clause with any quoted run
 * is read as quoted runs alone. Unquoted (Galada: `with Reserved Font Name Lobster.`) is
 * read as words up to the first sentence-ending punctuation, split on `and` and commas.
 */
function reservedNamesInClause(clause) {
  const quoted = [...clause.matchAll(new RegExp(`[${QUOTES}]([^${QUOTES}\n]+)[${QUOTES}]`, "g"))];
  if (quoted.length > 0) return quoted.map((m) => m[1].trim()).filter(Boolean);
  const bare = clause.match(/^\s*([A-Za-z0-9][A-Za-z0-9+-]*(?:\s+[A-Za-z0-9][A-Za-z0-9+-]*)*)/);
  if (!bare) return [];
  return bare[1]
    .split(/\s+and\s+|\s*,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const RFN_CLAUSE = /Reserved\s+Font\s+Names?(?:\(s\))?\s*[:,-]?\s*([^\n]*)/gi;

/**
 * The two sentences of the OFL body that contain the phrase without declaring anything:
 * `"Reserved Font Name" refers to any names specified as such…` and `…may not use the
 * Reserved Font Name(s) unless explicit written permission is granted`.
 *
 * The header split normally keeps both out of reach. This is the second line of defence,
 * for a licence file that has no rule of dashes to split on at all — reading the OFL's own
 * definition as a declaration would rename a font that reserves nothing.
 */
const RFN_DEFINITION = new RegExp(`^[\\s${QUOTES}]*(?:refers\\s+to|unless\\b)`, "i");

/**
 * PLAN §5.5 rule 3. Every name the licence header and name ID 0 reserve, deduplicated and
 * compared case-insensitively. `[]` means the font reserves nothing and ships untouched.
 *
 * A clause the parser cannot read a name out of is a hard failure rather than an empty
 * array: silently shipping an unrenamed Modified Version is the one outcome the rule exists
 * to prevent, and a licence header this pipeline cannot parse is a font a human should look
 * at before it goes anywhere near the catalogue.
 */
export function reservedFontNames(licenseText, copyrightName = "") {
  const names = [];
  let declared = false;
  for (const text of [licenseHeader(licenseText), String(copyrightName ?? "")]) {
    for (const [, clause] of text.matchAll(RFN_CLAUSE)) {
      if (RFN_DEFINITION.test(clause)) continue;
      declared = true;
      names.push(...reservedNamesInClause(clause));
    }
  }
  if (declared && names.length === 0) {
    throw new Error("the licence declares a Reserved Font Name the parser cannot read");
  }
  const seen = new Map();
  for (const name of names) if (!seen.has(squash(name))) seen.set(squash(name), name);
  return [...seen.values()];
}

// ---------------------------------------------------------------- rule 3: renaming

/** The comparison the OFL cares about: case and spacing are not what makes a name distinct. */
export const squash = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");

/**
 * Name IDs that must keep carrying attribution, and are therefore the only ones exempt from
 * the lint below: 0 is the copyright, 13 the licence text and 14 the licence URL. The OFL
 * FAQ 2.4 asks for exactly these to survive a subset, and renaming is a requirement of the
 * licence rather than a way to obscure who drew the font.
 */
export const ATTRIBUTION_NAME_IDS = [0, 13, 14];

/**
 * A neutral internal family name: `LZ` and six hex digits derived from the font id. It is
 * not the CSS family — `src/render.js` already serves every face as `f` — but the name a
 * font manager, a PDF and `document.fonts` will show, and the OFL requires it to share
 * nothing with the reserved name.
 *
 * Six hex digits can spell a word (`facade`, `decade`), so a collision with a reserved name
 * re-rolls with a salt rather than failing. Deterministic in the id, so the same font
 * rebuilds to the same bytes, and recomputable from the metadata: `neutralName(meta.id,
 * [meta.family, ...meta.rfn])`.
 */
export function neutralName(id, forbidden = []) {
  const words = forbidden.map(squash).filter(Boolean);
  for (let salt = 0; salt < 64; salt++) {
    const hex = sha256(salt === 0 ? id : `${id}#${salt}`)
      .slice(0, 6)
      .toUpperCase();
    const name = `LZ ${hex}`;
    if (!words.some((w) => squash(name).includes(w))) return name;
  }
  throw new Error(`${id}: every neutral name collides with a reserved one`);
}

/**
 * Rewrite a subset's name records onto the neutral name.
 *
 * What survives: 0, 13 and 14 verbatim (attribution), and the six records an engine needs
 * to identify a face at all — 1 family, 2 subfamily, 3 unique id, 4 full name, 5 version,
 * 6 PostScript name. Everything else goes, which on a `subset-font` output is nothing:
 * hb-subset keeps name IDs 0-6 plus whatever `preserveNameIds` adds, so 16/17/21/22/25 and
 * the `ssNN` feature names above 255 are already gone by the time this runs.
 *
 * The version keeps only its number. Upstream version strings routinely embed the family
 * name ("Lobster Version 2.000") and the full string is in `fonts/licenses/<id>.txt` in the
 * change notice regardless, so nothing is lost by carrying the number alone.
 */
export function renameRecords(records, { name, version }) {
  // A PostScript name may not contain a space, `(`, `)`, `[`, `]`, `{`, `}`, `<`, `>`,
  // `/`, `%` or any character outside 33-126 (OpenType `name`, name ID 6).
  const written = new Map([
    [1, name],
    [2, "Regular"],
    [3, name],
    [4, name],
    [5, version],
    [6, name.replace(/\s+/g, "")],
  ]);
  const out = [];
  for (const record of records) {
    // A language-tag record belongs to a format 1 table, which `writeNames` does not emit.
    if (record.languageID >= 0x8000) continue;
    if (ATTRIBUTION_NAME_IDS.includes(record.nameID)) out.push(record);
    else if (written.has(record.nameID)) out.push({ ...record, text: written.get(record.nameID) });
  }
  // A record the subset did not carry still has to exist, on the platform everything reads.
  for (const [nameID, text] of written) {
    if (!out.some((r) => r.nameID === nameID)) {
      out.push({ platformID: 3, encodingID: 1, languageID: 0x409, nameID, text });
    }
  }
  return out;
}

/**
 * PLAN §5.5 rule 3's lint. No name record but the three that carry attribution may contain
 * the upstream family name or any reserved word, compared with case and spacing ignored.
 */
export function lintNames(id, records, forbidden) {
  const words = forbidden.map((w) => [w, squash(w)]).filter(([, w]) => w);
  for (const record of records) {
    if (ATTRIBUTION_NAME_IDS.includes(record.nameID)) continue;
    for (const [word, squashed] of words) {
      if (squash(record.text).includes(squashed)) {
        fail(
          id,
          `name ${record.nameID} "${record.text}" still contains the reserved name "${word}"`,
        );
      }
    }
  }
  return records.length;
}

// ---------------------------------------------------------------- rule 8: the licence file

/** PLAN §5.5 rule 8. Satisfies Apache §4(b) and LPPL §6; the licence file starts with it. */
export const changeNotice = (family, version, url) =>
  `Modified by luzid.co: 23-glyph subset of ${family} ${version}; hinting removed; ` +
  `vertical metrics changed. Original: ${url}`;

/** The version number out of name ID 5, as the change notice and the rename carry it. */
export const upstreamVersion = (name5) =>
  (name5?.match(/Version\s+[\d.]+/) ?? ["unknown version"])[0];

/** Rule 8 credits a copyright holder, so a font with none in its licence or name 0 stops. */
export function assertCopyright(id, license, name0) {
  if (!/Copyright|Prawa autorskie|©/i.test(license + name0))
    fail(id, "no copyright statement found");
}

/** `fonts/licenses/<id>.txt`: the change notice, name ID 0, the licence, then any notices. */
export const licenseFile = ({ notice, name0, license, extras }) =>
  [notice, "", `Upstream copyright: ${name0}`, "", license, ...extras].join("\n");
