/**
 * Everything the fit and bleed proofs share: the catalog as the specs see it, the seed
 * search that reaches the axes a pin cannot express, the safe-box maths recomputed
 * independently of `src/render.js`, and the §9.2 scope matrix.
 *
 * The safe box is deliberately **recomputed here from the viewport**, never read back out
 * of the page. A proof that asked the page what it thinks its own box is would pass even
 * if every literal in `src/render.js` were wrong.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCatalog } from "../scripts/build.mjs";
import { helpers } from "../src/helpers.js";
import { drawLayoutAxes } from "../src/pick.js";
import { bbox, decodePng, flatten } from "./png.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// --- catalog -----------------------------------------------------------------

/**
 * Font metas and effect modules, read and checked straight off disk as `build/catalog.js`
 * would export them: the specs must not depend on `build/`.
 */
export const { fonts: FONTS, effects: EFFECTS } = await loadCatalog(ROOT);

/** Every font in the catalogue; what `FIT_SCOPE=all` sweeps. */
export const ALL_FONTS = FONTS.map((f) => f.id);

/**
 * The 8 source rows marked `"seed": true`; §9.2's always-on scope. Read from the source
 * rows, not the catalogue: the two were the same set once, and every later batch then
 * widened each PR's sweep with it.
 */
export const SEED_FONTS = readdirSync(resolve(ROOT, "fonts/sources"))
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(resolve(ROOT, "fonts/sources", f), "utf8")))
  .filter((row) => row.seed === true)
  .map((row) => row.id);

// --- viewports ---------------------------------------------------------------

/** §9.2, DPR 1 throughout. */
export const VIEWPORTS = [
  { w: 320, h: 568 },
  { w: 390, h: 844 },
  { w: 844, h: 390 },
  { w: 768, h: 1024 },
  { w: 1024, h: 1024 },
  { w: 1440, h: 900 },
  { w: 2560, h: 1080 },
  { w: 3840, h: 2160 },
];

/** The two §9.2 calls the per-PR matrix uses for per-variant and per-effect sweeps. */
export const PR_VIEWPORTS = [
  { w: 390, h: 844 },
  { w: 1440, h: 900 },
];

/** `side` only exists below 4/5, so the rotated sweep runs only where the query matches. */
export const PORTRAIT = VIEWPORTS.filter((v) => v.w / v.h <= 0.8);

/**
 * The safe box, recomputed from §5.2 rather than read from the page. Playwright's viewport
 * has zero safe-area insets and `100svh === 100vh`, so the two `env()` terms vanish and
 * `svh` is just the viewport height.
 *
 * Under `side` the block is laid out against the rotated axes, so `--aw` is driven by the
 * viewport height and `--ah` by its width. Note that this swap cancels against the swap of
 * the measured ink dimensions, which is why a screen-space reading of the same render
 * produces the same two ratios — see `docs/fit.md`.
 *
 * @param {number} vw
 * @param {number} vh
 * @param {boolean} side is the rotated block actually active at this viewport?
 */
export function safeBox(vw, vh, side) {
  const m = Math.max(12, 0.02 * Math.min(vw, vh));
  return side ? { m, aw: vh - 2 * m, ah: vw - 2 * m } : { m, aw: vw - 2 * m, ah: vh - 2 * m };
}

// --- thresholds (§9.2, normative) ---------------------------------------------

export const FILL_MIN = 0.965;
export const FILL_MAX = 1.0;
/** Integer ascent rounding plus half-leading flooring, one pixel at each end. */
export const SLACK = 2;
/** Ink-bbox centre tolerance, as a fraction of the viewport on each axis. */
export const CENTRE_TOL = 0.01;

/** Mask mode is pure black on pure white; half coverage is the geometric edge. */
export const isInk = (r, g, b) => r + g + b < 384;

/**
 * Anything that is not the ground. Used by the bleed proof, where the question is "did any
 * paint escape", so the threshold is as loose as the PNG encoders allow.
 *
 * @param {[number, number, number]} ground
 */
export const notGround =
  ([br, bg, bb]) =>
  (r, g, b) =>
    Math.abs(r - br) > 8 || Math.abs(g - bg) > 8 || Math.abs(b - bb) > 8;

/**
 * Any visible ink on mask mode's white ground: the predicate for the fill proof's *lower*
 * bound. A stroke thinner than half a pixel covers no pixel by half on its own, so `isInk`
 * cannot see it, and whether its edge pixel lands above or below 50 % is up to the
 * rasteriser. Bungee Outline's 0.010 em hairline is 0.44 px at 320x568. Asking "does the
 * ink reach the edge" of the loosest threshold can only widen the box by the antialiased
 * fringe, which is what a lower bound can afford; the upper bounds keep `isInk`, which
 * never counts that fringe. See `docs/fit.md`, F7.
 */
