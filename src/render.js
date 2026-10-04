/**
 * Pure templating: a scene becomes one self-contained HTML document.
 *
 * Two things make this file the contract rather than a detail:
 *
 * 1. **The fit literals.** Every number `fit.js` computes for §5.2 is written here as a
 *    CSS literal, so the browser does one `min()` and nothing shifts. No JS, no measurement.
 * 2. **The accessibility gate.** Effect CSS may only ever appear inside
 *    `@media screen and (forced-colors:none) and (prefers-contrast:no-preference)`.
 *    `screen` is what makes print correct for free, and `forced-colors:none` is what keeps
 *    a high-contrast user out of a `background-clip:text` effect that would paint nothing.
 *
 * The CSP forbids `style=""`, so every per-request value is a literal inside the one
 * nonce'd `<style>`.
 */

import { fit, SAFETY } from "./fit.js";
import { helpers } from "./helpers.js";
import { pickString } from "./look.js";
import { round4 } from "./rand.js";

/** @import { Fit, Scene } from "./types.js" */

const NAME = "Tomasz Cudziło";
const WORD1 = "Tomasz";
const WORD2 = "Cudziło";
const HREF = "https://github.com/tomasz";
const ORIGIN = "https://luzid.co/";
const LICENSES = "https://github.com/tomasz/luzid.co/tree/main/fonts/licenses";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** @param {string} s */
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ESCAPES[/** @type {keyof typeof ESCAPES} */ (c)]);

/**
 * Comment-safe text. A comment ends at `-->`, so stripping every `<` and `>` makes the
 * terminator unconstructible; nothing else in a comment is a parsing hazard.
 * @param {string} s
 */
const cmt = (s) => String(s).replace(/[<>]/g, "");

/**
 * Comment-safe text that came from a data file (a font family, a copyright line, a colour
 * name). Those are the only strings in the colophon nobody generated, so they also lose
 * runs of hyphens — `--` is invalid inside a comment even though no parser minds.
 *
 * The canonical tuple is deliberately *not* run through this: role-set ids are things like
 * `10--`, and the whole point of the colophon is that the tuple can be copied into a bug
 * report verbatim. Ids are `[a-z0-9.-]`, so they can never produce a `>`.
 * @param {string} s
 */
const note = (s) => cmt(s).replace(/-{2,}/g, "-");

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * `o` is four slots — bg, fg, a1, a2 — each a hex index, `w`/`k` for a derived washi/sumi
 * ground, or `-` for an alias. §5.4 rule 4: the four variables are never undefined.
 *
 * A row that needs a ground appends both to its own `hex`, washi first then sumi, after
 * its real colours; `names.length` is the divider. The edge therefore never runs colour
 * maths, and `names` stays the authoritative list for the credit line — a derived ground
 * is not a dictionary colour and is never credited as one.
 *
 * @param {{hex?: readonly string[], names?: readonly string[]}} palette
 * @param {{o: string}} roleSet
 */
function roleColors(palette, roleSet) {
  const hex = palette.hex ?? [];
  const n = (palette.names ?? []).length;
  /** @param {string | undefined} ch */
  const at = (ch) => (ch === "w" ? hex[n] : ch === "k" ? hex[n + 1] : hex[Number(ch)]);
  const o = String(roleSet.o ?? "");
  const bg = at(o[0]) ?? "#ffffff";
  const fg = at(o[1]) ?? "#000000";
  const a1 = (o[2] === "-" ? fg : at(o[2])) ?? fg;
  const a2 = (o[3] === "-" ? bg : at(o[3])) ?? bg;
  return { bg, fg, a1, a2 };
}

/**
 * @param {Scene} scene
 * @param {Fit} fit
 */
function baseCss(scene, fit) {
  const { look, font, variant, file, palette, roleSet } = scene;
  const colors = roleColors(palette, roleSet);
  const webfont = typeof file.b64 === "string" && file.b64.length > 0;
  const family = webfont ? "f" : font.family;
  const feat = variant.css?.feat ? variant.css.feat : "normal";
  const w1 = variant.w1;
  const w2 = variant.w2;

  const face = webfont
    ? `@font-face{font-family:f;src:url(data:font/woff2;base64,${file.b64}) format("woff2");font-display:block}\n`
    : "";

  const sideCss = look.side
    ? `\n@media (max-aspect-ratio:4/5){.n{` +
      `--aw:calc(100svh - 2*var(--m) - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));` +
      `--ah:calc(100vw - 2*var(--m) - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px));` +
      `rotate:90deg;translate:calc(${round4(-fit.DY)}*var(--u)) calc(${round4(fit.DX)}*var(--u))}}`
    : "";

  return `:root{--bg:${colors.bg};--fg:${colors.fg};--a1:${colors.a1};--a2:${colors.a2};color-scheme:${roleSet.dark ? "dark" : "light"}}
${face}html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
html,body{height:100%;margin:0;overflow:clip;background:var(--bg)}
body{display:grid;place-content:center;place-content:unsafe center}
h1{margin:0;font:inherit}
.n{--m:max(12px,2vmin);
--aw:calc(100vw - 2*var(--m) - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px));
--ah:calc(100svh - 2*var(--m) - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));
--bw:calc(${SAFETY}*min(var(--aw)/${round4(fit.K1)},var(--ah)/${round4(fit.K2)}));--u:calc(var(--bw)/100);--bh:${round4(fit.BH)};
display:flex;flex-direction:column;align-items:${look.align};width:var(--bw);isolation:isolate;
translate:calc(${round4(fit.DX)}*var(--u)) calc(${round4(fit.DY)}*var(--u));
font-family:${family};font-weight:${variant.css?.weight ?? 400};font-style:${variant.css?.style ?? "normal"};font-feature-settings:${feat};font-synthesis:none;font-kerning:normal;
text-rendering:geometricPrecision;text-transform:${variant.case ?? "none"};white-space:nowrap;text-decoration:none;color:var(--fg)}
.l{display:block;position:relative}
.l1{--y:0;font-size:calc(var(--bw)/${round4(fit.F1)});width:calc(1em*${round4(w1.W)});line-height:${round4(fit.L1)};height:calc(1em*${round4(w1.H)});text-indent:calc(-1em*${round4(w1.X)})}
.l2{--y:${round4(fit.Y2)};font-size:calc(var(--bw)/${round4(fit.F2)});width:calc(1em*${round4(w2.W)});line-height:${round4(fit.L2)};height:calc(1em*${round4(w2.H)});text-indent:calc(-1em*${round4(w2.X)});margin-top:calc(${round4(fit.G)}*var(--u))}
.l::before,.l::after{position:absolute;inset:0;pointer-events:none}
a.n:focus-visible{outline:max(3px,.35vmin) solid var(--fg);outline-offset:max(4px,.5vmin)}${sideCss}`;
}

