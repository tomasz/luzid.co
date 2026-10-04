# luzid.co — engine contracts

This file is the source of truth for the engine, the fit maths, the file schemas and the
effect contract. It wins over `AGENTS.md` and over any comment in the code. Changing it
needs a PR labelled `contract`, merged by the owner.

**§5** below began as the approved plan's text and has since been settled against the code
(where the two disagreed, the text now says what the engine does). Everything under **"The
`h32` listing"** and **"Resolutions"** is WP-10's implementation of it: the code that had to
be pinned exactly, and the places where the plan text left a choice the engine had to make.
Read the resolutions — several are things the plan implies but does not say, and a later
work package that guesses differently will break a golden.

A rule marked **pending** with a row id is agreed but not yet in the code; that row of the
refactor plan lands it, and until then the text next to it says what runs today. The accessibility policy lives in [`a11y.md`](a11y.md), the vocabulary in
the [Glossary](#glossary) at the end.

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
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,{two-swatch svg, < > # as %3C %3E %23}"><link rel="icon" href="/favicon.ico" sizes="32x32">
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

The data-URI icon is omitted when `--bg` or `--fg` is not a plain hex literal; the static `.ico` link is always there.

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
- Weighted pick: cumulative scan over candidates sorted by id; integer `odds` 0–16 (floored, then clamped) from the item, default 4, overridden by `data/weights.json`. `0` = retired. Every key of `weights.json` is optional:

  | key | ids | default when absent |
  |---|---|---|
  | `bucket` | `A`…`F`, `X` | the bucket odds below |
  | `f`, `p`, `e`, `preset` | the item's id | the item's own `odds`, else 4 |
  | `v` | `<font>.<variant>`, e.g. `bungee.n-base-static` | 4 (variants carry no `odds`) |
  | `r` | `<palette>.<o>`, e.g. `wada1-176.k012` | 4 (role sets carry no `odds`) |
  | `l` | layout id | the layout's odds in §5.2 |
  | `mode` | `free`, `preset` | `{free: 8, preset: 2}`; drawn only when `presets/` is non-empty |

  `v` and `r` are qualified because variant ids (`n-base-static`) and role-set ids (`10--`) repeat across fonts and palettes; `weights.json` is a flat map per axis, so the owner is part of the key. A `prefer` match doubles an effect's or palette's odds after the override.
- **Axis order (normative):** mode (free | preset, Wave 4) → `bucket` → font → file+variant → effect → effect params → palette → role set → layout + `side` + `g`.
  - `bucket` ∈ {A,B,C,D,E,F,X}, default odds `{A:3,B:3,C:3,D:3,E:3,F:3,X:2}` → 90% archetypes.
    The six are taste buckets taken from the owner's reference images, not technical
    classes: **A** soft 70s display serif · **B** ultra-heavy wide caps with inline or
    stencil cuts · **C** bold casual brush script · **D** fat groovy psychedelic caps ·
    **E** rounded geometric display · **F** elegant deco and nouveau serif with alternates.
    E was originally written as "rounded geometric unicase", but only 2 of its 26 curated
    faces measure unicase — the rest are ordinary bicameral rounded geometrics, and the
    reference image is a rounded geometric that happens also to be unicase. The bucket is
    named for the silhouette it actually selects. Font candidates = fonts whose `archetype` contains the bucket; empty bucket → flat pool.
  - Pins are fixed before any draw. Each drawn axis filters against everything already fixed, **and removes candidates that would complete a `data/deny.json` rule**. Every axis has a universal fallback (`effect: plain`), so one pass always terminates.
  - `data/deny.json` = `{"deny":[{"f":"pacifico","e":"outline-ring"},{"e":"glow-neon","p":"wada1-176"}]}`; keys `f v p r e l`; a rule matches when all its keys equal the pick's plain ids (R9). Per-font effect exclusions are `{f,e}` rules. Generated meta is never hand-edited.
  - A deny rule qualifies a variant or a role set by naming its owner in the same rule: a rule with `v` also names `f`, a rule with `r` also names `p` (`{"f":"bungee","v":"n-ss11-static","e":"glow-neon"}`). A bare `v` or `r` would match that id in every font or palette at once.
  - **Every id must resolve.** Each id in `deny.json` and each key in `weights.json` names something in the catalog (for `v` and `r`, within the named font or palette). Today nothing checks this and a stale id is silently inert (pending B2: the catalog build rejects it with `file: /pointer: message`).
- Params are quantized `[min,max,step]`: `step > 0`, `max ≥ min`, and the grid is **exact** — `(max − min) / step` is an integer at four-decimal precision, so `max` is a grid point. A draw picks a step index `i` in `[0, round((max − min) / step)]` uniformly under key `e/<effect>/<param>`; the value is `round4(min + i·step)`, so both `min` and `max` are drawn. The quotient is rounded, never floored: an exact grid can divide to just under an integer in floating point (`(2 − 0.8) / 0.4` is `2.9999999999999996`). The catalog build rejects a grid whose quotient is not within `1e-9` of an integer, and `step()` asserts the same. Lengths are in u, angles in degrees.
- Seeds match `/^[0-9a-hjkmnp-tv-z]{1,16}$/`.

### 5.4 Palettes

`data/palettes/<source>.json` = `[{id, odds? (default 4; `qa-bw` has 0), names[], namesJa[]?, hex[], roles[{o, dark}]}]`. Ids namespaced by the file (`wada1-176`, `wada2-031`, `kasane-042`, `edit-07`, `era-03`). A file stores only what cannot be derived; the catalog build adds `src` = the file name and `tier` ∈ `historical | editorial | era-approx` = the `tier` of the adapter `scripts/palette-sources/<source>.mjs`. A file with no adapter (the hand-written `qa.json`) has no `tier`, and a `tier` prefer token never matches it. Only combos of 2–4 colors ship in v1.0.

`scripts/roles.mjs` (pure, ~60 lines hand-rolled WCAG + OKLab; owned by WP-12, called by `palettes.mjs`; output committed, so deploy never runs color math):
1. Enumerate ordered `(bg, fg)` pairs; keep WCAG contrast ≥ 3:1. Remaining colors become `a1`, `a2` in both orders.
2. No passing pair (42% of Wada vol. 1): **derived ground** `w` = washi `oklch(.97 .02 h)` or `k` = sumi `oklch(.16 .02 h)`, `h` = hue of the first color; all original colors stay untouched as fg/a1/a2. Always terminates: any color reaches ~4:1 against one of the two.
3. Role set = `{o:"1023", dark:bool}` plus two fields derived from `o`: `o` = hex indices for bg, fg, a1, a2; `w`/`k` = derived; `-` = aliased. Pick string: `p:wada1-176.k012`.
   - **`colors`** = the number of distinct slots `o` fills, i.e. its characters other than `-` (`10--` → 2, `w01-` → 3, `0123` → 4). It is what an effect's `colors` is compared against (R3): an effect needing 3 roles needs `--a1` to be a colour of its own, whatever the size of the palette it came from. A derived ground is a slot like any other.
   - **`ground`** = `o[0]` when it is `w` or `k`, else `null`.
   - Both are derived by the catalog build and never stored; a file that stores either (or the former `n` / `derivedBg`) fails the build. The palette prefer token `n2`…`n4` reads `colors` too. Of the 2,581 Wada vol. 1 role sets, 1,427 sit on a derived ground, and 563 of those fill one slot more than their palette has colours (193 two-colour palettes on 3 slots, 370 three-colour palettes on 4), which the former stored `n` (the palette's colour count) hid from the effects needing that many roles.
4. Runtime exposes exactly `--bg --fg --a1 --a2`. With 2 colors `--a1` = fg and `--a2` = bg. Never undefined.
5. `@media (prefers-contrast:more)` swaps in literal paper/ink for ≥ 12:1.

### 5.5 Fonts

**Source row** (`fonts/sources/<batch>.json`, hand-written; WP-14 writes all batches up front with disjoint ids; a unit test fails on duplicates):
`{id, family, url, sha256, licenseId, licenseUrl, copyright, archetype:[…], traits:[…], odds:0-16, stops?:[{id:"w900x", wght:900, wdth:150,…}] (≤4), features?:[…], cases?:[…]}`. `id` = kebab-case = file basename; one id per upstream file (`bungee`, `bungee-inline`, `bungee-shade` are separate fonts). `url` = raw file at an immutable VCS commit; where none exists (GUST/CTAN, foundry sites): direct file URL + sha256 **and** the original committed under `fonts/upstream/`. Never a zip. Empty `sha256` is filled on first run and committed.

**Stop and variant ids.** A stop pins every `fvar` axis and its `id` (kebab-case, unique in the row) becomes the shipped filename `fonts/files/<font>.<stop>.woff2`; a font with no axes has the one implicit stop `static`. The curator names stops; the vocabulary in use, which new rows follow:

| stop id | means |
|---|---|
| `static` | no axes |
| `w<wght>` | weight only, e.g. `w900` |
| `w<wght>` + `n` / `c` / `x` / `w` | plus width: `n` normal, `c` condensed, `x` or `w` wide |
| `w<wght>` + `d` / `t` | plus optical size: `d` display, `t` text |
| first letter of the axis + value | one non-weight axis: `o14` (`opsz`), `y1979` (`YEAR`), `e100` (`ELSH`), `m30` (`MORF`) |
| a word | a named axis combination: `flat`, `tilt` |

A variant id is `<case>-<features>-<stop>`: case `n` / `u` / `l` (none, uppercase, lowercase), the effective feature tags joined by `-` or `base`, then the stop id — `n-base-static`, `n-ss01-w900x`.

**Pipeline rules** (`scripts/fonts.mjs`; each is a hard failure):
1. Never the Google css2 API: it strips `ssNN/salt/swsh/dlig` (verified; google/fonts#1335).
2. The 22 letters `TOMASZCUDIŁ tomaszcudił` map to glyphs with `glyphExtents` width > 0 and height > 0; space has advance > 0; gids of `Ł/ł` differ from `L/l`. The `latin-ext` label is ignored (wrong in both directions; Lombard ships an empty `Ł`).
3. Licence gate. `licenseId` ∈ `OFL-1.1 | Apache-2.0 | GUST`. Reserved Font Names are read from the **licence header only** — everything above the first rule of five or more dashes — plus name ID 0 of the binary: the OFL body itself defines the phrase, so a whole-file search matches every OFL font there is, and some fonts declare a name only in the binary (Oleo Script reserves "Oleo", Molle reserves "Spinnaker"). A declared name is **renamed, not refused**. The names go into the meta as `rfn:[…]`, `[]` when there are none; a clause the parser cannot read a name out of is a hard failure. With `rfn` non-empty the subset ships under the neutral internal family `neutralName(id, [family, …rfn])` = `LZ <6 hex>` of `sha256(id)`, re-rolled with a salt while it collides with a reserved word: name IDs 1-6 are rewritten (5 keeps its version number only, 6 loses the space) and everything else but 0, 13 and 14 is dropped. With `rfn` empty **nothing is touched**: the OFL requires renaming only of a reserved name. Attribution is never the thing that moves — name IDs 0, 13 and 14 (copyright, licence, licence URL; OFL FAQ 2.4), `fonts/licenses/<id>.txt`, the change notice and the source URL all stay exactly as they are, and `meta.family` and the colophon still credit the original family by name. **Lint:** no name record but 0, 13 and 14 may contain the upstream family name or any reserved word, compared lowercased with whitespace removed. The CSS family alias is `f` and is neutral already.
4. Variants ≤ 12 per font = case (`none/uppercase/lowercase`; collapsed for `capsOnly`/`unicase`; `connected` scripts never get `uppercase`) × **effective** feature sets (shape the two real words with the feature on vs off; keep only real diffs; case-like features `smcp c2sc unic titl` only if every letter incl. `Ł/ł` changes) × ≤ 4 stops.
   - **Two variants that draw the same thing are one variant.** A variant is identified by the outline of each shaped glyph and its advance — *not* by glyph id, and *not* including GPOS placement. Candidates are compared against every variant already kept, not only against plain text, which is what collapses alias tags (`salt` ≡ `ss01`), `uppercase`+`c2sc` against `lowercase`+`smcp`, and substitutions to an identically drawn glyph.
   - **Placement alone is not a look.** A feature selecting the same glyphs with the same advances and only moving them with a GPOS placement is rejected. The fit normalises to the ink box — box top pinned to block top, box width sets the font size — so the shift is normalised back out and only a per-glyph jitter survives. Bungee's `ss12` is the precedent: `ss01`'s glyphs and advances, shifted about −0.208 em, and Linux WebKit applies that placement with the **opposite sign** (ink top −27.11 px against −0.10 px on Firefox and Darwin WebKit, 2.025× the shift), putting the name 12 px off centre. x and y are treated alike: under the fit they are symmetric, and rejecting both costs nothing — the library has no x-only pair at all.
5. **Every shipped file is a fully pinned static instance.** Per stop, `scripts/fonts/subset.js` calls hb-subset directly through `harfbuzzjs/dist/harfbuzz-subset.wasm`: the code points of `'TOMASZCUDIŁ tomaszcudił'`, flags `HB_SUBSET_FLAGS_NO_HINTING | HB_SUBSET_FLAGS_SET_OVERLAPS_FLAG` (0x01 | 0x10), name IDs 13 and 14 kept on top of hb's defaults, `STAT` and `MVAR` dropped, every fvar axis pinned with `hb_subset_input_pin_axis_location`, layout features exactly `[kern liga clig calt rlig rclt curs ccmp locl mark mkmk rvrn + effective tags]`. `SET_OVERLAPS_FLAG` **sets OVERLAP_SIMPLE (0x40 on the first flag byte) / OVERLAP_COMPOUND (0x0400) on every glyf glyph** (pinned variable fonts have overlapping contours; Apple rasterizers punch holes without the flag). Then `sfnt.mjs`: metrics (§5.2), rebuild `name` when rule 3 says to rename (`hb-subset` cannot rewrite name IDs 1-6; it only chooses which records to keep), recompute table checksums + `head.checkSumAdjustment`; the verifier re-reads the overlap flags from the shipped file. Then `woff2.mjs` → `fonts/files/<id>.<stop>.woff2`.
6. `scripts/woff2.mjs` (~100 lines, `node:zlib` only): 48-byte header, directory with known-tag flags, `glyf`/`loca` marked transform version 3 (null transform, which preserves the overlap flags that the 2018-era `wawoff2` encoder strips), one `brotliCompressSync` (quality 11, `BROTLI_MODE_FONT`). `decode()` is the inverse for tests. Acceptance: `decode(encode(x))` tables byte-identical; file loads in Chromium, Firefox, WebKit.
7. Budget: **≤ 10,500 B per file hard stop**, target ≤ 8 KB. Over: drop features that never fire, then stops, then variants, then the font (list it in the PR body). The response test (§9.1, ≤ 14,000 B brotli) is the final gate.
8. Licence file `fonts/licenses/<id>.txt` = upstream licence text (Apache: + NOTICE if any; GUST: + upstream MANIFEST; Warsaw Types, which state OFL only in a README: README copyright line + canonical OFL-1.1 text, with the evidence — the README's immutable URL and the quoted lines — in `fonts/upstream/<id>.notice.txt`, which the generator appends to the licence file; **these PRs wait for an owner yes**. An earlier draft put it in the meta as `licenseEvidence:{url,quote}`; nothing ever wrote or read that field, and the committed notice is what ships next to the font, so the notice file is the contract), prefixed by: `Modified by luzid.co: 23-glyph subset of <family> <version>; hinting removed; vertical metrics changed. Original: <url>` (satisfies Apache §4(b) and LPPL §6). Nothing is written outside `fonts/`. `THIRD_PARTY_NOTICES.md` is a static pointer file from WP-00; WP-53 may generate a readable table once at the end.

**Meta** (`fonts/meta/<id>.json`, generated): `{id, rfn:[…], measured:[…], upm, files:[{id:"w900x", axes:{…}, bytes, sha256, asc, desc, stem, crossbar, glyphs:23}], variants:[{id, file, case, css:{weight,style,feat}, w1:{W,H,X,top}, w2:{…}}]}` — measured facts only. What a curator decides stays in the source row alone, and the catalog build joins it in by id: the font record is `{id, family, src:{url,sha256}, licenseId, copyright, rfn, archetype, traits, odds, upm, files, variants}`, with `src` the row's `url` and `sha256`, and `traits` the row's plus `measured`, sorted (a row that names `capsOnly` or `unicase` keeps its word for that one measurement). So re-bucketing a font, or changing its odds or a hand-set trait, is a row edit that needs neither the font pipeline nor the network. The build fails when a built font has no row, when its row's `sha256` is still empty, or when the row declares a measured trait the meta did not measure. `rfn` is required — `[]` when nothing is reserved — because rule 3's rename is recomputed from it. `measured` lists which of the five measured traits the outlines bear out. The row's `family` is always the upstream family — what the colophon credits — whatever the shipped files are named internally. `upm` is the em grid every metric and ink measurement is in; `stem` (capital `I`) and `crossbar` (narrowest stroke in `Ł`/`ł`) are per stop, in em, for effects that add a stroke and would otherwise close a thin crossbar.

**Traits — closed enum**, lint-enforced in font rows and effect files; unknown trait = build failure; adding one = `contract` PR:
`serif sans slab script brush blackletter deco rounded unicase mono fat hairline condensed wide inline shaded stencil soft groovy connected capsOnly overlap jp`. Measured by the pipeline where possible (`capsOnly`, `unicase`, `overlap`, `hairline` from stem width, `connected` from `curs`/script joins), else set by hand.

### 5.6 Effects (`effects/<id>.js`; id = `<family>-<slug>` = file basename)

```js
export default {
  id: 'depth-extrude', family: 'depth',
  shape: 'A',                       // 'A' plain text | 'B' uses .l::before/::after copies
  colors: 3,                        // role-set slots needed (§5.4 `colors`): 2 = bg,fg · 3 = +a1 · 4 = +a2
  bg: 'any',                        // 'any' | 'dark' | 'light'
  odds: 6,                          // 0–16, default 4; `e` in data/weights.json overrides
  fonts: { deny: ['script', 'hairline'], prefer: ['fat'] },     // traits; prefer = ×2 odds
  palettes: { prefer: [] },         // tokens: source or id prefix, 'dark' | 'light', 'n2'…'n4', tier; ×2 odds
  params: { d: [3, 9, 1], a: [45, 315, 90] },                    // [min,max,step], exact grid (§5.3); lengths in u, angles in deg
  bleed: (p, lines, h) => ({ t: 0, r: p.d, b: p.d, l: 0 }),      // u; must bound ALL painted ink incl. blur and hover
  css:   (p, h, m) => `.n{text-shadow:${h.stack(48, p.a, p.d, 'var(--a1)')}}`,
  hover: null,                      // optional (p, h, m) => declarations, or the string itself; no selector (R6)
  motion: null,                     // reserved for Wave 4; must be null in Waves 0–3
}
```

`m` = `{fs, H, top, asc, desc, G, R, layout}` (needed by `text-emphasis`, underlines, floor shadows), lengths in u. `fs`, `H`, `top`, `asc` and `desc` are pairs `[line 1, line 2]` (`fs = [100/F1, 100/F2]`); `G` is the resolved gap, `R` the block height as a fraction of its width (so not in u), `layout` the layout id. `bleed(p, lines, h)` receives the line geometry only, `lines` = `{fs, H, top, asc, desc, layout}`: `G` and `R` depend on the bleed, so it cannot see them, and `fit()` calls it exactly once. Its `h` is the same helpers object the other hooks get, so a bleed can be `h.toward(p.a, p.d)`.

**Where hover lands.** The renderer emits the declarations as `@media (hover:hover) and (pointer:fine){a.n:hover{…}}a.n:active{…}` inside the §5.8 gate and **outside** `prefers-reduced-motion:no-preference`; effects with `hover:null` get the shared default `a.n:active{scale:.985}`. Only the renderer's transitions (`.18s` on `scale translate filter opacity text-shadow`, never more than 200 ms) and `motion` sit inside the reduced-motion block. Under `prefers-reduced-motion:reduce` the hover state therefore still applies, instantly — the policy is in [`a11y.md`](a11y.md). Zero JS, zero DOM: this is v1.0's interactivity.

**Hook signatures.** `css`, `hover` and `motion` receive `(p, h, m)`; `bleed` receives `(p, lines, h)` (above). An effect whose hover reads no params may give the declaration string itself instead of a function (`hover: "filter:brightness(1.05)"`); the renderer and the grid hash treat the two identically.

**The helpers `h`** (`src/helpers.js`, frozen, pure; it is authoritative for the signatures). Lengths come out through `u()`, and trigonometry stays in CSS: no helper calls `Math.cos` or `Math.sin`.
- Constants: `REACH = 1.1` (R14's blur reach with its safety factor), `OUTSET = 1` (a `-webkit-text-stroke` budgeted at its full width outside the contour, for mitered joins), and the caps below as `CAP = 64`, `BLURS = 4`, `MAX_BLUR = 2.5`, `CHAIN = 4`. Effects use the named constant instead of restating the number, and an effect that budgets more than `REACH` says why next to its own factor.
- `u(x)` a length in u · `mix(a, b, pct)` an OKLab `color-mix()` · `stack(n, angle, dist, color)` `n` hard layers out to `dist` · `ring(n, r, color)` `n` hard layers on a circle.
- `layers(n, min = 1)` a layer count: `n` rounded, at least `min`, at most `CAP`.
- `toward(angle, dist)` the bleed box of ink `dist` away at `angle`: `dist` on each side the angle points toward, 0 elsewhere (`toward(90, 3)` = `{t:0, r:0, b:3, l:0}`).
- `QUAD` the four diagonals as `[x, y]` sign pairs, clockwise from down-right · `fall(angle)` the horizontal sign of a falling diagonal (45 → 1, 135 → −1).
- `march(n, sx, sy, from, to, colorAt)` `n` hard layers along the diagonal `(sx, sy)`, layer `i` at `from + (to − from)·i/n` u per axis in `colorAt(i)` · `ramp(n, angle, dist, tint)` `stack()` with layer colour `tint(i/n)`.
- `copy(slot, decls)` the shape-B copy `.l::slot{content:attr(data-t) / "";decls}` · `clipFill(image)` the `.l` rule that clips one block-sized `image` to the letters of both lines (`background-size` from `--bh`, offset by `--y`).

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

Forced-colors needs no author rules (UA paints `LinkText` on `Canvas`). Unit test: no effect selector appears outside the gate. WCAG 1.4.4 (viewport-sized text cannot be resized 200%) is recorded in [`a11y.md`](a11y.md) as an accepted deviation: zoom never blocked, real text always present.

`{hover css}` is the hover and active declarations of §5.6, including geometry (`scale`, `translate`); `{hover transitions}` is only the renderer's `transition` list. Reduced motion removes the animation, not the state change: that is the policy (D6), recorded with its reasons and the manual checks in [`a11y.md`](a11y.md). Changing it is a `contract` PR.

---

## The `h32` listing

`src/rand.js`, verbatim. It is bryc's **xmur3a** run once: a murmur3 block round per UTF-16
code unit over the FNV offset basis, finished with murmur3's `fmix32`. Integer math only.

```js
export function h32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    let k = Math.imul(str.charCodeAt(i), 3432918353);
    k = (k << 15) | (k >>> 17);
    h ^= Math.imul(k, 461845907);
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 3864292196) | 0;
  }
  h ^= str.length;
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
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

### R10 — `fonts/meta/*.json` must carry `upm`, and `bleed()` sees a provisional `G` (retired by S2)

**Retired by S2.** The catalog build requires `upm` on every font meta (B2), so the engine
always divides `asc` / `desc` by it and the em fallback is gone. `bleed(p, lines)` receives
the line geometry without `G` or `R` (§5.6), which removes the cycle and with it the two
passes: `fit()` calls `bleed()` once, and `css()` and `hover()` receive the final `m`.

It used to read: the engine divided by `font.upm` when the meta carried one and treated
`asc` / `desc` as already-em otherwise; and since `G = max(g, bleed.t, bleed.b)` while
`bleed(p, m)` took an `m` containing `G`, `bleed()` was handed an `m` computed with `G = g`.
No shipped effect's bleed ever read `m.G` or `m.R`.

### R11 — a system-font fallback exists so the engine is total before WP-11 (retired by S2)

**Retired by S2.** The catalog build rejects an empty font pool, a missing `plain` and a
missing `qa-bw` (B2), so the engine's stand-ins — a built-in `system` font, a fallback
`qa-bw` palette, a null `plain` effect, and the renderer's no-`@font-face` branch — could
never run, and are deleted. The engine trusts the catalog's shape: a pick that cannot be
made from a validated catalog is a broken deploy and throws a plain `Error` (500), while a
`PickError` (400) is reserved for request errors — an unknown pin, or a pin combination
nothing satisfies.

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

### R15 — a Reserved Font Name is renamed, not refused, and only when there is one

D2 and §5.5 rule 3 refused any font declaring a Reserved Font Name in v1.0, to avoid
name-table surgery. Measured cost: about 41% of all candidates, and **every one** of the 21
remaining brush-script candidates — Lobster, Mr Dafoe, Kaushan Script, Berkshire Swash,
Grand Hotel, Oleo Script, Courgette, Kavoon, Pattaya, Merienda, Molle — so archetype C
could not be filled at all. The owner approved lifting it.

The OFL does not forbid using these fonts. FAQ 2.2, 2.5 and 2.6 say a subset is a Modified
Version, and a Modified Version may not be distributed under the reserved name; renaming is
the sanctioned path. So the gate now renames.

Four choices §5.5 did not make:

- **The header, not the file.** The OFL body defines the phrase "Reserved Font Name", so
  `grep -i` over a whole OFL.txt matches every OFL font in existence — a trap an earlier
  agent walked into. Only the copyright block above the first rule of dashes is read, plus
  name ID 0 of the binary, because a reserved name is not always in the licence file and is
  not always the family name: DM Serif reserves "Source", Galada and Pattaya both reserve
  "Lobster", Oleo Script's name table says "Oleo", Molle's says "Spinnaker".
- **After subsetting, not before.** `hb-subset` cannot rewrite name IDs 1-6; it only
  chooses which records to keep. The table has to be rebuilt either way,
  and rebuilding the subset's nine records costs less than rebuilding the upstream's
  hundred. `sfnt.mjs` gained `readNames` / `writeNames` for it.
- **Only when a name is reserved.** Always-renaming is simpler to reason about and was the
  research's recommendation, but it would rewrite 147 already-shipped files for no licence
  reason and throw away the one piece of provenance a font manager can show. A font with
  `rfn: []` keeps its own name table byte for byte, which is asserted against the shipped
  library.
- **`LZ <6 hex>`, derived from the id.** Deterministic, so a rebuild is byte-identical and
  the metadata does not need to carry the name — `neutralName(meta.id, [meta.family,
  ...meta.rfn])` recomputes it. Six hex digits can spell a word (`facade`, `decade`), so a
  collision with a reserved word re-rolls with a salt rather than failing.

Renaming is a licence *requirement*, not a way to obscure authorship. `meta.family`,
`fonts/licenses/<id>.txt`, the change notice, the source URL and name IDs 0, 13 and 14 are
all untouched, and the colophon still credits the original family by name.

## Glossary

One word per idea in code, comments, docs and PR text. The **wire and data names** — draw
keys, axis letters, `archetype`, `effect.bg`, shape letters, the hook params `p h m`, the
`Luzid-Pick` header, `weights.json` and `deny.json` keys, every font, stop, effect and
palette id (permalinks, R2), and the `license*` spelling in identifiers — are frozen and
are never renamed. Code identifiers marked *(S1)* are the names the engine refactor gives
them; until it lands the older name is in brackets.

| term | meaning |
|---|---|
| seed | the request's `[0-9a-hjkmnp-tv-z]{1,16}` string; every draw derives from it |
| draw | one keyed uniform `draw(seed, key)` in [0, 1) |
| draw key | the stable string a draw is keyed on: `f`, `e/depth-extrude/d`, `l/side` |
| axis | one decision in §5.3's order: bucket, font, variant, effect, params, palette, role set, layout |
| axis key | the letters `f v p r e l`, shared by pins, deny rules and weights (`AXIS_KEYS` *(S1)* [`PIN_KEYS`]) |
| odds | integer 0–16 an item is drawn in proportion to; 0 = retired (`clampOdds` *(S1)* [`odds16`]) |
| chance | a `{numer, denom}` probability for a flag such as `side` |
| weights | `data/weights.json`: odds overrides per axis (§5.3) |
| pin | an axis fixed by the request's query; `effectivePins` *(S1)* [`soft`] adds a preset's pins; `pinned` lists the request's |
| deny rule | one `data/deny.json` entry; it removes every pick that matches all of its keys |
| bucket | the taste class drawn before the font; spelled `archetype` in data (frozen) |
| font / file / variant | a family entry / one shipped `.woff2` (a pinned stop) / case × features × file. "Stop" is used only inside the fonts pipeline |
| ink | a word's measured box `{W, H, X, top}` in em |
| palette / role set / role colours | a dictionary row / one `o` assignment of its colours to bg, fg, a1, a2 / the four resolved hex values (`roleSet` *(S1)* [`role`]) |
| ground | the `--bg` colour; its polarity is light or dark. A derived ground is washi `w` or sumi `k` (§5.4, R4) |
| effect / family | one `effects/<id>.js` / the prefix of its id (`depth`, `glow`, `outline`, `retro`, `plain`) |
| params / ParamSpec | an effect's drawn values / their `[min, max, step]` grid |
| layout / align / side / gap | `stack-fit` or `stack-eq` / cross-axis alignment / the rotated portrait flag / `g` (`GAP`, `SIDE` *(S1)* [`G_SPEC`, `SIDE_ODDS`]) |
| look | the result of `pick`: ids and drawn values only (`Look` *(S1)* [`Pick`]) |
| Pick string | the canonical one-line rendering of a look (R9), `pickString(look)` |
| scene | a look resolved to catalog rows (`Scene` *(S1)* [`parts`]) |
| fit | the §5.2 literals for a scene (`Fit` *(S1)* [`f`]) |
| metrics | the effect's `m` (§5.6) |
| bleed | the ink an effect paints outside the glyph boxes, `{t, r, b, l}` in u |
| u | 1% of the fitted block width; the only length an effect writes |
| colophon | the HTML comment carrying the Pick string and the credits |
| nonce | the per-response CSP token on `<script>` and `<style>` (`newNonce` *(S1)*) |
| catalog / row | everything `build/catalog.js` exports / one item in it |
| helpers | the `h` object handed to effect hooks (§5.6) |
| upstream | the original font bytes, before subsetting |
| subset | a shipped file: 23 glyphs, one pinned stop |
| change notice | the "Modified by luzid.co" header prefixed to each licence file (§5.5 rule 8) |
| upstream notice | `fonts/upstream/<id>.notice.txt`: licence evidence or a MANIFEST appended to the licence file |