export const isTrace = notGround([255, 255, 255]);

// --- seeds -------------------------------------------------------------------

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * The `i`th seed of a fixed sequence, so every search and every contact sheet is
 * reproducible. Crockford base32, the alphabet `src/worker.js` accepts.
 *
 * @param {number} i
 */
export function seedAt(i) {
  let s = "";
  let n = i;
  do {
    s = ALPHABET[n % 32] + s;
    n = Math.floor(n / 32);
  } while (n > 0);
  return `q${s}`;
}

/**
 * The first seed whose layout draws satisfy `pred`. Deterministic, so a failure message
 * names a seed that reproduces byte for byte. The draws are the engine's own: a search
 * that restated them would aim at a seed the page no longer draws the day they change.
 *
 * @param {(a: ReturnType<typeof drawLayoutAxes>, seed: string) => boolean} pred
 */
export function findSeed(pred) {
  for (let i = 0; i < 200000; i++) {
    const s = seedAt(i);
    if (pred(drawLayoutAxes(s), s)) return s;
  }
  throw new Error("no seed satisfies the predicate");
}

/** One stable seed per layout mode, chosen once so every failure is reproducible. */
export const SEEDS = {
  /** upright, centred */
  flat: findSeed((a) => !a.side && a.align === "center"),
  /** upright, `align-items:flex-start` — only `stack-eq` can show the difference */
  start: findSeed((a) => !a.side && a.align === "flex-start"),
  /** upright, `align-items:flex-end` */
  end: findSeed((a) => !a.side && a.align === "flex-end"),
  /** rotated portrait block */
  side: findSeed((a) => a.side),
};

// --- the §5.2 literals, recomputed ------------------------------------------

/**
 * §5.2's fit maths, restated from the contract rather than imported from
 * `src/render.js`. The bleed proof needs `K1`, `K2`, `DX`, `DY` and `G` to know where the
 * paint is *allowed* to be, and taking them from the implementation under test would make
 * the proof circular.
 *
 * @param {object} font a `fonts/meta/<id>.json` row
 * @param {object} variant one of its variants
 * @param {string} layout `stack-fit` | `stack-eq`
 * @param {number} g the drawn line gap, in u
 * @param {object} effect the effect module
 * @param {Record<string, number>} params
 */
export function expectedFit(font, variant, layout, g, effect, params) {
  const { w1, w2 } = variant;
  const file = font.files.find((f) => f.id === variant.file) ?? font.files[0];

  const wide = Math.max(w1.W, w2.W);
  const F1 = layout === "stack-eq" ? wide : w1.W;
  const F2 = layout === "stack-eq" ? wide : w2.W;

  const upm = Number(font.upm ?? 0);
  const ASC = upm > 0 ? file.asc / upm : file.asc;
  const DESC = upm > 0 ? file.desc / upm : file.desc;

  const h1 = (100 * w1.H) / F1;
  const h2 = (100 * w2.H) / F2;

  // R10: `bleed()` sees an `m` built with G = g, because G depends on the bleed's top.
  const metrics = (G, R) => ({
    fs: [100 / F1, 100 / F2],
    H: [h1, h2],
    top: [(100 * w1.top) / F1, (100 * w2.top) / F2],
    asc: [(100 * ASC) / F1, (100 * ASC) / F2],
    desc: [(100 * DESC) / F1, (100 * DESC) / F2],
    G,
    R,
    layout,
  });
  const raw = effect.bleed?.(params, metrics(g, (h1 + h2 + g) / 100), helpers) ?? {
    t: 0,
    r: 0,
    b: 0,
    l: 0,
  };
  const b = {
    t: Math.max(0, Number(raw.t) || 0),
    r: Math.max(0, Number(raw.r) || 0),
    b: Math.max(0, Number(raw.b) || 0),
    l: Math.max(0, Number(raw.l) || 0),
  };

  // R13: the gap clears ink travelling both ways. The lines paint in tree order, so line
  // 2's upward ink would cover line 1's glyphs and line 2's glyphs would cover line 1's
  // downward ink. `max`, not `t + b` — the two inks may meet inside the gap.
  const G = Math.max(g, b.t, b.b);
  const R = (h1 + h2 + G) / 100;
  return {
    F1,
    F2,
    G,
    R,
    h1,
    h2,
    L1: 2 * w1.top - ASC + DESC,
    L2: 2 * w2.top - ASC + DESC,
    K1: 1 + (b.l + b.r) / 100,
    K2: R + (b.t + b.b) / 100,
    DX: (b.l - b.r) / 2,
    DY: (b.t - b.b) / 2,
    bleed: b,
  };
}

