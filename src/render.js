/**
 * Pure templating: a Pick plus the catalog becomes one self-contained HTML document.
 *
 * Two things make this file the contract rather than a detail:
 *
 * 1. **The fit literals.** Every number in §5.2 is computed here from build-time ink
 *    metrics, so the browser does one `min()` and nothing shifts. No JS, no measurement.
 * 2. **The accessibility gate.** Effect CSS may only ever appear inside
 *    `@media screen and (forced-colors:none) and (prefers-contrast:no-preference)`.
 *    `screen` is what makes print correct for free, and `forced-colors:none` is what keeps
 *    a high-contrast user out of a `background-clip:text` effect that would paint nothing.
 *
 * The CSP forbids `style=""`, so every per-request value is a literal inside the one
 * nonce'd `<style>`.
 */

import { helpers } from './helpers.js'
import { resolve } from './pick.js'
import { round4 } from './rand.js'

const NAME = 'Tomasz Cudziło'
const WORD1 = 'Tomasz'
const WORD2 = 'Cudziło'
const HREF = 'https://github.com/tomasz'
const ORIGIN = 'https://luzid.co/'
const LICENSES = 'https://github.com/tomasz/luzid.co/tree/main/fonts/licenses'

/** Shrink factor covering sub-pixel rounding and Safari's CoreText shaping differences. */
const SAFETY = 0.985

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** @param {string} s */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c])

/**
 * Comment-safe text. A comment ends at `-->`, so stripping every `<` and `>` makes the
 * terminator unconstructible; nothing else in a comment is a parsing hazard.
 * @param {string} s
 */
const cmt = (s) => String(s).replace(/[<>]/g, '')

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
const note = (s) => cmt(s).replace(/-{2,}/g, '-')

