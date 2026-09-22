# The fit proof — what was measured, and what it found

§5.2 promises that **Tomasz Cudziło** is painted as large as the screen allows, never past
the safe box, and never over itself. Every number behind that promise is computed at build
time by `harfbuzzjs` and emitted as a CSS literal, so nothing in `test/` can tell whether a
browser agrees. This package screenshots real renders in Chromium, Firefox and WebKit and
finds the ink by scanning pixels.

Everything below is measured, on this Mac (macOS 26.6.2, M1 Pro), at DPR 1, against
`wrangler dev`. The fill ratios and the metric-patch table were measured against the seed
catalog of 8 fonts / 53 variants; the effect findings against the full 91 fonts / 424
variants / 30 effects, at contract R13/R14.

## What the proof actually asserts

`e2e/fit.spec.js` runs in **mask mode** (`?p=qa-bw&e=plain`) — black on white, no effect,
the odds-0 QA palette that only a pin can reach. For each render it screenshots the
viewport, decodes the PNG (`e2e/png.js`, `node:zlib` and nothing else), and takes the
bounding box of every pixel at or below half coverage.

The safe box is **recomputed in the spec** from the viewport, never read back from the
page:

```
m  = max(12, 0.02·min(vw, vh))          insets are 0 under Playwright, and 100svh == 100vh
aw = vw − 2m        ah = vh − 2m        swapped under `side`
```

Pass requires all four of:

| | threshold |
|---|---|
| `max(inkW/aw, inkH/ah)` | in `[0.965, 1.000]` |
| `inkW` | `≤ aw + 2` |
| `inkH` | `≤ ah + 2` |
| ink-bbox centre | within 1 % of the viewport centre, per axis |

The ±2 px covers integer ascent rounding and half-leading flooring; it is not a fudge
factor for shaping differences, and nothing in this package widened it.

### The `side` swap cancels, and that is worth knowing

