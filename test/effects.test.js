/**
 * The effect lint (§5.6), run over every file in `effects/`, and the grid hashes that pin
 * what every effect emits.
 *
 * It is a unit test rather than a lint rule because the thing being checked is the CSS an
 * effect *emits*, at every point of its parameter grid — not the JS that emits it.
 *
 * **Grid hashes** (`test/golden/effects/<id>.sha256`). They make "this refactor left every
 * effect byte-identical" a one-line check: `git status --porcelain test/golden/effects/`.
 * To reproduce one by hand:
 *
 *  1. The grid is every value the engine can draw (`step()` in `src/rand.js`): per param
 *     `[min, max, step]`, `n = Math.floor((max - min) / step) + 1` values
 *     `round4(min + i * step)` for `i = 0 … n-1`.
 *  2. Combinations are enumerated with param names sorted by code unit; the first name is
 *     the outermost loop and the last name varies fastest. `plain` has one: `{}`.
 *  3. Each combination `p` appends four lines, each ending in `\n`:
 *     `JSON.stringify(p)` (keys in sorted order), the bleed as `t r b l` joined by spaces,
 *     `css(p, helpers, METRICS)`, and `hover(p, helpers, METRICS)` (empty when `hover` is
 *     null). `bleed` is called as `bleed(p, METRICS)`.
 *  4. The file holds the lowercase hex sha256 of that UTF-8 string, then `\n`.
 *
 * `METRICS` below is the fixed metrics object for all three calls. Changing it, or this
 * recipe, moves all 30 hashes at once. `vp test -u` rewrites the files after an intended
 * change; say which effects moved and why in the PR.
 *
 * `parse()` deliberately only understands a flat list of style rules. Effects never write
 * an at-rule: `@media`, `@supports` and the reduced-motion nesting all belong to
 * `render.js`, which is what makes the accessibility gate provable.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { glob } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import { pathToFileURL } from "node:url";
import { helpers } from "../src/helpers.js";
import { round4 } from "../src/rand.js";

const root = resolve(import.meta.dirname, "..");

/** §5.5: adding a trait is a `contract` PR, so the enum is closed. */
const TRAITS = new Set(
  `serif sans slab script brush blackletter deco rounded unicase mono fat hairline condensed wide
   inline shaded stencil soft groovy connected capsOnly overlap jp`.split(/\s+/),
);

const SELECTOR = /^(\.n|\.l|\.l1|\.l2)(::(before|after))?$/;

/** The one way a shape-B effect copies the text (§5.6): visible ink, empty accessible name. */
const COPY = 'attr(data-t) / ""';

/** Properties allowed on `.n` / `.l` / `.l1` / `.l2`. */
const PROPS = [
  /^color$/,
  /^background(-[a-z]+)*$/,
  /^-webkit-background-clip$/,
  /^text-shadow$/,
  /^-webkit-text-stroke(-[a-z]+)?$/,
  /^-webkit-text-fill-color$/,
  /^paint-order$/,
  /^filter$/,
  /^opacity$/,
  /^mix-blend-mode$/,
  /^clip-path$/,
  /^mask(-[a-z]+)*$/,
  /^text-decoration(-[a-z]+)*$/,
  /^text-emphasis(-[a-z]+)*$/,
];
/** Pseudo-elements may additionally place and stack themselves. */
const PSEUDO_PROPS = [
  /^content$/,
  /^transform$/,
  /^translate$/,
  /^scale$/,
  /^rotate$/,
  /^z-index$/,
];
/** Hover feedback may move the whole block; the transition itself is renderer-owned. */
const HOVER_PROPS = [/^translate$/, /^scale$/, /^rotate$/];