/** @param {number} n */
const num = (n) => {
  const r = round4(n)
  return Object.is(r, -0) ? '0' : String(r)
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/**
 * `o` is four slots — bg, fg, a1, a2 — each a hex index, `w`/`k` for a derived washi/sumi
 * ground, or `-` for an alias. §5.4 rule 4: the four variables are never undefined.
 *
 * A row that needs a ground appends both to its own `hex`, washi first then sumi, after
 * its real colours; `names.length` is the divider. The edge therefore never runs colour
 * maths, and `names` stays the authoritative list for the credit line — a derived ground
 * is not a dictionary colour and is never credited as one.
 *
 * @param {{hex?: string[], names?: string[]}} palette
 * @param {{o: string}} role
 */
function roleColors(palette, role) {
  const hex = palette.hex ?? []
  const n = (palette.names ?? []).length
  const at = (ch) => (ch === 'w' ? hex[n] : ch === 'k' ? hex[n + 1] : hex[Number(ch)])
  const o = String(role.o ?? '')
  const bg = at(o[0]) ?? '#ffffff'
  const fg = at(o[1]) ?? '#000000'
  const a1 = (o[2] === '-' ? fg : at(o[2])) ?? fg
  const a2 = (o[3] === '-' ? bg : at(o[3])) ?? bg
  return { bg, fg, a1, a2 }
}

/**
 * The §5.2 literals. `1u` = 1% of the fitted block width; `F_i` is the font-size divisor;
 * `L_i` is the line-height that puts each line's ink top exactly on its block top.
 *
 * @param {import('./pick.js').Pick} p
 * @param {object} parts from `resolve()`
 */
export function fit(p, parts) {
  const { variant, file, effect } = parts
  const [w1, w2] = [variant.w1, variant.w2]

  // stack-fit: each line fills the block width. stack-eq: both lines share one scale.
  const wide = Math.max(w1.W, w2.W)
  const F1 = p.l === 'stack-eq' ? wide : w1.W
  const F2 = p.l === 'stack-eq' ? wide : w2.W

  // ASC/DESC are the rounded values `scripts/sfnt.mjs` actually wrote, in em. The baseline
  // sits (L + ASC - DESC)/2 below the line top; setting that equal to top_i gives L_i.
  const upm = Number(parts.font.upm ?? 0)
  const ASC = upm > 0 ? file.asc / upm : file.asc
  const DESC = upm > 0 ? file.desc / upm : file.desc
  const L1 = 2 * w1.top - ASC + DESC
  const L2 = 2 * w2.top - ASC + DESC

  // Line heights in block-width percent, i.e. in u.
  const h1 = (100 * w1.H) / F1
  const h2 = (100 * w2.H) / F2

  // The effect's bleed may depend on the metrics, and G depends on the bleed's top. Two
  // passes: bleed() sees G = g (the layout gap), css() sees the final G and R.
  const metrics = (G, R) => ({
    fs: [100 / F1, 100 / F2],
    H: [h1, h2],
    top: [(100 * w1.top) / F1, (100 * w2.top) / F2],
    asc: [(100 * ASC) / F1, (100 * ASC) / F2],
    desc: [(100 * DESC) / F1, (100 * DESC) / F2],
    G,
    R,
    layout: p.l,
  })
  const provisional = metrics(p.g, (h1 + h2 + p.g) / 100)
  const raw = effect.bleed?.(p.params, provisional) ?? { t: 0, r: 0, b: 0, l: 0 }
  const b = {
    t: Math.max(0, Number(raw.t) || 0),
    r: Math.max(0, Number(raw.r) || 0),
    b: Math.max(0, Number(raw.b) || 0),
    l: Math.max(0, Number(raw.l) || 0),
  }

  // G stops line 2's shadow from painting over line 1.
  const G = Math.max(p.g, b.t)
  const R = (h1 + h2 + G) / 100

  return {
    F1,
    F2,
    L1,
    L2,
    G,
    R,
    BH: 100 * R,
    Y2: h1 + G,
    K1: 1 + (b.l + b.r) / 100,
    K2: R + (b.t + b.b) / 100,
    DX: (b.l - b.r) / 2,
    DY: (b.t - b.b) / 2,
    bleed: b,
    m: metrics(G, R),
  }
}

/**
 * @param {import('./pick.js').Pick} p
 * @param {object} parts
 * @param {ReturnType<typeof fit>} f
 */
function baseCss(p, parts, f) {
  const { font, variant, file, palette, role } = parts
  const c = roleColors(palette, role)
  const webfont = typeof file.b64 === 'string' && file.b64.length > 0
  const family = webfont ? 'f' : font.family
  const feat = variant.css?.feat ? variant.css.feat : 'normal'
  const w1 = variant.w1
  const w2 = variant.w2

  const face = webfont
    ? `@font-face{font-family:f;src:url(data:font/woff2;base64,${file.b64}) format("woff2");font-display:block}\n`
    : ''

  const side = p.side
    ? `\n@media (max-aspect-ratio:4/5){.n{` +
      `--aw:calc(100svh - 2*var(--m) - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));` +
      `--ah:calc(100vw - 2*var(--m) - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px));` +
      `rotate:90deg;translate:calc(${num(-f.DY)}*var(--u)) calc(${num(f.DX)}*var(--u))}}`
    : ''

  return `:root{--bg:${c.bg};--fg:${c.fg};--a1:${c.a1};--a2:${c.a2};color-scheme:${role.dark ? 'dark' : 'light'}}
${face}html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
html,body{height:100%;margin:0;overflow:clip;background:var(--bg)}
body{display:grid;place-content:center;place-content:unsafe center}
h1{margin:0;font:inherit}
.n{--m:max(12px,2vmin);
--aw:calc(100vw - 2*var(--m) - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px));
--ah:calc(100svh - 2*var(--m) - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));
--bw:calc(${SAFETY}*min(var(--aw)/${num(f.K1)},var(--ah)/${num(f.K2)}));--u:calc(var(--bw)/100);--bh:${num(f.BH)};
display:flex;flex-direction:column;align-items:${p.align};width:var(--bw);isolation:isolate;
translate:calc(${num(f.DX)}*var(--u)) calc(${num(f.DY)}*var(--u));
font-family:${family};font-weight:${variant.css?.weight ?? 400};font-style:${variant.css?.style ?? 'normal'};font-feature-settings:${feat};font-synthesis:none;font-kerning:normal;
text-rendering:geometricPrecision;text-transform:${variant.case ?? 'none'};white-space:nowrap;text-decoration:none;color:var(--fg)}
.l{display:block;position:relative}
.l1{--y:0;font-size:calc(var(--bw)/${num(f.F1)});width:calc(1em*${num(w1.W)});line-height:${num(f.L1)};height:calc(1em*${num(w1.H)});text-indent:calc(-1em*${num(w1.X)})}
.l2{--y:${num(f.Y2)};font-size:calc(var(--bw)/${num(f.F2)});width:calc(1em*${num(w2.W)});line-height:${num(f.L2)};height:calc(1em*${num(w2.H)});text-indent:calc(-1em*${num(w2.X)});margin-top:calc(${num(f.G)}*var(--u))}
.l::before,.l::after{position:absolute;inset:0;pointer-events:none}
a.n:focus-visible{outline:max(3px,.35vmin) solid var(--fg);outline-offset:max(4px,.5vmin)}${side}`
}

/**
 * §5.8. Effects are gated, never reset: outside the gate they simply do not exist, so
 * forced-colors, prefers-contrast and print all fall back to the plain fitted name.
 *
 * @param {object} parts
 * @param {import('./pick.js').Pick} p
 * @param {ReturnType<typeof fit>} f
 */
function gatedCss(parts, p, f) {
  const { effect } = parts
  const raw = effect.css?.(p.params, helpers, f.m) ?? ''
  // Shape B paints with ::before/::after copies. Older engines drop the alt-text form of
  // `content`, so the whole effect is wrapped: they show plain text with one correct
  // accessible name instead of a doubled one.
  const body = raw && effect.shape === 'B' ? `@supports (content:"x" / ""){${raw}}` : raw

  const decls = effect.hover?.(p.params, helpers, f.m) ?? null
  const hover = decls
    ? `@media (hover:hover) and (pointer:fine){a.n:hover{${decls}}}a.n:active{${decls}}`
    : 'a.n:active{scale:.985}'

  const motion = effect.motion?.(p.params, helpers, f.m) ?? ''
  const reduced =
    `@media (prefers-reduced-motion:no-preference){` +
    `a.n{transition:scale .18s,translate .18s,filter .18s,opacity .18s,text-shadow .18s}${motion}}`

  return `@media screen and (forced-colors:none) and (prefers-contrast:no-preference){${body}${hover}${reduced}}`
}

/**
 * The whole stylesheet, in one nonce'd `<style>`.
 *
 * @param {import('./pick.js').Pick} p
 * @param {object} catalog
 */
export function stylesheet(p, catalog) {
  const parts = resolve(p, catalog)
  const f = fit(p, parts)
  const dark = parts.role.dark
  return [
    baseCss(p, parts, f),
    gatedCss(parts, p, f),
    `@media (prefers-contrast:more){:root{--bg:${dark ? '#111' : '#fff'};--fg:${dark ? '#fff' : '#111'}}}`,
    '@media print{html,body{background:none}.n{color:#000}}',
  ].join('\n')
}

/**
 * Two-swatch favicon in the pick's own colours: one data URI, zero extra requests. Falls
 * back to the static `.ico` if either role is not a plain hex.
 *
 * @param {string} bg
 * @param {string} fg
 */
function favicon(bg, fg) {
  if (!HEX.test(bg) || !HEX.test(fg)) return ''
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'>` +
    `<rect width='16' height='16' fill='${bg}'/><rect x='3' y='3' width='10' height='10' fill='${fg}'/></svg>`
  const uri = svg.replace(/[<>#]/g, (c) => ({ '<': '%3C', '>': '%3E', '#': '%23' })[c])
  return `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${uri}">`
}

/**
 * @param {import('./pick.js').Pick} p
 * @param {object} catalog
 * @param {{nonce: string, pick: string}} ctx
 * @returns {string}
 */
export function render(p, catalog, ctx) {
  const parts = resolve(p, catalog)
  const { font, palette, role, file } = parts
  const c = roleColors(palette, role)
  const css = stylesheet(p, catalog)

  const fontNote = file.b64
    ? `font: subset of ${font.family}, © ${font.copyright ?? 'see licence'}, ${font.licenseId ?? 'see licence'}, modified (23-glyph subset, metrics) · licences: ${LICENSES}`
    : `font: ${font.family} (system)`
  const palNote = `palette: ${(palette.names ?? []).join(', ')} (${palette.src ?? palette.id})`
  const colophon = `${cmt(ctx.pick)} · ${note(fontNote)} · ${note(palNote)}`

  return `<!doctype html>
<html lang="pl" translate="no" data-seed="${esc(p.seed)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${NAME}</title>
<meta name="description" lang="en" content="${NAME} on GitHub.">
<meta name="google" content="notranslate">
<link rel="canonical" href="${ORIGIN}">
<meta name="theme-color" content="${esc(c.bg)}"><meta name="color-scheme" content="${role.dark ? 'dark' : 'light'}">
${favicon(c.bg, c.fg)}<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:title" content="${NAME}"><meta property="og:type" content="profile"><meta property="og:url" content="${ORIGIN}"><meta property="og:image" content="${ORIGIN}og.png">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Person","name":"${NAME}","url":"${ORIGIN}","sameAs":["${HREF}"]}</script>
<!-- ${colophon} -->
<script nonce="${esc(ctx.nonce)}">addEventListener("pageshow",e=>{e.persisted&&location.reload()})</script>
<style nonce="${esc(ctx.nonce)}">${css}</style>
</head>
<body><h1><a class="n" href="${HREF}" rel="me"><span class="l l1" data-t="${WORD1}">${WORD1}</span> <span class="l l2" data-t="${WORD2}">${WORD2}</span></a></h1></body>
</html>`
}