Under `rotate:90deg` the spec swaps `aw`/`ah` (the block is laid out against the rotated
axes) **and** swaps the measured ink dimensions (the block's width runs down the screen).
The two swaps cancel, so a purely screen-space reading of the same render produces the same
two ratios. Both swaps are still written out explicitly in `e2e/fit-lib.js`, because the
cancellation is a property of this particular geometry and not something to rely on.

### The rotated `translate` — the thing the review flagged

`translate` acts in screen space while `DX`/`DY` are in the block's local space, so under
`rotate:90deg` the pair must be swapped and one negated. `src/render.js` emits
`translate:calc(-DY·u) calc(DX·u)` inside the `side` media query, which is correct.

It is proved by construction rather than by reading the CSS. The painted envelope is the
block grown by the bleed; `DX`/`DY` exist precisely to bring that envelope's centre back
onto the viewport centre. `e2e/bleed.spec.js` asserts the painted bbox lies inside a
viewport-centred box of size `bw·K1 × bw·K2` (dimensions swapped under `side`). A
`translate` that forgot to swap or to negate would move the envelope by up to
`2·max(|DX|,|DY|)` u — 9 u for `depth-extrude(a=225,d=9)`, about 9 % of the block — and
lands there first. Measured clean at 320×568 and 390×844 in all three engines, at every
corner of the parameter space.

`place-items` was the other half of that worry: an over-wide rotated block does not escape,
because `body` carries `place-content:unsafe center` and `html,body` carry `overflow:clip`.
`document.documentElement.scrollWidth − clientWidth` is asserted to be 0 on every single
measurement in this package, `side` included. It never moved.

## Results

### Fill ratios, by layout and engine

One variant per font, all eight §9.2 viewports, `max(inkW/aw, inkH/ah)`. The design value
is the `.985` shrink factor; anything below it is a font whose other dimension binds.

| layout | chromium | firefox | webkit |
|---|---|---|---|
| `stack-fit` | 0.9826 – 0.9843 | 0.9843 – 0.9861 | 0.9850 – 0.9865 |
| `stack-eq` | 0.9826 – 0.9861 | 0.9836 – 0.9861 | 0.9850 – 0.9873 |
| `side` | 0.9797 – 0.9865 | 0.9831 – 0.9891 | 0.9836 – 0.9891 |

Worst case across the whole 1 410-measurement sweep: **0.9797** (low, pacifico `side` at
320×568, chromium) and **0.9891** (high, boldonse/pacifico `side` at 390×844, firefox and
webkit). Both sit comfortably inside `[0.965, 1.000]`. Centre offsets never exceeded
0.47 % of the viewport on either axis against a 1 % budget.

### The metric patch holds

This is the headline. §5.2 normalises `hhea`/`OS/2` so every engine places the baseline
identically, and the fit divides by ink widths that `harfbuzzjs` measured at build time.
The question is whether CoreText — which shapes for WebKit and Safari and is *not*
HarfBuzz — agrees with those widths.

It does, exactly. Measured outside any browser with a small CoreText probe against the
decoded subsets (`scripts/woff2.mjs` `decode()` → sfnt → `CTLineGetImageBounds`, at
`size = 1000`):

| font · variant | word | `fonts/meta` | host CoreText |
|---|---|---|---|
| pacifico · `n-base` | Tomasz | 3.099 em | 3.099 em |
| pacifico · `n-base` | Cudziło | 3.050 em | 3.050 em |
| pacifico · `l-base` | tomasz | 2.919 em | 2.919 em |
| pacifico · `n-ss01` | Tomasz | 2.991 em | 2.991 em |
| pacifico · `n-case` | Tomasz | 2.991 em | 2.991 em |
| fraunces · `n-base-w900` | Tomasz | 3.3935 em | 3.3935 em |
| fraunces · `n-base-w900` | Cudziło | 3.2975 em | 3.2975 em |
| unbounded · `u-base-w400` | TOMASZ | 5.248 em | 5.248 em |
| unbounded · `u-base-w400` | CUDZIŁO | 5.320 em | 5.320 em |

### Why this counts as a host-Safari answer

The risk register asks for "a host WebKit run in WP-13", against the possibility that
Playwright ships a WebKit whose shaping is not the one Safari does. On macOS, Playwright's
WebKit is a Mac-port build and shapes through the host's CoreText — which is why F1 below
shows up there and not in the other two engines. Real Safari cannot be driven from a
headless agent shell (`safaridriver` needs an admin enable and a GUI session), so instead
of approximating it, the table above **bypasses the browser entirely**: it calls
`CTLineCreateWithAttributedString` on the decoded subsets and reads
`CTLineGetImageBounds`. That is the same shaper Safari uses, measured directly, and it is
a stronger statement than any browser run would have been — it isolates shaping from
layout and rasterization.

The probe is not checked in: it is ~40 lines of Swift against `CoreText`, and the repo has
no Swift toolchain in CI. The numbers it produced are above, and it is reproducible from
`scripts/woff2.mjs`'s `decode()` plus `CTFontCreateWithGraphicsFont` in a few minutes.

**Verdict: the metric-patch route is sound.** Not one base variant disagrees. The residual
per-engine spread in the rendered ink is sub-pixel and is rasterization, not shaping:

| engine | ink width − declared block width, over all 53 variants |
|---|---|
| chromium | −0.50 px (constant) |
| firefox | +0.48 px (constant) |
| webkit | +0.50 px, except the four rows below |

WebKit rounds each glyph advance to a whole pixel, which accumulates to at most +1.5 px
(+0.42 %) over a seven-glyph word — visible on `fraunces.n-base-w900` and
`unbounded.u-base-w400` at a 360 px block, and shrinking in relative terms as the block
grows. It never costs more than a third of the 1.5 % safety margin.

---

## Findings

### F1 — `pacifico` `fina` variants break the fit contract in WebKit

**What.** `fonts/meta/pacifico.json` ships two variants built with OpenType `fina` on. The
build-time ink widths were measured with HarfBuzz, which applies a forced feature to the
whole run whatever the script. **CoreText does not apply `fina` to Latin at all** — its
output is byte-identical to the base, verified directly:

```
ct pacifico.static.ttf "Tomasz"        → inkW 3099   (= base)
ct pacifico.static.ttf "Tomasz" fina   → inkW 3099   (unchanged)
ct pacifico.static.ttf "Tomasz" ss01   → inkW 2991   (the feature plumbing works)
fonts/meta/pacifico.json  n-fina-static.w1.W = 3.039
```

So `render.js` divides the block width by 3.039 while WebKit paints 3.099 em: **+1.97 %**
on line 1. Line 2 is +0.30 % (3.041 declared, 3.050 painted). The `.985` shrink factor only
buys 1.52 %.

**Measured.** WebKit, `pacifico.n-fina-static`, mask mode, every viewport where the width
binds:

| viewport | block `bw` | ink width | safe `aw` | overrun | fill |
|---|---|---|---|---|---|
| 320×568 | 291.5 | 298 | 296 | +6.45 px (+2.21 %) | **1.0068** |
| 390×844 | 360.5 | 368 | 366 | +7.50 px (+2.08 %) | **1.0055** |
| 768×1024 | 726.2 | 741 | 737.3 | +14.78 px (+2.04 %) | **1.0050** |
| 1024×1024 | 968.3 | 988 | 983.0 | +19.72 px (+2.04 %) | **1.0050** |
| 768×1024 `side` | 978.4 | 998 | 993.3 | +19.63 px (+2.01 %) | **1.0048** |

Identical in `stack-fit` and `stack-eq`. Chromium and Firefox pass everywhere — they shape
with HarfBuzz, so they agree with the build metric by construction. At landscape viewports
the height binds and the overrun is invisible in the fill ratio, but the ink is still wider
than declared.

**`pacifico.l-fina-static` is the canary**: +1.39 % declared-vs-CoreText on line 1,
+1.53 % measured in the browser, which lands the fill ratio at ≈ 1.0000. It passes today by
about one part in ten thousand.

**Not a clipping bug.** The name is never cut: at 390×844 the 12 px margin shrinks to 8 px.
It is the safety margin that is consumed, which is exactly the margin that exists to absorb
the next surprise.

**Where it lives.** Not `src/render.js`. §5.5 pipeline rule 4 decides which feature sets are
"effective" by shaping the two real words with the feature on and off — **using harfbuzzjs
only**. `fina`, `init`, `medi` and `isol` are joining-context features; HarfBuzz honours a
forced one on any script, CoreText only runs them for scripts with joining behaviour. Any
feature in that family will produce a variant that two engines render one way and Apple's
renders another.

**Recommended remedy**, for whoever owns the font pipeline (WP-11 / WP-14) — §5.2 already
says a font the pixel scan rejects is dropped rather than fixed, and this is a variant, not
a font:

1. Drop `fina` from `pacifico`'s `features` in `fonts/sources/seed.json` (removes two of
   the ten variants), **or**