/**
 * §5.8. Effects are gated, never reset: outside the gate they simply do not exist, so
 * forced-colors, prefers-contrast and print all fall back to the plain fitted name.
 *
 * @param {Scene} scene
 * @param {Fit} fit
 */
function effectCss(scene, fit) {
  const { look, effect } = scene;
  const raw = effect.css?.(look.params, helpers, fit.m) ?? "";
  // Shape B paints with ::before/::after copies. Older engines drop the alt-text form of
  // `content`, so the whole effect is wrapped: they show plain text with one correct
  // accessible name instead of a doubled one.
  const body = raw && effect.shape === "B" ? `@supports (content:"x" / ""){${raw}}` : raw;

  const decls = effect.hover?.(look.params, helpers, fit.m) ?? null;
  const hover = decls
    ? `@media (hover:hover) and (pointer:fine){a.n:hover{${decls}}}a.n:active{${decls}}`
    : "a.n:active{scale:.985}";

  const motion = effect.motion?.(look.params, helpers, fit.m) ?? "";
  const reduced =
    `@media (prefers-reduced-motion:no-preference){` +
    `a.n{transition:scale .18s,translate .18s,filter .18s,opacity .18s,text-shadow .18s}${motion}}`;

  return `@media screen and (forced-colors:none) and (prefers-contrast:no-preference){${body}${hover}${reduced}}`;
}

/**
 * The whole stylesheet, in one nonce'd `<style>`.
 *
 * @param {Scene} scene
 * @param {Fit} fit from `fit(scene)`
 */
export function stylesheet(scene, fit) {
  const dark = scene.roleSet.dark;
  return [
    baseCss(scene, fit),
    effectCss(scene, fit),
    `@media (prefers-contrast:more){:root{--bg:${dark ? "#111" : "#fff"};--fg:${dark ? "#fff" : "#111"}}}`,
    "@media print{html,body{background:none}.n{color:#000}}",
  ].join("\n");
}

/**
 * Two-swatch favicon in the pick's own colours: one data URI, zero extra requests. Falls
 * back to the static `.ico` if either role is not a plain hex.
 *
 * @param {string} bg
 * @param {string} fg
 */
function favicon(bg, fg) {
  if (!HEX.test(bg) || !HEX.test(fg)) return "";
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'>` +
    `<rect width='16' height='16' fill='${bg}'/><rect x='3' y='3' width='10' height='10' fill='${fg}'/></svg>`;
  const uri = svg.replace(
    /[<>#]/g,
    (c) => ({ "<": "%3C", ">": "%3E", "#": "%23" })[/** @type {"<" | ">" | "#"} */ (c)],
  );
  return `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${uri}">`;
}

/**
 * @param {Scene} scene
 * @param {string} nonce
 * @returns {string}
 */
export function render(scene, nonce) {
  const { look, font, palette, roleSet, file } = scene;
  const colors = roleColors(palette, roleSet);
  const css = stylesheet(scene, fit(scene));

  const fontNote = file.b64
    ? `font: subset of ${font.family}, © ${font.copyright ?? "see licence"}, ${font.licenseId ?? "see licence"}, modified (23-glyph subset, metrics) · licences: ${LICENSES}`
    : `font: ${font.family} (system)`;
  const palNote = `palette: ${(palette.names ?? []).join(", ")} (${palette.src ?? palette.id})`;
  const colophon = `${cmt(pickString(look))} · ${note(fontNote)} · ${note(palNote)}`;

  return `<!doctype html>
<html lang="pl" translate="no" data-seed="${esc(look.seed)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${NAME}</title>
<meta name="description" lang="en" content="${NAME} on GitHub.">
<meta name="google" content="notranslate">
<link rel="canonical" href="${ORIGIN}">
<meta name="theme-color" content="${esc(colors.bg)}"><meta name="color-scheme" content="${roleSet.dark ? "dark" : "light"}">
${favicon(colors.bg, colors.fg)}<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:title" content="${NAME}"><meta property="og:type" content="profile"><meta property="og:url" content="${ORIGIN}"><meta property="og:image" content="${ORIGIN}og.png">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Person","name":"${NAME}","url":"${ORIGIN}","sameAs":["${HREF}"]}</script>
<!-- ${colophon} -->
<script nonce="${esc(nonce)}">addEventListener("pageshow",e=>{e.persisted&&location.reload()})</script>
<style nonce="${esc(nonce)}">${css}</style>
</head>
<body><h1><a class="n" href="${HREF}" rel="me"><span class="l l1" data-t="${WORD1}">${WORD1}</span> <span class="l l2" data-t="${WORD2}">${WORD2}</span></a></h1></body>
</html>`;
}