/**
 * The corners of an effect's parameter space. A short axis is enumerated whole — four
 * extrusion angles cost nothing and the upward ones are the interesting case — and a long
 * one contributes only its two ends, which is what §9.2 asks for.
 *
 * @param {object} effect
 * @returns {Record<string, number>[]}
 */
export function corners(effect) {
  let out = [{}];
  for (const name of Object.keys(effect.params ?? {}).sort()) {
    const [min, max, size] = effect.params[name];
    const n = Math.round((max - min) / size) + 1;
    const all = Array.from({ length: n }, (_, i) => Math.round((min + i * size) * 10000) / 10000);
    const vals = n <= 4 ? all : [all[0], all[n - 1]];
    out = out.flatMap((o) => vals.map((v) => ({ ...o, [name]: v })));
  }
  return out;
}

// --- urls --------------------------------------------------------------------

/**
 * @param {object} o
 * @param {string} o.seed
 * @param {string} [o.f]
 * @param {string} [o.v]
 * @param {string} [o.l]
 * @param {string} [o.p]
 * @param {string} [o.e]
 */
export function url({ seed, f, v, l, p = "qa-bw", e = "plain" }) {
  const q = new URLSearchParams({ seed, p, e });
  if (f) q.set("f", f);
  if (v) q.set("v", v);
  if (l) q.set("l", l);
  return `/?${q}`;
}

// --- measurement --------------------------------------------------------------

/**
 * What the engine actually did: the used geometry, read back after the webfont has
 * settled. `rotate` is the honest answer to "is `side` live here" — it is the engine's own
 * computed value, not our guess at the media query.
 */
const GEOMETRY = () => {
  const n = document.querySelector(".n");
  const cs = getComputedStyle(n);
  const rect = (sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom };
  };
  return {
    vw: document.documentElement.clientWidth,
    vh: document.documentElement.clientHeight,
    dpr: devicePixelRatio,
    rotate: cs.rotate,
    translate: cs.translate,
    // --u is an unregistered custom property, so it computes as an unresolved token
    // stream. The used block width is the same number by definition: --u = --bw/100.
    bw: Number.parseFloat(cs.width),
    n: rect(".n"),
    l1: rect(".l1"),
    l2: rect(".l2"),
    l1Top: document.querySelector(".l1").offsetTop,
    l1H: document.querySelector(".l1").offsetHeight,
    l2Top: document.querySelector(".l2").offsetTop,
    l2H: document.querySelector(".l2").offsetHeight,
    fonts: [...document.fonts].map((f) => `${f.family}=${f.status}`).join(","),
    scroll: [
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      document.documentElement.scrollHeight - document.documentElement.clientHeight,
    ],
  };
};

/**
 * Engines that have already reported their screenshot PNG type. `png.js` decodes only 8-bit
 * RGB and RGBA; one line per engine (per worker) is the record that this is all they emit.
 */
const PNG_LOGGED = new Set();

/**
 * Load one pick at one viewport and return both the engine's geometry and the pixels.
 *
 * `hover` puts the pointer on the link first. §5.6 requires `bleed()` to bound the hover
 * state's ink too, and `render.js` owns a 180 ms transition on `text-shadow`, so the wait
 * is what makes the measurement the settled state rather than a frame of the crossfade.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} href
 * @param {{w: number, h: number}} vp
 * @param {{hover?: boolean}} [opts]
 */
export async function shoot(page, href, vp, opts = {}) {
  await page.setViewportSize({ width: vp.w, height: vp.h });
  const res = await page.goto(href);
  if (!res || res.status() !== 200) throw new Error(`${href} → ${res?.status()}`);
  // font-display:block hides the text until the face is usable, so this is load-bearing.
  await page.evaluate(() => document.fonts.ready);
  if (opts.hover) {
    await page.hover("a.n");
    await page.waitForTimeout(320);
  }
  const geo = await page.evaluate(GEOMETRY);
  // `fonts.ready` resolves before the frame with the settled glyphs is drawn, and Chromium
  // cannot copy a surface that has no frame yet: on a fresh page it answers "Unable to
  // capture screenshot". By the second animation frame the renderer has produced one.
  // Playwright's own `toHaveScreenshot` waits the same way before every capture.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const png = decodePng(await page.screenshot());
  const engine = page.context().browser()?.browserType().name();
  if (!PNG_LOGGED.has(engine)) {
    PNG_LOGGED.add(engine);
    console.log(`[png] ${engine}: colour type ${png.ctype}, bit depth ${png.depth}`);
  }
  const img = flatten(png);
  // Firefox and WebKit hand the header back with every comma re-joined as ", ", as if it
  // were a list; the engine never writes a space there, so undo it to get the real string.
  const pick = res.headers()["luzid-pick"].replaceAll(", ", ",");
  return { pick, geo, img };
}