2. have `scripts/fonts.mjs` reject the joining-context family `fina init medi isol` for
   fonts whose script is not joining, which prevents the whole class rather than this
   instance. Pacifico carries `connected`, so a trait check is not sufficient on its own.

Until then the divergence is pinned by `known engine divergences` in `e2e/fit.spec.js`: it
runs the unmodified normative assertion and is annotated as an expected failure, so it stays
in every report and turns the run **red** the day it is fixed.

The pin is armed on **WebKit *and* macOS**, not on WebKit alone. The divergence is a
property of CoreText, and only Playwright's macOS WebKit shapes through it; its Linux
WebKit is WPE with FreeType and HarfBuzz and no CoreText anywhere, so the variant renders
at its declared width there and passes. That is a true statement about that engine rather
than a missed failure — but an ungated `test.fail` inverts it into "expected to fail, but
passed" and turns CI red for the wrong reason, which is exactly what happened on the first
CI run of this branch. A pin has to fire only where the condition it describes can exist.

### F6 — `bungee.n-ss12-static` is off-centre on Linux WebKit

**What the failure is.** `ink off-centre vertically`, WebKit only, one variant out of 692
in the 147-font library. The fill ratio passes; only `dcy` against `CENTRE_TOL` fails.
A vertical shift leaves every width alone, so `fill` is blind to it — which is precisely
why the centre check exists as a separate assertion.

