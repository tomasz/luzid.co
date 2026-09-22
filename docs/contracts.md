# luzid.co — engine contracts

This file is the source of truth for the engine, the fit maths, the file schemas and the
effect contract. It wins over `AGENTS.md` and over any comment in the code. Changing it
needs a PR labelled `contract`, merged by the owner.

Everything under **§5** below is the approved plan, verbatim. Everything under **"The `h32`
listing"** and **"Resolutions"** is WP-10's implementation of it: the code that had to be
pinned exactly, and the places where the plan text left a choice the engine had to make.
Read the resolutions — several are things the plan implies but does not say, and a later
work package that guesses differently will break a golden.

## 5. Contracts

WP-10 lands these with tests. Changing them later needs a PR labelled `contract`, merged by the owner.

### 5.1 HTML skeleton

```html
<!doctype html>
<html lang="pl" translate="no" data-seed="{seed}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Tomasz Cudziło</title>
<meta name="description" lang="en" content="Tomasz Cudziło on GitHub.">
<meta name="google" content="notranslate">
<link rel="canonical" href="https://luzid.co/">
<meta name="theme-color" content="{bg}"><meta name="color-scheme" content="{light|dark}">
<link rel="icon" href="data:image/svg+xml,{two-swatch svg, # as %23}"><link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:title" content="Tomasz Cudziło"><meta property="og:type" content="profile"><meta property="og:url" content="https://luzid.co/"><meta property="og:image" content="https://luzid.co/og.png">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Person","name":"Tomasz Cudziło","url":"https://luzid.co/","sameAs":["https://github.com/tomasz"]}</script>
<!-- {pick string} · font: subset of {family}, © {holder}, {SPDX}, modified (23-glyph subset, metrics) · licences: https://github.com/tomasz/luzid.co/tree/main/fonts/licenses · palette: {names} ({source}) -->
<script nonce="{N}">addEventListener("pageshow",e=>{e.persisted&&location.reload()})</script>
<style nonce="{N}">{css}</style>
</head>
<body><h1><a class="n" href="https://github.com/tomasz" rel="me"><span class="l l1" data-t="Tomasz">Tomasz</span> <span class="l l2" data-t="Cudziło">Cudziło</span></a></h1></body>
</html>
```

Fixed forever: the real text is `Tomasz Cudziło` (case only via `text-transform`); no `aria-label`; no per-letter spans; decorative copies only as generated content with empty alt text.

### 5.2 Fit contract (pure CSS, zero layout shift)

