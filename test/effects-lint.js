/**
 * What `data/effects.test.js` (the lint and the grid hashes) and `data/bleed.test.js` (the
 * static ink scan) both need: the effects themselves, one parameter grid, one metrics object,
 * and one reader for the CSS an effect emits.
 *
 * `parse()` deliberately only understands a flat list of style rules. Effects never write
 * an at-rule: `@media`, `@supports` and the reduced-motion nesting all belong to
 * `render.js`, which is what makes the accessibility gate provable.
 */
import assert from "node:assert/strict";
import { glob } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");

const files = [];
for await (const f of glob("effects/*.js", { cwd: root })) files.push(f);
files.sort();

/** Every effect file, sorted by path: `{file, id, fx}`. */
export const effects = await Promise.all(
  files.map(async (file) => ({
    file,
    id: basename(file, ".js"),
    fx: (await import(pathToFileURL(resolve(root, file)).href)).default,
  })),
);

// The catalog build checks every effect at every grid point too, so the grid, the metrics
// and the hover call have one home there.
export { grid, hoverOf, METRICS } from "../scripts/catalog/check.js";

/** Split on `sep` at paren depth 0. */
export function topSplit(s, sep) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

/** @returns {{sel: string[], decls: [string, string][]}[]} */
export function parse(css, where) {
  assert.equal(
    /@[a-z-]/i.test(css),
    false,
    `${where}: effects never write an at-rule; render.js owns those`,
  );
  const rules = [];
  let covered = 0;
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    assert.equal(
      m.index,
      covered,
      `${where}: stray text outside a rule near "${css.slice(covered, covered + 40)}"`,
    );
    covered = m.index + m[0].length;
    rules.push({
      sel: topSplit(m[1], ","),
      decls: topSplit(m[2], ";").map((d) => {
        const i = d.indexOf(":");
        assert.ok(i > 0, `${where}: malformed declaration "${d}"`);
        return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
      }),
    });
  }
  assert.equal(covered, css.length, `${where}: trailing text after the last rule`);
  return rules;
}

/**
 * The leading lengths of one shadow layer (`x y blur …`), in u, stopping at the first
 * token that is not a length the helpers write (`0`, `calc(k*var(--u))`, or
 * `calc(k*cos|sin(a deg)*var(--u))`). Tests may use Math; src/ may not.
 */
export function shadowLengths(layer) {
  const out = [];
  for (const part of topSplit(layer, " ")) {
    const v = length(part);
    if (v === null) break;
    out.push(v);
  }
  return out;
}

function length(t) {
  if (t === "0") return 0;
  let m = t.match(/^calc\(\s*(-?[\d.]+)\s*\*\s*var\(--u\)\s*\)$/);
  if (m) return Number(m[1]);
  m = t.match(
    /^calc\(\s*(-?[\d.]+)\s*\*\s*(cos|sin)\(\s*(-?[\d.]+)deg\s*\)\s*\*\s*var\(--u\)\s*\)$/,
  );
  if (m) {
    const rad = (Number(m[3]) * Math.PI) / 180;
    return Number(m[1]) * (m[2] === "cos" ? Math.cos(rad) : Math.sin(rad));
  }
  return null;
}