**Why `ss12` and nothing else.** Bungee's `ss12` is not a substitution. It selects the
same glyphs as `ss01` — identical glyph ids, identical 1000-unit advances, identical ink
width — and moves them **down 0.208 em** with a GPOS y-placement. Host CoreText, measured
directly on the decoded subset:

```
ss01  inkX=200 inkW=5600 inkY=-15   inkH=750     → ink top 735
ss12  inkX=200 inkW=5600 inkY=-223  inkH=750     → ink top 527
      glyphs both: g25 g23 g22 g18 g24 g27, 1000 each
```

`fonts/meta/bungee.json` records `top = 0.527` for `ss12` and `0.735` for every other
bungee variant, so the build-time harfbuzz measurement and CoreText agree to the unit. The
fit maths turns that into a line-height literal of `L = 0.545` where its siblings get
`0.961`.

It is the only variant in the library exposed this way. Scanning all 692 for pairs that
share a font, a case and *identical widths* but differ in ink top finds exactly three:

| pair | Δ ink top |
|---|---|
| `bungee` `n-ss01` vs `n-ss12` | **0.208 em** |
| `matemasie` `l-base` vs `l-ss02` | 0.054 em |
| `dyna-puff` `n-base-w700x` vs `n-ss01-w700x` | 0.020 em |

An order of magnitude separates the first from the rest. A width-neutral vertical feature
is rare, and this is the only one large enough to matter.

**The mechanism, and its limits.** On this macOS host every engine places the ink where
the metric says, and `ss12` is healthy everywhere:

| engine (macOS) | line-1 ink top − box top | ink height vs block | `dcy` |
|---|---|---|---|
| chromium | −1.11 px | 105.0 vs 103.8 | −0.50 px · 0.059 % |
| firefox | −1.1 px | 106.0 vs 103.8 | 0.00 px · 0.000 % |
| webkit | −0.11 px | 105.0 vs 103.8 | +0.50 px · 0.059 % |

All eight bungee variants sit at or below 0.118 % on all three engines here. So the
divergence is not "WebKit": it is **Linux WebKit specifically**, and the reason is the same
one behind F1 — the two WebKit ports do not share a shaping backend. The Mac port goes
through CoreText, which applies the y-placement. The Linux port shapes through its own
HarfBuzz path, and the vertical offset does not survive it. Chromium and Firefox on Linux
also use HarfBuzz, but through their own shaping code, which is why the failure is
WebKit-only *and* Linux-only.

If the shift is dropped, the glyphs paint at `ss01`'s height — 0.208 em higher — and at
390×844 that is 13.4 px on line 1 and 11.3 px on line 2, lifting the ink block bodily:

```
predicted ink 356.7 .. 462.4  → centre 409.5, viewport centre 422
predicted dcy −12.5 px = 1.48 %   against a 1 % tolerance
```

which is the reported failure's signature exactly: width untouched, centre out by about
one and a half tolerances.

**This is a prediction, not a reproduction.** I cannot run Linux WebKit on this host, and I
would rather say so than imply I measured it. So the pin carries a probe: the divergence
test logs the line-1 ink-top-minus-box-top offset, the ink height and `dcy` on **every**
engine and platform, pass or fail. macOS prints −0.11 px / −0.0017 em; if the mechanism
above is right, the Linux leg will print about **−13.4 px / −0.208 em**. If it prints
something else, the hypothesis is wrong and the number will say so.