**Build time.** For each font file and variant, `harfbuzzjs` shapes `Tomasz` and `Cudziło` (in the variant's case, with its features, `lang=pl`) and unions glyph extents → per word *i*: ink width `W_i`, ink height `H_i`, ink left offset `X_i`, ink top `top_i`, all in em.

**Normalized vertical metrics** (`scripts/sfnt.mjs`, per file, font units): `asc = ceil(max ink top)`, `desc = max(0, ceil(max ink depth), asc − 2·min(top_i) + 0.05·upm)` (the last term keeps every line-height positive). Write int16 `hhea.ascender@4 = OS/2.sTypoAscender@68 = asc`; int16 `hhea.descender@6 = sTypoDescender@70 = −desc`; uint16 `usWinAscent@74 = asc`, `usWinDescent@76 = desc`; `hhea.lineGap@8 = sTypoLineGap@72 = 0`. Assert OS/2 length ≥ 78. Leave `fsSelection` alone. Every engine and OS then places the baseline identically, and pseudo-element copies align with the real text. (`ascent-override` is not an option: Safari lacks it.)

Per line the renderer emits `L_i = 2·top_i − ASC + DESC` (unitless line-height; `ASC`, `DESC` = the **rounded values actually written**, ÷ upm, `DESC` positive). Derivation: baseline sits `(L + ASC − DESC)/2` below the line top; setting that equal to `top_i` puts the ink top exactly on the block top. Negative half-leading is well-defined in CSS 2 §10.8.1.

```css
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
html,body{height:100%;margin:0;overflow:clip;background:var(--bg)}
body{display:grid;place-content:center;place-content:unsafe center}
h1{margin:0;font:inherit}
.n{--m:max(12px,2vmin);
   --aw:calc(100vw - 2*var(--m) - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px));
   --ah:calc(100svh - 2*var(--m) - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));
   --bw:calc(.985*min(var(--aw)/K1,var(--ah)/K2));  --u:calc(var(--bw)/100);  --bh:BH;
   display:flex;flex-direction:column;align-items:{flex-start|center|flex-end};width:var(--bw);isolation:isolate;
   translate:calc(DX*var(--u)) calc(DY*var(--u));
   font-family:f;font-weight:{w};font-style:{s};font-feature-settings:{variant};font-synthesis:none;font-kerning:normal;
   text-rendering:geometricPrecision;text-transform:{none|uppercase|lowercase};white-space:nowrap;text-decoration:none;color:var(--fg)}
.l{display:block;position:relative}
.l1{--y:0;font-size:calc(var(--bw)/F1);width:calc(1em*W1);line-height:L1;height:calc(1em*H1);text-indent:calc(-1em*X1)}
.l2{--y:Y2;font-size:calc(var(--bw)/F2);width:calc(1em*W2);line-height:L2;height:calc(1em*H2);text-indent:calc(-1em*X2);margin-top:calc(G*var(--u))}
.l::before,.l::after{position:absolute;inset:0;pointer-events:none}
a.n:focus-visible{outline:max(3px,.35vmin) solid var(--fg);outline-offset:max(4px,.5vmin)}
@media (max-aspect-ratio:4/5){.n{   /* emitted only when pick.side is true */
   --aw:calc(100svh - 2*var(--m) - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));
   --ah:calc(100vw - 2*var(--m) - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px));
   rotate:90deg;translate:calc(-1*DY*var(--u)) calc(DX*var(--u))}}
```

Literals per pick: `1u` = 1% of block width. `F_i` = font-size divisor (`stack-fit`: `F_i = W_i`, each line fills the width; `stack-eq`: `F_1 = F_2 = max(W_1, W_2)`). `G = max(g, bt, bb)` with `g` a layout param `[4,10,2]` u and `bt`/`bb` the effect's top and bottom bleed. The gap clears ink travelling both ways: the two lines paint in tree order, so line 2's upward ink would cover line 1's glyphs and line 2's glyphs would cover line 1's downward ink. It is `max`, not `bt + bb` — the two inks may meet inside the gap, they just may not reach the other line's glyphs. `R = H_1/F_1 + H_2/F_2 + G/100`, `BH = 100·R`, `Y2 = 100·H_1/F_1 + G`. `K1 = 1 + (bl+br)/100`, `K2 = R + (bt+bb)/100`, `DX = (bl−br)/2`, `DY = (bt−bb)/2`. `translate` acts in screen space, hence the swapped pair under `rotate`. `--bh`/`--y` let one gradient span both lines: `background-size:100% calc(var(--bh)*var(--u)); background-position:0 calc(-1*var(--y)*var(--u))`.

Layouts in v1.0: `stack-fit` (odds 12), `stack-eq` (odds 4), plus independent keyed flag `side` (p = .25). A one-line layout is deliberately absent: it only wins above ~4.7:1, wider than any real display. If the 3-engine pixel scan (§9.2) rejects a font, the font is dropped, not fixed.

### 5.3 Randomization (`src/rand.js`, `src/pick.js`)

- `h32(str)`: xmur3a string hash + splitmix32 finalizer, integer math only (`Math.imul`, shifts, `>>>`). No `Math.random/pow/log` in `src/`. WP-10 pastes the 12 lines and three golden vectors into `docs/contracts.md`.
- **Keyed draws:** `draw(seed, key) = h32(seed + "\x1f" + key) / 2³²`. Stateless; a new axis never reshuffles the others.
- Weighted pick: cumulative scan over candidates sorted by id; integer `odds` 0–16 from the item, overridden by `data/weights.json` (`{"bucket":{…},"f":{id:n},"p":{},"e":{},"l":{},"preset":{}}`). `0` = retired.
- **Axis order (normative):** mode (free | preset, Wave 4) → `bucket` → font → file+variant → effect → effect params → palette → role set → layout + `side` + `g`.
  - `bucket` ∈ {A,B,C,D,E,F,X}, default odds `{A:3,B:3,C:3,D:3,E:3,F:3,X:2}` → 90% archetypes. Font candidates = fonts whose `archetype` contains the bucket; empty bucket → flat pool.
  - Pins are fixed before any draw. Each drawn axis filters against everything already fixed, **and removes candidates that would complete a `data/deny.json` rule**. Every axis has a universal fallback (`effect: plain`), so one pass always terminates.
  - `data/deny.json` = `{"deny":[{"f":"pacifico","e":"outline-rings"},{"e":"glow-neon","p":"wada1-176"}]}`; keys `f v p r e l`; a rule matches when all its keys equal the pick's. Per-font effect exclusions are `{f,e}` rules. Generated meta is never hand-edited.
- Params are quantized `[min,max,step]`; a draw picks a step index.
- Seeds match `/^[0-9a-hjkmnp-tv-z]{1,16}$/`.

### 5.4 Palettes

`data/palettes/<source>.json` = `[{id, src, tier, odds? (default 4; `qa-bw` has 0), names[], namesJa[]?, hex[], roles[]}]`. Ids namespaced (`wada1-176`, `wada2-031`, `kasane-042`, `edit-07`, `era-03`). `tier` ∈ `historical | editorial | era-approx`. Only combos of 2–4 colors ship in v1.0.

`scripts/roles.mjs` (pure, ~60 lines hand-rolled WCAG + OKLab; owned by WP-12, called by `palettes.mjs`; output committed, so deploy never runs color math):
1. Enumerate ordered `(bg, fg)` pairs; keep WCAG contrast ≥ 3:1. Remaining colors become `a1`, `a2` in both orders.
2. No passing pair (42% of Wada vol. 1): **derived ground** `w` = washi `oklch(.97 .02 h)` or `k` = sumi `oklch(.16 .02 h)`, `h` = hue of the first color; all original colors stay untouched as fg/a1/a2. Always terminates: any color reaches ~4:1 against one of the two.
3. Role set = `{o:"1023", dark:bool, n:2|3|4, derivedBg:"w"|"k"|null}`; `o` = hex indices for bg, fg, a1, a2; `w`/`k` = derived; `-` = aliased. Pick string: `p:wada1-176.1023`.
4. Runtime exposes exactly `--bg --fg --a1 --a2`. With 2 colors `--a1` = fg and `--a2` = bg. Never undefined.
5. `@media (prefers-contrast:more)` swaps in literal paper/ink for ≥ 12:1.

### 5.5 Fonts

**Source row** (`fonts/sources/<batch>.json`, hand-written; WP-14 writes all batches up front with disjoint ids; a unit test fails on duplicates):
`{id, family, url, sha256, licenseId, licenseUrl, copyright, archetype:[…], traits:[…], odds:0-16, stops?:[{wght:900,SOFT:100,…}] (≤4), features?:[…], cases?:[…]}`. `id` = kebab-case = file basename; one id per upstream file (`bungee`, `bungee-inline`, `bungee-shade` are separate fonts). `url` = raw file at an immutable VCS commit; where none exists (GUST/CTAN, foundry sites): direct file URL + sha256 **and** the original committed under `fonts/upstream/`. Never a zip. Empty `sha256` is filled on first run and committed.

**Pipeline rules** (`scripts/fonts.mjs`; each is a hard failure):
1. Never the Google css2 API: it strips `ssNN/salt/swsh/dlig` (verified; google/fonts#1335).
2. The 22 letters `TOMASZCUDIŁ tomaszcudił` map to glyphs with `glyphExtents` width > 0 and height > 0; space has advance > 0; gids of `Ł/ł` differ from `L/l`. The `latin-ext` label is ignored (wrong in both directions; Lombard ships an empty `Ł`).
3. Licence gate: read the licence header; **reject any font declaring a Reserved Font Name** (v1.0). `licenseId` ∈ `OFL-1.1 | Apache-2.0 | GUST`.
4. Variants ≤ 12 per font = case (`none/uppercase/lowercase`; collapsed for `capsOnly`/`unicase`; `connected` scripts never get `uppercase`) × **effective** feature sets (shape the two real words with the feature on vs off; keep only real diffs; case-like features `smcp c2sc unic titl` only if every letter incl. `Ł/ł` changes) × ≤ 4 stops.
5. **Every shipped file is a fully pinned static instance.** Per stop: `subsetFont(src, 'TOMASZCUDIŁ tomaszcudił', {targetFormat:'sfnt', noHinting:true, preserveNameIds:[13,14], dropTables:['STAT','MVAR'], variationAxes:{<every fvar axis>:<number>}, keepFeatures:[kern liga clig calt rlig rclt curs ccmp locl mark mkmk rvrn + effective tags]})`. Then `sfnt.mjs`: metrics (§5.2), **set OVERLAP_SIMPLE (0x40 on the first flag byte) / OVERLAP_COMPOUND (0x0400) on every glyf glyph** (pinned variable fonts have overlapping contours; Apple rasterizers punch holes without the flag), recompute table checksums + `head.checkSumAdjustment`. Then `woff2.mjs` → `fonts/files/<id>.<stop>.woff2`.
6. `scripts/woff2.mjs` (~100 lines, `node:zlib` only): 48-byte header, directory with known-tag flags, `glyf`/`loca` marked transform version 3 (null transform, which preserves the overlap flags that the 2018-era `wawoff2` encoder strips), one `brotliCompressSync` (quality 11, `BROTLI_MODE_FONT`). `decode()` is the inverse for tests. Acceptance: `decode(encode(x))` tables byte-identical; file loads in Chromium, Firefox, WebKit. **Escape hatch** if it cannot pass within WP-11's timebox: add `fontverter` as an explicit sixth devDependency (owner approves), accept the overlap-flag loss, and drop fonts that show artifacts.
7. Budget: **≤ 10,500 B per file hard stop**, target ≤ 8 KB. Over: drop features that never fire, then stops, then variants, then the font (list it in the PR body). The response test (§9.1, ≤ 14,000 B brotli) is the final gate.
8. Licence file `fonts/licenses/<id>.txt` = upstream licence text (Apache: + NOTICE if any; GUST: + upstream MANIFEST; Warsaw Types, which state OFL only in a README: README copyright line + canonical OFL-1.1 text, with `licenseEvidence:{url,quote}` in the meta — **these PRs wait for an owner yes**), prefixed by: `Modified by luzid.co: 23-glyph subset of <family> <version>; hinting removed; vertical metrics changed. Original: <url>` (satisfies Apache §4(b) and LPPL §6). Nothing is written outside `fonts/`. `THIRD_PARTY_NOTICES.md` is a static pointer file from WP-00; WP-53 may generate a readable table once at the end.

**Meta** (`fonts/meta/<id>.json`, generated): `{id, family, src:{url,sha256}, licenseId, copyright, archetype, traits, odds, files:[{id:"w900-soft", axes:{…}, bytes, sha256, asc, desc, glyphs:23}], variants:[{id, file, case, css:{weight,style,feat}, w1:{W,H,X,top}, w2:{…}}]}`.

**Traits — closed enum**, lint-enforced in font rows and effect files; unknown trait = build failure; adding one = `contract` PR:
`serif sans slab script brush blackletter deco rounded unicase mono fat hairline condensed wide inline shaded stencil soft groovy connected capsOnly overlap jp`. Measured by the pipeline where possible (`capsOnly`, `unicase`, `overlap`, `hairline` from stem width, `connected` from `curs`/script joins), else set by hand.

### 5.6 Effects (`effects/<id>.js`; id = `<family>-<slug>` = file basename)

```js
export default {
  id: 'depth-extrude', family: 'depth',
  shape: 'A',                       // 'A' plain text | 'B' uses .l::before/::after copies
  colors: 3,                        // roles used: 2 = bg,fg · 3 = +a1 · 4 = +a2
  bg: 'any',                        // 'any' | 'dark' | 'light'
  fonts: { deny: ['script', 'hairline'], prefer: ['fat'] },     // traits; prefer = ×2 odds
  palettes: { prefer: [] },         // e.g. ['kasane','dark','n4']
  params: { d: [3, 9, 1], a: [45, 315, 90] },                    // [min,max,step]; lengths in u, angles in deg
  bleed: (p, m) => ({ t: 0, r: p.d, b: p.d, l: 0 }),             // u; must bound ALL painted ink incl. blur and hover
  css:   (p, h, m) => `.n{text-shadow:${h.stack(48, p.a, p.d, 'var(--a1)')}}`,
  hover: null,                      // optional (p,h,m) => css for a.n:hover / a.n:active; ≤ 200 ms transitions
  motion: null,                     // reserved for Wave 4; must be null in Waves 0–3
}
```

`m` = `{fs:[100/F1,100/F2], H, top, asc, desc, G, R, layout}` in u (needed by `text-emphasis`, underlines, floor shadows). The renderer emits `hover` as `@media (hover:hover) and (pointer:fine){a.n:hover{…}} a.n:active{…}` inside `prefers-reduced-motion:no-preference`; effects with `hover:null` get the shared default `a.n:active{scale:.985}`. Zero JS, zero DOM: this is v1.0's interactivity.

Lint (unit test over every effect file):
- Lengths only via `h.u(x)` / `var(--u)`; colors only the four role vars or `color-mix()`/relative colors of them.
- Selectors only `.n .l .l1 .l2` + their `::before/::after`; `:hover/:active` only inside `hover`.
- Property allowlist on `.n/.l`: `color background* (-webkit-)background-clip text-shadow -webkit-text-stroke* -webkit-text-fill-color paint-order filter opacity mix-blend-mode clip-path mask* text-decoration* text-emphasis*`; pseudo-elements additionally `content transform translate scale rotate z-index`.
- Inherited text paint (`text-shadow`, stroke, `paint-order`) goes on `.n`. Shadows reaching upward more than ~10u must paint as a group (`filter:drop-shadow` on `.n`, chain ≤ 4) or as `.l::before{z-index:-1}` copies. `.n` is an isolated stacking context, so blend effects paint their own ground inside `.n`.
- `background-clip:text` only on `.l/.l1/.l2` or their pseudo-elements, never `.n` (older Chrome/Safari drop positioned descendants from the clip); always paired with `-webkit-background-clip:text`; all layers clipped to text; `color:transparent`; **never `text-shadow` on the same element** (it paints over the fill; use `filter:drop-shadow` or a shape-B copy).
- Shape B sets exactly `content:attr(data-t) / ""`; the renderer wraps the whole effect in `@supports (content:"x" / ""){…}`, so older engines show plain text with one correct accessible name.
- No `url()` except `data:`; no `@import`; no `animation/transition/@keyframes` outside `hover`/`motion`.
- Measured caps (Chromium, M-series; halve if phone QA complains): hard shadow layers ≤ 64; blurred shadows ≤ 4, radius ≤ 2.5u; `drop-shadow` chain ≤ 4 (cost doubles per pass from 6 up).

### 5.7 Presets hook (content arrives in Wave 4)

`presets/<id>.json` = `{id, odds, pins:{e?, l?}, fonts:{traits:[…]} | {ids:[…]}, palettes:{prefer:[…]}, params?:{…}}`. `mode` draws `preset` with total share ≤ 20% (from `data/weights.json`), then the preset narrows candidate pools; everything else still randomizes. Neutral ids only (`riso-zine`, `showa-sleeve`), never trademarks. With an empty `presets/` dir the mode axis is a no-op.

### 5.8 Accessibility gating (emitted by `render.js`; effects are gated, not reset)

```css
/* base, always: fit block + html,body{background:var(--bg)} .n{color:var(--fg)} */
@media screen and (forced-colors:none) and (prefers-contrast:no-preference){ {effect css} {hover css}
  @media (prefers-reduced-motion:no-preference){ {hover transitions} {motion css} } }
@media (prefers-contrast:more){:root{--bg:{paper|ink};--fg:{ink|paper}}}
@media print{html,body{background:none}.n{color:#000}}
```

Forced-colors needs no author rules (UA paints `LinkText` on `Canvas`). Unit test: no effect selector appears outside the gate. WCAG 1.4.4 (viewport-sized text cannot be resized 200%) is recorded in `docs/a11y.md` as an accepted deviation: zoom never blocked, real text always present.

---

## The `h32` listing

`src/rand.js`, verbatim. It is bryc's **xmur3a** run once: a murmur3 block round per UTF-16
code unit over the FNV offset basis, finished with murmur3's `fmix32`. Integer math only.

```js
export function h32(str) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    let k = Math.imul(str.charCodeAt(i), 3432918353)
    k = (k << 15) | (k >>> 17)
    h ^= Math.imul(k, 461845907)
    h = (h << 13) | (h >>> 19)
    h = (Math.imul(h, 5) + 3864292196) | 0
  }
  h ^= str.length
  h ^= h >>> 16
  h = Math.imul(h, 2246822507)
  h ^= h >>> 13
  h = Math.imul(h, 3266489909)
  h ^= h >>> 16
  return h >>> 0
}
```

It is **not** byte-exact `MurmurHash3_x86_32`, so the published murmur3 test vectors do not
apply. Use these, measured on Node 24 / V8 13.6 and asserted in `test/rand.test.js`:

| input | `h32` |
|---|---|
| `""` | `ab3e7c0b` |
| `"a"` | `b3478aa8` |
| `"font:rubik-mono-one"` | `66cc69e9` |
| `"k3f9x2m7qa"` + U+001F + `"f"` | `1a30d477` |
| `"k3f9x2m7qa"` + U+001F + `"font"` | `76b82890` |
| `"k3f9x2m7qa"` + U+001F + `"fx/depth"` | `10a2f047` |

`draw(seed, key) = h32(seed + U+001F + key) / 2**32`. The separator cannot occur in a seed
or an axis key, so the concatenation is injective and two different axes can never collide.

`mix32` — splitmix32's finalizer, constants `0x21f0aaad` / `0x735a2d97`, shifts 16/15/15 —
is exported alongside but is **not** part of `h32`. It exists for a recipe that needs to
decorrelate a counter from a single keyed draw. Vectors: `mix32(1) = 86d2fa73`,
`mix32(0xdeadbeef) = 2a2acaf2`, `mix32(0) = 0` (a harmless fixed point).

Changing any of this reshuffles every seed in existence. It is a `contract` PR.

## Resolutions

Where §5 left a choice, this is the choice the engine made. Each one is pinned by a test.

### R1 — `h32` is xmur3a + `fmix32`, not xmur3a + the splitmix32 finalizer

§5.3 says "xmur3a string hash + splitmix32 finalizer". Taken literally that does not
reproduce the three golden vectors §5.3 itself tells WP-10 to paste here, and which the
research measured. bryc's xmur3a *is* murmur rounds plus `fmix32`; the plan's phrasing
conflates the two murmur-style finalizers. The vectors won: they are checkable, and every
other package builds against them. `mix32` is exported separately, so nothing is lost.

### R2 — the weighted pick is a cumulative scan, not rendezvous hashing

`gap-randomization-engine-contract.json` recommends weighted HRW for its minimal-disruption
property (4.8% of seeds move when 4.76% of weight is added, against 93.9% for an index
scan). §5.3 overrides it with "cumulative scan over candidates sorted by id", and the plan
wins. Sorting by **id** rather than array order removes the worst of the index dependence —
a glob-order change cannot move a pick — but adding an item still shifts the seeds of every
item sorted after it. `test/property.test.js` measures and bounds that drift. Soft
permalinks are therefore weaker here than the research assumed; pins remain the stable repro.

### R3 — the effect axis checks its colour and polarity needs forward

§5.3 fixes the axis order effect → palette, and §5.6 has the effect declare `colors` and
`bg`. Those are needs on an axis that has not been drawn yet. If the effect axis ignores
them, a 3-colour effect can be drawn and then land on a 2-colour role set, where `--a1`
aliases `--fg` and the effect paints itself invisible. The effect axis therefore also
requires that **some** role set in the (pin-filtered) palette pool satisfies it. Termination
is unaffected: `plain` is `colors: 2, bg: any`, which every role set satisfies.

### R4 — a derived ground's hex is appended to the row's own `hex`

§5.4 defines `w` / `k` as a derived washi/sumi ground but never says where the literal
lives, and §5.4 also forbids colour maths at render time. WP-12's convention, implemented
here: a row that needs a ground appends both to its `hex`, **washi first, then sumi**, after
its real colours. `names.length` is the divider, so `w` is `hex[names.length]` and `k` is
`hex[names.length + 1]`, and `hex.length` may exceed `names.length` by up to 2. `names`
stays the authoritative list of the row's genuine colours — the colophon credits those and
never a derived ground.

Aliasing is generalised by position, which §5.4 only spelled out for two colours:
`o[2] === '-'` aliases `--a1` to `--fg`, `o[3] === '-'` aliases `--a2` to `--bg`. All four
custom properties always resolve.

### R5 — every axis relaxes rather than empties; deny is the last thing relaxed

The §5.3 termination argument is "every axis has a universal fallback". Concretely, each
axis filters in this order and each step is skipped when it would empty the candidate set:
pin → compatibility → deny → odds > 0. So a retired item is drawn only if every candidate
is retired, and a deny rule is ignored only if honouring it would leave the axis with
nothing. The named fallbacks are `plain` for the effect axis and the flat font pool for an
empty bucket.

A **pin** bypasses compatibility, deny and odds entirely. That is what makes
`?p=qa-bw&e=plain` work (`qa-bw` has odds 0) and what keeps a retired item resolvable for a
bug report. Pins are still validated: an id nothing in the catalog answers to is a 400, and
so is a pin combination that leaves an axis empty.

### R6 — `hover()` returns declarations; `render.js` owns the selector

§5.6 describes `hover` both as "css for `a.n:hover` / `a.n:active`" and as something the
renderer wraps in `@media (hover:hover) and (pointer:fine){a.n:hover{…}} a.n:active{…}`.
The second is more specific and is what is implemented: `hover(p, h, m)` returns a
declaration list, with no selector and no braces. An effect with `hover: null` gets the
shared default `a.n:active{scale:.985}`.

Transitions are renderer-owned and live in the nested
`@media (prefers-reduced-motion:no-preference)` block, per §5.8's structure. Effects may not
write `transition`, `animation` or `will-change` at all in v1.0. Hover declarations are
linted against the `.n` allowlist plus `translate`, `scale` and `rotate`.

### R7 — effects emit a flat list of style rules, never an at-rule

`@media`, `@supports` and the reduced-motion nesting all belong to `render.js`. This is what
makes "no effect selector outside the §5.8 gate" provable rather than a convention: the
renderer wraps one opaque string and the test checks where that string landed. Shape B is
wrapped in `@supports (content:"x" / "")` by the renderer, not by the effect.

### R8 — the layout axis also draws `align`

§5.2's `.n` template offers `align-items:{flex-start|center|flex-end}` while §5.3's axis
list names only `side` and `g`. `align` is drawn as part of the layout axis (key `l/a`,
odds `center 8 · flex-start 4 · flex-end 4`) and appears in the canonical string. It can
only show a difference under `stack-eq`, where the two lines have different widths.

### R9 — the canonical Pick string carries the layout's parameters

§4.4 fixes `f:<id>.<variant> p:<id>.<roles> e:<id>(k=v,…) l:<id>`. The layout's own drawn
values are appended in the same `(k=v,…)` convention the effect uses, so the string fully
describes the render:

```
f:fx-sans.up p:fx-ground.k10- e:depth-extrude(a=225,d=8) l:stack-fit(g=6,a=flex-start,side)
```

Deny rules and pins match on the plain ids (`f v p r e l`), never on this rendering.

### R10 — `fonts/meta/*.json` must carry `upm`, and `bleed()` sees a provisional `G`

§5.2 needs `ASC` and `DESC` "÷ upm", and the §5.5 meta schema lists `asc` and `desc` on each
file entry but no `upm`. The engine divides by `font.upm` when the font meta carries one and
treats `asc` / `desc` as already-em otherwise. **WP-11 should emit `upm` at the top level of
each font meta.** Everything else the renderer reads (`w1`, `w2`) is already in em.

`G = max(g, bleed.t, bleed.b)` while `bleed(p, m)` takes `m`, which contains `G` — a cycle. It is
broken by two passes: `bleed()` receives an `m` computed with `G = g`, and `css()` and
`hover()` receive the final `m`. A bleed that reads `m.G` is therefore reading the layout
gap, not the resolved gap.

### R11 — a system-font fallback exists so the engine is total before WP-11

With `fonts/meta/` empty, `pick()` returns a built-in `system` font (a bold serif stack with
hand-estimated ink metrics) and `render()` emits no `@font-face`. The fit is approximate and
the §9.2 pixel scan does not gate it. It disappears the moment one real font meta lands.
The same safety net exists for `data/palettes/` and `effects/`, neither of which is ever
actually empty (`data/palettes/qa.json` and `effects/plain.js` ship).

### R12 — the colophon keeps the tuple verbatim

Only the data-derived parts of the comment (font family, copyright, colour names) have runs
of hyphens collapsed. The canonical tuple does not: `10--` is an ordinary role-set id and
the point of the colophon is that it can be copied straight into a bug report. `<` and `>`
are stripped from the whole line, which makes `-->` unconstructible.

### R13 — the gap clears downward ink too

All four Wave-2 effect families independently reported the same gap: `G = max(g, bleed.t)`
had no counterpart for ink falling out of line 1 into line 2, so line 2's glyphs painted
over line 1's shade. The only workaround available to an effect was to declare a top bleed
it never painted into, purely to widen the gap — dead space above line 1, measured at 3-7%
of block width at phone size. Six of the eight retro-print effects took that deal.

`G = max(g, bleed.t, bleed.b)` removes the need for it. Effects that declared a phantom
top bleed should drop it.

### R14 — a blurred shadow reaches about 1.0x its radius

`text-shadow` and `drop-shadow()` both take the blur radius as a Gaussian *diameter* hint,
sigma = radius / 2. A Gaussian is often quoted as visible to 3 sigma, which suggested 1.5r,
and that is what this resolution first said. It is wrong in practice, and WP-13 measured it
rather than arguing it.

Reading the computed `text-shadow` back off the page and solving for the multiplier m where
`max(offset + m * blur)` equals the measured painted edge gives **0.89-1.05** at the loosest
threshold a PNG can express (delta > 2/255), 0.47-0.93 at delta > 8, and at most 0.76 at
delta > 25. The maximum anywhere was 1.05. The analytic profile agrees: at 1.0r the layer
alpha is 2.3%, and at 1.5r it is 0.17%, which on black-on-white is a channel delta of 0.43 --
below what a PNG can even represent.

**Budget 1.0r, or 1.1r with a safety factor.** 1.5r is not conservative, it is wasteful: it
throws away 2.1u of a 100u block for `glow-neon-outline` at its widest blur.

Two things a static audit of shadow lists cannot see, so do not trust one alone:
a `-webkit-text-stroke` composed with blurred shadows (half the stroke lies outside the
contour and adds to every layer's reach), and shape-B geometry, where the ink comes from a
translated pseudo-element and no shadow list mentions it at all.