/** Any unit that is not `u`. Time and angle units are fine; lengths are not. */
const BAD_UNIT =
  /(?<![a-z0-9#_-])\d*\.?\d+(px|r?em|ex|ch|ic|lh|rlh|v[wh]|v(min|max|i|b)|[sdl]v[wh]|cq[a-z]+|cm|mm|Q|in|pt|pc)\b/i;
const ROLE_VARS = new Set(["--bg", "--fg", "--a1", "--a2", "--u", "--y", "--bh", "--m"]);

/**
 * The value grammar, stated positively: a value may hold numbers, role variables, and the
 * functions and keywords below — anything else fails, so a named colour (`red`), a hex or
 * `rgb(…)` cannot slip through the way they could past a list of bad patterns. Colours come
 * from role variables, `color-mix()` of them, or a relative colour of one
 * (`oklch(from var(--fg) l c h)`). Extend a list when an effect genuinely needs a new word.
 */
const FUNCTIONS = new Set(
  `var calc cos sin color-mix attr linear-gradient drop-shadow blur brightness contrast saturate
   scaley skewx translatey`.split(/\s+/),
);
const COLOR_FUNCTIONS = new Set(`rgb rgba hsl hsla hwb lab lch oklab oklch color`.split(" "));
const KEYWORDS = new Set(
  // `in oklab`: color-mix's interpolation space. `from` and the channel names: relative colours.
  `transparent currentcolor in oklab from r g b h s l w c alpha stroke fill no-repeat text
   data-t`.split(/\s+/),
);

/** The first token of `value` outside the grammar above, or null. */
function offGrammar(value) {
  // url() is checked on its own (data: only) and strings are content, not values.
  const v = value.replace(/url\([^)]*\)/g, " ").replace(/"[^"]*"|'[^']*'/g, " ");
  for (const m of v.matchAll(/#\w+|-?(?:\d*\.)?\d+[a-z%]*|--[\w-]+|(-?[a-z][\w-]*)(\(?)/gi)) {
    if (m[0].startsWith("#")) return m[0];
    if (!m[1]) continue; // a number or a custom property (role vars are checked separately)
    const word = m[1].toLowerCase();
    if (m[2]) {
      const relative =
        COLOR_FUNCTIONS.has(word) && /^\s*from\s+var\(--/.test(v.slice(m.index + m[0].length));
      if (!FUNCTIONS.has(word) && !relative) return `${m[1]}()`;
    } else if (!KEYWORDS.has(word)) return m[1];
  }
  return null;
}

/** Palette prefer-tokens: polarity, colour count, tier, or a source / id prefix (`pick.js`). */
const PREFER_TOKEN = /^(dark|light|n[234]|historical|editorial|era-approx|[a-z0-9-]+)$/;

/** Split on `sep` at paren depth 0. */
function topSplit(s, sep) {
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
function parse(css, where) {
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
 * The shared body of the lint: everything that applies to any CSS an effect emits.
 * `mode` is `'css'` or `'hover'`; hover declarations arrive without a selector.
 */
function lintCss(css, where, { mode }) {
  // :hover / :active live in hover(), which returns declarations only — the renderer owns
  // the selector. So no CSS an effect emits ever carries an interaction pseudo-class.
  assert.equal(
    /:(hover|active|focus)/.test(css),
    false,
    `${where}: interaction selectors belong in hover()`,
  );
  const rules =
    mode === "hover"
      ? [{ sel: [".n"], decls: parse(`.n{${css}}`, where)[0].decls }]
      : parse(css, where);
  let hardLayers = 0;
  let blurLayers = 0;
  let dropShadows = 0;
  let upward = 0;
  let grouped = false;

  for (const { sel, decls } of rules) {
    // Each selector in a list is checked on its own: `.n,.l::after{transform:…}` must not
    // borrow the pseudo-element's allowance for `.n`.
    for (const s of sel) {
      assert.match(
        s,
        SELECTOR,
        `${where}: selector "${s}" is outside .n/.l/.l1/.l2 (+ ::before/::after)`,
      );
      const allowed = [
        ...PROPS,
        ...(s.includes("::") ? PSEUDO_PROPS : []),
        ...(mode === "hover" ? HOVER_PROPS : []),
      ];
      for (const [prop] of decls) {
        assert.ok(
          allowed.some((re) => re.test(prop)),
          `${where}: property "${prop}" is not allowed on ${s}`,
        );
      }
    }

    const props = new Set(decls.map(([k]) => k));
    for (const [prop, value] of decls) {
      const unit = value.match(BAD_UNIT);
      assert.equal(
        unit,
        null,
        `${where}: "${prop}: ${value}" uses ${unit?.[1]}; lengths go through h.u()`,
      );
      const word = offGrammar(value);
      assert.equal(
        word,
        null,
        `${where}: "${prop}: ${value}" uses ${word}, which is outside the value grammar ` +
          `(colours come from role variables)`,
      );
      for (const [, name] of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
        assert.ok(ROLE_VARS.has(name), `${where}: var(${name}) is not a role variable`);
      }
      for (const [, url] of value.matchAll(/url\(\s*['"]?([^'")]*)/g)) {
        assert.ok(url.startsWith("data:"), `${where}: url(${url}) — only data: URIs are allowed`);
      }
      assert.equal(
        /\b(animation|transition|will-change)\b/.test(prop),
        false,
        `${where}: ${prop} is renderer-owned`,
      );

      if (prop === "content") {
        assert.ok(
          value === '""' || value === COPY,
          `${where}: content must be exactly \`${COPY}\` or \`""\`, got ${value}`,
        );
      }

      if (prop === "text-shadow") {
        for (const layer of topSplit(value, ",")) {
          const lengths = [
            ...layer.matchAll(
              // The bare `0` alternative must not fire on a percentage: `color-mix(…, var(--bg) 0%, …)`
              // is a colour stop, not a shadow length, and counting it shifted every later
              // length in the layer by one — which read a blur radius as an offset.
              /calc\(\s*(-?\d*\.?\d+)\s*\*\s*(?:(cos|sin)\(\s*(-?\d*\.?\d+)deg\s*\)\s*\*\s*)?var\(--u\)\s*\)|(?<![\w.])(0)(?![\w.%])/g,
            ),
          ];
          const blur = lengths[2];
          const r = blur ? Number(blur[1] ?? blur[4] ?? 0) : 0;
          if (r > 0) {
            blurLayers++;
            assert.ok(r <= 2.5, `${where}: blur radius ${r}u exceeds the 2.5u cap`);
          } else hardLayers++;
          // Upward reach: y = k * sin(angle). The lint may use Math; src/ may not.
          const y = lengths[1];
          if (y) {
            const k = Number(y[1]);
            const deg = y[2] === "sin" ? Number(y[3]) : y[2] === "cos" ? NaN : 0;
            const dy = Number.isNaN(deg)
              ? 0
              : y[2] === "sin"
                ? k * Math.sin((deg * Math.PI) / 180)
                : k;
            if (dy < 0) upward = Math.max(upward, -dy);
          }
        }
      }

      if (prop === "filter") dropShadows += (value.match(/drop-shadow\(/g) ?? []).length;
      if (prop === "z-index" && Number(value) < 0) grouped = true;

      if ((prop === "background-clip" || prop === "-webkit-background-clip") && value === "text") {
        assert.equal(
          sel.includes(".n"),
          false,
          `${where}: background-clip:text on .n drops positioned descendants`,
        );
        assert.ok(
          props.has("background-clip") && props.has("-webkit-background-clip"),
          `${where}: pair the two`,
        );
        assert.ok(
          decls.some(([k, v]) => k === "color" && v === "transparent"),
          `${where}: background-clip:text needs color:transparent`,
        );
        assert.equal(
          props.has("text-shadow"),
          false,
          `${where}: text-shadow paints over a clipped fill — use filter:drop-shadow or a shape-B copy`,
        );
      }
    }
  }

  assert.ok(
    hardLayers <= 64,
    `${where}: ${hardLayers} hard shadow layers exceeds the measured cap of 64`,
  );
  assert.ok(blurLayers <= 4, `${where}: ${blurLayers} blurred layers exceeds the cap of 4`);
  assert.ok(
    dropShadows <= 4,
    `${where}: a drop-shadow chain of ${dropShadows} exceeds the cap of 4`,
  );
  if (upward > 10) {
    assert.ok(
      grouped,
      `${where}: shadows reach ${upward}u upward; paint them as a group or a z-index:-1 copy`,
    );
  }
}

/**
 * Every combination the engine can draw: per param, the values `step()` in `src/rand.js`
 * can return. Names are sorted; the last one varies fastest. See the header for why the
 * order matters (it is part of the hash).
 */
function grid(params) {
  let sets = [{}];
  for (const name of Object.keys(params).sort()) {
    const [min, max, size] = params[name];
    const n = Math.floor((max - min) / size) + 1;
    const values = Array.from({ length: n }, (_, i) => round4(min + i * size));
    sets = sets.flatMap((s) => values.map((v) => ({ ...s, [name]: v })));
  }
  return sets;
}

/** A plausible metrics object; effects may read it but must not depend on exact values. */
const METRICS = {
  fs: [29.31, 24.47],
  H: [20.87, 18.06],
  top: [20.87, 18.06],
  asc: [22.27, 18.6],
  desc: [7.03, 5.87],
  G: 6,
  R: 0.449,
  layout: "stack-fit",
};

const files = [];
for await (const f of glob("effects/*.js", { cwd: root })) files.push(f);
files.sort();
const effects = await Promise.all(
  files.map(async (f) => (await import(pathToFileURL(resolve(root, f)).href)).default),
);

test("the effects directory is not empty and ships the universal fallback", () => {
  assert.ok(files.length >= 2, "expected at least plain and depth-extrude");
  assert.ok(
    files.includes("effects/plain.js"),
    "plain is the universal fallback; the sampler needs it",
  );
});

files.forEach((file, k) => {
  const id = basename(file, ".js");
  const fx = effects[k];

  test(`effect lint: ${id}`, () => {
    assert.equal(fx.id, id, `${file}: id must equal the file basename`);
    assert.match(fx.family, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${file}: family must be kebab-case`);
    assert.ok(
      fx.id === fx.family || fx.id.startsWith(`${fx.family}-`),
      `${file}: id must be <family> or <family>-<slug>`,
    );
    assert.ok(["A", "B"].includes(fx.shape), `${file}: shape must be A or B`);
    assert.ok([2, 3, 4].includes(fx.colors), `${file}: colors must be 2..4`);
    assert.ok(["any", "dark", "light"].includes(fx.bg), `${file}: bg must be any|dark|light`);
    assert.ok(Number.isInteger(fx.odds ?? 4) && (fx.odds ?? 4) >= 0 && (fx.odds ?? 4) <= 16);
    assert.equal(fx.motion, null, `${file}: motion is Wave 4; it must be null in v1.0`);

    for (const key of ["deny", "prefer"]) {
      for (const t of fx.fonts?.[key] ?? []) {
        assert.ok(
          TRAITS.has(t),
          `${file}: fonts.${key} names "${t}", which is not in the closed trait enum`,
        );
      }
    }
    for (const t of fx.palettes?.prefer ?? []) {
      assert.match(t, PREFER_TOKEN, `${file}: palettes.prefer token "${t}" is malformed`);
    }

    for (const [name, spec] of Object.entries(fx.params ?? {})) {
      assert.ok(
        Array.isArray(spec) && spec.length === 3,
        `${file}: param ${name} must be [min, max, step]`,
      );
      const [min, max, size] = spec;
      assert.ok(spec.every(Number.isFinite), `${file}: param ${name} has a non-finite bound`);
      assert.ok(size > 0 && max >= min, `${file}: param ${name} has an empty range`);
      // A warning until S3 makes the engine draw the last step of every grid; then an error.
      const steps = (max - min) / size;
      if (Math.abs(steps - Math.round(steps)) > 1e-9) {
        console.warn(`${file}: param ${name} [${spec}] is not an exact grid; max is never drawn`);
      }
    }

    for (const p of grid(fx.params ?? {})) {
      const where = `${file} ${JSON.stringify(p)}`;

      const bleed = fx.bleed(p, METRICS);
      for (const side of ["t", "r", "b", "l"]) {
        const v = bleed[side];
        assert.ok(Number.isFinite(v) && v >= 0, `${where}: bleed.${side} = ${v}`);
        assert.ok(v <= 40, `${where}: bleed.${side} = ${v}u would shrink the name past half size`);
      }

      const css = fx.css(p, helpers, METRICS);
      assert.equal(typeof css, "string", `${where}: css() must return a string`);
      if (css) lintCss(css, where, { mode: "css" });

      // Shape B is defined by its text copy; shape A must not make one.
      const copies = (css ? parse(css, where) : [])
        .flatMap((r) => r.decls)
        .filter(([k, v]) => k === "content" && v === COPY).length;
      if (fx.shape === "B") assert.ok(copies >= 1, `${where}: shape B emits no ${COPY} copy`);
      else assert.equal(copies, 0, `${where}: a ${COPY} copy makes this shape B, not A`);

      if (fx.hover) {
        const decls = fx.hover(p, helpers, METRICS);
        assert.equal(typeof decls, "string", `${where}: hover() returns declarations, not a rule`);
        assert.equal(
          decls.includes("{"),
          false,
          `${where}: hover() returns declarations; render.js adds the selector`,
        );
        lintCss(decls, `${where} hover`, { mode: "hover" });
      }
    }
  });

  test(`effect grid hash: ${id}`, async () => {
    // The recipe is spelled out in the header; keep the two in step.
    let text = "";
    for (const p of grid(fx.params ?? {})) {
      const b = fx.bleed(p, METRICS);
      text += `${JSON.stringify(p)}\n${b.t} ${b.r} ${b.b} ${b.l}\n`;
      text += `${fx.css(p, helpers, METRICS)}\n${fx.hover?.(p, helpers, METRICS) ?? ""}\n`;
    }
    const hash = createHash("sha256").update(text, "utf8").digest("hex");
    await expect(`${hash}\n`).toMatchFileSnapshot(`./golden/effects/${id}.sha256`);
  });
});

test("the lint actually rejects the things it claims to", () => {
  const cases = {
    "a length in px": [".n{text-shadow:2px 2px 0 var(--a1)}", /lengths go through h\.u/],
    "a hex colour": [".n{color:#ff0000}", /uses #ff0000, which is outside the value grammar/],
    "a named colour": [".n{color:red}", /uses red, which is outside/],
    "a functional colour": [".n{color:oklch(.5 .1 20)}", /uses oklch\(\), which is outside/],
    "a named colour in a shadow": [
      ".n{text-shadow:0 0 0 navy}",
      /uses navy, which is outside the value grammar/,
    ],
    "a foreign selector": ["body{color:var(--fg)}", /outside \.n/],
    "a property off the allowlist": [".n{font-size:calc(2*var(--u))}", /not allowed/],
    "an at-rule": ["@media print{.n{opacity:1}}", /never write an at-rule/],
    "a remote url": [".n{mask-image:url(https://x/y.svg)}", /only data: URIs/],
    "an unknown custom property": [".n{color:var(--nope)}", /not a role variable/],
    "a transition": [".n{transition:opacity .2s}", /not allowed/],
    "hover outside hover()": [".n:hover{opacity:1}", /interaction selectors/],
    "too many hard layers": [
      `.n{text-shadow:${helpers.stack(65, 45, 5, "var(--a1)")}}`,
      /exceeds the measured cap/,
    ],
    "clip-text on .n": [
      ".n{background-clip:text;-webkit-background-clip:text;color:transparent}",
      /drops positioned descendants/,
    ],
    "clip-text on .n inside a selector list": [
      ".n,.l{background-clip:text;-webkit-background-clip:text;color:transparent}",
      /drops positioned descendants/,
    ],
    "a pseudo-element property borrowed by .n in a list": [
      ".n,.l::after{transform:scale(2)}",
      /"transform" is not allowed on \.n$/,
    ],
    "clip-text with a shadow": [
      ".l1{background-clip:text;-webkit-background-clip:text;color:transparent;text-shadow:0 0 0 var(--a1)}",
      /paints over a clipped fill/,
    ],
    "an unpaired clip": [".l1{background-clip:text;color:transparent}", /pair the two/],
    "a wrong content value": [".l1::before{content:attr(data-t)}", /content must be exactly/],
  };
  for (const [name, [css, re]] of Object.entries(cases)) {
    assert.throws(() => lintCss(css, name, { mode: "css" }), re, `the lint let "${name}" through`);
  }
});

test("the value grammar accepts the colours it promises", () => {
  for (const css of [
    ".n{color:var(--fg)}",
    ".n{color:currentcolor;-webkit-text-fill-color:transparent}",
    `.n{color:${helpers.mix("var(--a1)", "var(--bg)", 40)}}`,
    ".n{color:oklch(from var(--a1) l c h / 50%)}",
  ]) {
    assert.doesNotThrow(() => lintCss(css, css, { mode: "css" }));
  }
});