Pinned in `KNOWN_DIVERGENCE` gated to `webkit` **and** `linux`, the mirror of F1's `darwin`
gate. Remedy, if it is confirmed and the owner wants it gone rather than carried: `ss12`
is a duplicate of `ss01` in every dimension except a vertical offset no engine agrees on,
so dropping it from bungee's `features` costs one variant and nothing else.

**On `CENTRE_TOL`: it is not tight, and it should not move.** 1 % of 844 px is 8.4 px. On
this host the entire library renders inside **0.47 %**, and all eight bungee variants
inside 0.118 % — healthy renders sit two to eight times inside the tolerance. The predicted
Linux offset is 1.48 %, which is not a pixel or two of rasterisation but a twelve-pixel
displacement of the whole name. Widening the tolerance to admit it would blind the check to
exactly the class of fault it was written for.

### F2 — `G = max(g, bt)` guarded only one direction · **fixed by R13**

Measured before R13 landed, and kept because it is the corroboration for that change rather
than a live defect. `G = max(g, bt)` stopped line 2's *upward* paint reaching line 1 and
said nothing about the mirror image. With a downward extrusion `bt` is 0, so `G` collapsed
to the drawn gap `g` while line 1 still threw ink `0.707·d` u below its own box.

Fraunces `n-base-w600`, `stack-fit`, 1440×900, `depth-extrude`:

| angle | `d` | `g` | `G` | gap | line-1 reach | result |
|---|---|---|---|---|---|---|
| 225 / 315 (up) | 6 | 4 | **6** | 78.3 px | 55.4 px | clean |
| 225 / 315 (up) | 9 | 4 | **9** | 114.2 px | 80.7 px | clean |
| 45 / 135 (down) | 6 | 4 | 4 | 52.2 px | 55.4 px | **3.2 px into line 2** |
| 45 / 135 (down) | 9 | 4 | 4 | 50.8 px | 80.7 px | **30.0 px into line 2** |
| 45 / 135 (down) | 9 | 10 | 10 | 126.9 px | 80.7 px | clean |

10 of 112 of `depth-extrude`'s drawn combinations, 8.9 %, and plainly visible on the
contact sheets. R13 makes it `G = max(g, bt, bb)`. `e2e/bleed.spec.js` now asserts the
two-directional form on the corner that showed the failure, as a plain requirement.

### F4 — R14's 1.5× blur reach over-predicts; the pixels support ≈ 1.0×

R14 records that `text-shadow` and `drop-shadow()` treat the blur radius as a Gaussian
diameter hint (σ = r/2) and that a Gaussian paints to roughly 3σ, so the tail reaches about
**1.5r** beyond the offset. That is true of the mathematics and false of the pixels.

Method: read the *computed* `text-shadow` back off the page, which gives every layer's
offset and blur in used pixels; measure the painted edge by scanning; then solve for the
multiplier `m` that makes `max_layers(offset + m·blur)` equal the measured reach. Done per
side, per engine, at four ink thresholds.

| ink threshold | what it means | solved `m` across the four watchlist effects × 3 engines |
|---|---|---|
| Δ > 2/255 | ~0.8 % of full contrast; the loosest a PNG can express | **0.89 – 1.05** |
| Δ > 8/255 | 3 %; this spec's working threshold | 0.47 – 0.93 |
| Δ > 25/255 | 10 % | ≤ 0.76 |
| Δ > 64/255 | 25 % | ≤ 0.61 |

The maximum solved anywhere, at any threshold, in any engine, was **1.05**.

The arithmetic agrees. Blurring a straight edge gives `0.5·erfc(d/(σ√2))`; with σ = r/2 that
is **2.3 %** of the layer's own alpha at d = 1.0r and **0.17 %** at d = 1.5r. Against a
black-on-white ground 0.17 % is a channel delta of 0.43 — below any threshold a decoder can
distinguish from the ground, and below what a viewer can see.