/**
 * Ink bounding box in CSS pixels. Device pixels are divided by the page's own DPR rather
 * than an assumed 1, so a HiDPI project would still measure correctly.
 *
 * @param {{width: number, height: number, data: Uint8Array}} img
 * @param {(r: number, g: number, b: number) => boolean} hit
 * @param {number} dpr
 */
export function inkBox(img, hit, dpr) {
  const b = bbox(img, hit);
  if (!b) return null;
  return {
    x0: b.x0 / dpr,
    y0: b.y0 / dpr,
    x1: (b.x1 + 1) / dpr,
    y1: (b.y1 + 1) / dpr,
    w: b.w / dpr,
    h: b.h / dpr,
    cx: (b.x0 + b.x1 + 1) / 2 / dpr,
    cy: (b.y0 + b.y1 + 1) / 2 / dpr,
    n: b.n,
  };
}

// --- §9.2 scope ---------------------------------------------------------------

/** `changed` is the required PR check; `all` is the WP-50 sweep that `sweep.yml` runs weekly. */
export const SCOPE = process.env.FIT_SCOPE === "all" ? "all" : "changed";

/**
 * Paths differing from `origin/main`, or `null` when git cannot say (a shallow clone with no
 * base, a tarball). Callers treat `null` as "assume everything moved", never as "nothing did".
 *
 * @returns {string[] | null}
 */
export function changedPaths() {
  for (const base of ["origin/main", "main"]) {
    try {
      const out = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return out.split("\n").filter(Boolean);
    } catch {}
  }
  return null;
}

/**
 * §9.2's per-PR matrix, resolved once.
 *
 * - `variantFonts` — fonts whose meta moved, **plus** every seed font when `src/` or a font
 *   script moved, because those change the literals for all of them. Swept across every
 *   variant, `stack-fit`, the two PR viewports.
 * - `sweepFonts` — the seed fonts, always. Swept across the three layout modes and every
 *   viewport, one variant each.
 * - `effects` — changed effects, at both ends of their parameter space.
 *
 * `FIT_SCOPE=all` widens all three to everything.
 */
export function scope() {
  if (SCOPE === "all") {
    return { variantFonts: ALL_FONTS, sweepFonts: ALL_FONTS, effects: EFFECTS.map((e) => e.id) };
  }
  const changed = changedPaths();
  // No git answer: assume the worst and run the wide per-variant sweep. Narrowing to nothing
  // here would turn a broken checkout into a green run that proved nothing.
  if (changed === null) {
    return { variantFonts: SEED_FONTS, sweepFonts: SEED_FONTS, effects: EFFECTS.map((e) => e.id) };
  }

  // A prefix, not a list of files: the font scripts are due to move under `scripts/fonts/`,
  // and a literal list would silently stop this sweep the day they do. `sfnt.mjs` and
  // `woff2.mjs` are spelled out until they move there too.
  const engineMoved = changed.some(
    (p) =>
      p.startsWith("src/") ||
      p.startsWith("scripts/fonts") ||
      p === "scripts/sfnt.mjs" ||
      p === "scripts/woff2.mjs",
  );
  const metaMoved = changed
    .filter((p) => p.startsWith("fonts/meta/") && p.endsWith(".json"))
    .map((p) => p.slice("fonts/meta/".length, -".json".length));

  // A changed meta is swept whether or not it is a seed font; a deleted one has no row.
  const variantFonts = [
    ...new Set([
      ...(engineMoved ? SEED_FONTS : []),
      ...metaMoved.filter((id) => ALL_FONTS.includes(id)),
    ]),
  ];
  const effects = changed
    .filter((p) => p.startsWith("effects/") && p.endsWith(".js"))
    .map((p) => p.slice("effects/".length, -".js".length));

  return { variantFonts, sweepFonts: SEED_FONTS, effects };
}