**Recommendation for R14: the painted tail reaches about 1.0r, not 1.5r.** If a safety
factor is wanted, 1.1r covers every measurement taken here. Budgeting at 1.5r costs real
size — it is 0.5r of block width per side thrown away on ink nobody can see, and for
`glow-neon-outline(r=25)` that is 2.1 u of the 100 u block on each axis.

### F5 — two effects under-declare their bleed; none of them clips

**The test that separates ink from rounding.** An overshoot measured in pixels can be real
ink or it can be the glyph's own edge against a box drawn at a fractional coordinate. The
two are told apart by changing the block size: real ink is a fixed fraction of the block,
so it holds its value in `u`; a sub-pixel edge effect is a fixed pixel cost, so its `u`
value collapses as the block grows. Every verdict below is that measurement, fraunces
`n-base-w600`, `stack-fit`, mask mode, worst side over three engines.

| effect · corner | 1440×900 (u ≈ 13) | 3840×2160 (u ≈ 33) | verdict |
|---|---|---|---|
| `plain()` — the control, zero bleed, no shadow | 1.5 px · 0.111 u | 0.8 px · 0.022 u | **rounding** |
| `retro-stripe-echo(a=135,k=5,s=1.2)` | 2.1 px · 0.162 u | 0.8 px · 0.024 u | **rounding** |
| `retro-deboss(k=0.3,s=1.8)` | −9.5 px · −0.71 u | −24.6 px · −0.69 u | **clean** — paints *inside* its envelope |
| `glow-foil(a=188,k=30,o=6,s=45)` | 3.5 px · 0.262 u | 10.3 px · **0.316 u** | **real ink** |
| `glow-neon-outline(r=25,t=100,w=80)` | 10.5 px · 0.827 u | 27.1 px · **0.808 u** | **real ink** |

So two effects under-declare, not five:

- **`glow-neon-outline`** — 0.83 u left, 0.69 u right, 0.66 u below, 0.50 u above, and it
  also reaches the inter-line band. The largest, and the one to fix first.
- **`glow-foil`** — 0.26–0.32 u left and right. Both compose a `-webkit-text-stroke` with
  blurred shadow layers, which is the composition a shadow-list audit under-counts.

**Two retractions from this document's first revision**, both mine:

1. `retro-deboss` was reported at 0.32 u. It is **clean** — it paints 0.7 u *inside* its
   declared envelope at both block sizes. The earlier number was the spec's own
   quantisation against a slack that was one pixel too tight.
2. `retro-relief-gap` was reported at 3.66 u. That was a bug in this spec: the layout gap
   was parsed out of the pick string with a bare `/g=(\d+)/`, which matched that effect's
   own `g` parameter first and fed `G = 0` into the expected geometry. Anchored on the `l:`
   segment it is clean at every corner. Worth naming — any later spec reading the pick
   string hits the same trap.

**`retro-stripe-echo` is clean, and dropping its phantom top bleed was correct.** Every one
of its shadow layers sits at `y = +k` with `k > 0` and zero blur, so there is no mechanism
for upward ink at all, and `t: 0` is right by construction. The 0.08 u that CI reported
above its envelope is the same quantity `plain` shows at 1.5 px while painting nothing
whatsoever: it survives to a 50 % ink threshold, so it is the glyph outline sitting
fractionally above `.n`'s box, which is exactly the integer ascent rounding §9.2 already
grants ±2 px for. It needed no `ALLOWANCE` entry; it needed the spec to account for its own
quantisation, which `ENVELOPE_SLACK` now does.

**Nothing clips.** Across the bleed sweep in three engines there were **zero** safe-box
violations, and a dedicated sweep of the worst effect over eight viewports × three corners
× both modes × three engines never dropped below **3.0 px** of headroom. The `.985` shrink
factor absorbs all of it. These are `bleed()` declarations to correct, not fit failures.

`effects/**` is outside this package's paths, so each is recorded as a budget in
`ALLOWANCE` in `e2e/bleed.spec.js`, permitting exactly the measured overshoot and no more.
`glow-foil`'s 0.26 u is below the quantisation floor at the sweep's own viewports, so a
budget there would be inert — `recorded overshoots hold their budget at full resolution`
re-measures every recorded entry and the R14 watchlist at 3840×2160, where
`ENVELOPE_SLACK` is 0.12 u instead of 0.3 u and the same overshoot is ten pixels rather
than four.

### A measurement cannot assert what it cannot resolve

The envelope check budgets fractions of a `u`, and `u` is 1 % of the block width — about
2.9 px at 320×568. Asserting a half-`u` overshoot there means asserting 1.5 px against a
2 px slack and a pixel of antialiasing, which flips between runs and between engines and
means nothing. An earlier revision of this spec did exactly that and produced results that
contradicted themselves run to run.

So the envelope check is gated on `u ≥ 6 px` (`ENVELOPE_MIN_U`), and the `side` mode
measures at the largest portrait viewport rather than the smallest. The **safe-box** check
— the normative one — stays unconditional at every viewport.

It also carries its own slack rather than borrowing §9.2's. Wherever an effect declares a
zero bleed on a side, the envelope's outer edge *is* the block box, and three separate
sub-pixel costs land on it at once: the ±2 px §9.2 already grants the glyph for integer
ascent rounding and half-leading flooring, one more for flooring the fractional envelope
edge to whole pixels, and one more for the antialiased pixel an ink threshold counts and a
geometric outline does not. `ENVELOPE_SLACK` is `SLACK + 2` for exactly those three, and
the number is founded on `plain` — which paints nothing beyond the glyphs and declares a
zero bleed on all four sides, and still reads 1.5 px outside its own envelope at 1440×900.

An earlier revision used `SLACK` alone, and `retro-stripe-echo` failed CI by about one
device pixel as a result. The rule is worth keeping as the catalog grows: assert the
contract everywhere, assert the sharper diagnostic only where the block is big enough to
express it, and let the diagnostic pay for its own rounding rather than charging it to an
effect.

### F3 — Pacifico's `ł` is faithful, and it does read oddly

The `Ł ł` crop sheet (`sheets/slash.png`, tile 10) shows Pacifico's `ł` with its stroke
floating above the loop like a macron rather than crossing it. That is **not** a subsetting
or mark-positioning failure. It is one glyph, not a mark pair, and its outline metrics are
identical to the upstream file:

```
                     advance  inkX  inkW  inkY  inkH
upstream Pacifico-Regular.ttf (sha256 5b6c0d53…, the pinned URL)
  ł  g660             368      55   509    −5   1018
  Ł  g99              673     −41   843    −5   1018
fonts/files/pacifico.static.woff2, decoded
  ł  g41              368      55   509    −5   1018
  Ł  g6               673     −41   843    −5   1018
```

Whether a Polish reader accepts that form is a taste call for the owner, not a defect.
Flagging it because it is the first thing the crop sheet makes you ask.

---

## The normative matrix (§9.2), as wired

`FIT_SCOPE` is read by `e2e/fit-lib.js` and named in `playwright.config.js`.

**`FIT_SCOPE=changed` — the default, and the required PR check.**

| sweep | scope |
|---|---|
| every variant fills its safe box | fonts whose `fonts/meta/*.json` differ from `origin/main`, **plus all 8 seed fonts** when `src/`, `scripts/fonts.mjs` or `scripts/sfnt.mjs` moved · every variant · `stack-fit` · {390×844, 1440×900} · 3 engines |
| every layout mode, every viewport | the 8 seed fonts, one variant each · {`stack-fit`, `stack-eq`, `side`} · all 8 viewports (`side` only at the three portrait ones, where its media query matches) · 3 engines |
| bleed | every shipped effect at the two ends of its parameter space, plus the named R14 watchlist corners · Fraunces · upright at {390×844, 1440×900} and `side` at 768×1024 · 3 engines. Widens to every corner for effects this branch changed. |

When git cannot name a base the per-variant sweep widens to all 8 fonts rather than
narrowing to none.

**`FIT_SCOPE=all`** (`pnpm run e2e:all`) crosses all 53 variants with all three layout modes
and all eight viewports. It is the WP-50 sweep and `workflow_dispatch`; it is **not** a
required check.

Result today: **765 passed, 4 failed, 3.0 minutes**. All four failures are
`pacifico.n-fina-static` on WebKit — F1, once in the per-variant sweep and once in each of
the three layout modes. Nothing else in the catalog fails anywhere, in any engine, at any
viewport. `pacifico.l-fina-static` passes the full sweep, which is the whole margin it has.

Two deliberate departures from §9.2, both cheap and both safe:

- The bleed sweep runs **every** shipped effect rather than only the changed ones. Its
  `side` half exercises `render.js`'s rotated `translate`, which no effect change would
  ever mark as changed. With 30 effects that is 64 configurations at the two parameter ends.
- It adds the named R14 watchlist corners on top of `{min, max}`, because the corner that
  matters is rarely an endpoint: `glow-neon(r=25,t=60)` mixes one parameter's maximum with
  another's minimum, and neither end of `depth-extrude`'s angle reaches line 1.

The full 463-corner cross is left to `FIT_SCOPE=all`; at three viewports and three engines
it would not fit the per-PR budget.

**Cost.** `pnpm run e2e` at the default scope, 91 fonts and 30 effects: **4.4 min** wall
clock, 1 360 tests, three engines, on a 10-core M1 Pro. On CI at `workers: 3` the whole
job is 13.8 min against a 30-minute ceiling.

**A static audit belongs in `test/`, with a caveat.** An analytical check that parses each
effect's emitted lengths and compares them to its declared bleed runs in milliseconds
without a browser, and for 200-odd effects that is obviously worth having as the first
gate — it would have caught `retro-deboss` and `glow-neon-outline` at authoring time. Two
things to build in, both learned here: use **1.0r** for blur reach, not 1.5r (F4), and make
it **fail loudly on anything it cannot parse** rather than scoring it clean — shape-B
geometry, `transform`, `clip-path` and `mask` are all invisible to a shadow-list scan, and
a silent zero there reads as a pass. `test/**` is outside this package's paths, so this is
a recommendation rather than a deliverable.

## Reproducing anything here

Every measurement is a pinned URL. Pins beat seeds — a seed only reproduces a look at one
commit — but the layout gap `g`, the alignment, `side` and the effect parameters are keyed
draws with no pin, so the specs search for a seed that lands on the value they want
(`findSeed` in `e2e/fit-lib.js`). The seeds are deterministic, so a failure message always
names a URL that reproduces byte for byte.

```
# F1, the WebKit overrun
/?seed=q1&p=qa-bw&e=plain&f=pacifico&v=n-fina-static&l=stack-fit      at 390x844

# F2, line 1 painting into line 2
/?seed=<findSeed g=4, a=45, d=9>&p=qa-bw&e=depth-extrude&f=fraunces&v=n-base-w600&l=stack-fit

# the rotated block
/?seed=q3&p=qa-bw&e=plain&f=fraunces&v=n-base-w600&l=stack-fit        at 390x844
```

## Contact sheets

`pnpm run sheet` writes `sheets/*.png` plus `sheets/sheet.json`, which maps every tile to
its seed, its pick string and its URL. `--changed` sheets only what differs from
`origin/main`; with nothing changed it falls back to one random sheet. `--kind slash`
produces the `Ł ł` crop per font, framed by asking the engine for a `Range` rect over that
one character, so the crop is right whatever the face, the case transform or the alignment
did.

Reviewed for this package: `fonts-01..03` (all 53 variants), `slash` (13 crops, every font,
both cases where the font has them), `palettes-01..03`, `effects-01`. F2 and F3 both came
out of looking at those rather than out of a threshold.
