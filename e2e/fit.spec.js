/**
 * The fit proof.
 *
 * `src/render.js` promises that the name is as large as the screen allows: the painted ink
 * fills the safe box to within the .985 shrink factor, never runs past it, and stays
 * centred. Nothing about that is provable from the DOM — the numbers that could be wrong
 * are the ones the browser turns into glyphs — so this spec screenshots the page and finds
 * the ink by scanning pixels.
 *
 * It runs in **mask mode** (`?p=qa-bw&e=plain`): pure black on pure white, no effect, the
 * odds-0 QA palette that only a pin can reach. That is the whole point of `qa-bw` shipping.
 *
 * The safe box is recomputed here from the viewport, never read back from the page (see
 * `fit-lib.js`). If `render.js` and this spec ever disagree about what "the safe box" is,
 * that disagreement is the finding.
 */

import { expect, test } from '@playwright/test'

import {
  bandTop,
  CENTRE_TOL,
  FILL_MAX,
  FILL_MIN,
  FONTS,
  inkBox,
  isInk,
  PORTRAIT,
  PR_VIEWPORTS,
  SCOPE,
  SEEDS,
  SLACK,
  safeBox,
  scope,
  shoot,
  url,
  VIEWPORTS,
} from './fit-lib.js'

const { variantFonts, sweepFonts } = scope()

/** The three configurations §9.2 calls `stack-fit`, `stack-eq` and `side`. */
const MODES = [
  { id: 'stack-fit', l: 'stack-fit', seed: SEEDS.flat, viewports: VIEWPORTS },
  { id: 'stack-eq', l: 'stack-eq', seed: SEEDS.start, viewports: VIEWPORTS },
  // `side` is a keyed flag, not a layout id: it is reached by seed, and its media query
  // only matches below 4/5, so the rotated block is only measurable on portrait viewports.
  { id: 'side', l: 'stack-fit', seed: SEEDS.side, viewports: PORTRAIT },
]

/**
 * One measurement, asserted softly so a failing run names every bad viewport at once
 * rather than the first.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} href
 * @param {{w: number, h: number}} vp
 */
async function measure(page, href, vp) {
  const { pick, probe, img } = await shoot(page, href, vp)
  const where = `${vp.w}x${vp.h} ${href} [${pick}]`

  // A fallback face would make every number below meaningless.
  expect(probe.fonts, `font not loaded · ${where}`).toContain('=loaded')
  expect(probe.scroll, `scrollbars change the viewport · ${where}`).toEqual([0, 0])

  // The engine's own computed value, not our guess at whether the media query matched.
  const side = probe.rotate !== 'none'
  const { aw, ah } = safeBox(vp.w, vp.h, side)

  const ink = inkBox(img, isInk, probe.dpr)
  expect(ink, `no ink at all · ${where}`).not.toBeNull()

  // Screen space to block space: under `rotate:90deg` the block's width runs down the
  // screen. This swap and the `aw`/`ah` swap in `safeBox()` cancel, which is a useful
  // sanity check but not a reason to skip either of them.
  const inkW = side ? ink.h : ink.w
  const inkH = side ? ink.w : ink.h
  const fill = Math.max(inkW / aw, inkH / ah)
  const detail = `fill=${fill.toFixed(4)} ink=${inkW.toFixed(1)}x${inkH.toFixed(1)} safe=${aw.toFixed(1)}x${ah.toFixed(1)} · ${where}`

  expect.soft(inkW, `ink wider than the safe box · ${detail}`).toBeLessThanOrEqual(aw + SLACK)
  expect.soft(inkH, `ink taller than the safe box · ${detail}`).toBeLessThanOrEqual(ah + SLACK)
  expect.soft(fill, `under-filled · ${detail}`).toBeGreaterThanOrEqual(FILL_MIN)
  expect.soft(fill, `over-filled · ${detail}`).toBeLessThanOrEqual(FILL_MAX)

  const dcx = Math.abs(ink.cx - vp.w / 2) / vp.w
  const dcy = Math.abs(ink.cy - vp.h / 2) / vp.h
  expect.soft(dcx, `ink off-centre horizontally · ${detail}`).toBeLessThanOrEqual(CENTRE_TOL)
  expect.soft(dcy, `ink off-centre vertically · ${detail}`).toBeLessThanOrEqual(CENTRE_TOL)

  return fill
}

// §9.2: changed fonts (or all of them when the engine moved) × every variant × stack-fit ×
// the two PR viewports. This is the sweep that catches one bad ink metric in one variant.
test.describe('every variant fills its safe box', () => {
  for (const id of variantFonts) {
    const font = FONTS.find((f) => f.id === id)
    if (!font) continue
    for (const v of font.variants) {
      test(`${id}.${v.id}`, async ({ page }) => {
        for (const vp of PR_VIEWPORTS) {
          await measure(page, url({ seed: SEEDS.flat, f: id, v: v.id, l: 'stack-fit' }), vp)
        }
      })
    }
  }
})

// §9.2: the seed fonts across all three layout modes and every viewport. This is the sweep
// that catches a layout mode or an aspect ratio, rather than a font.
test.describe('every layout mode fills its safe box at every viewport', () => {
  for (const id of sweepFonts) {
    const font = FONTS.find((f) => f.id === id)
    if (!font) continue
    // FIT_SCOPE=all crosses the full viewport list with every variant; the per-PR default
    // takes one variant per font, because the variant axis is covered above.
    const variants = SCOPE === 'all' ? font.variants : [font.variants[0]]
    for (const v of variants) {
      for (const mode of MODES) {
        test(`${id}.${v.id} · ${mode.id}`, async ({ page }) => {
          for (const vp of mode.viewports) {
            await measure(page, url({ seed: mode.seed, f: id, v: v.id, l: mode.l }), vp)
          }
        })
      }
    }
  }
})

/**
 * Divergences this package measured and could not fix from inside `e2e/`. Each one runs
 * the *unmodified* normative assertion and is annotated as an expected failure on the
 * engine that fails it, so it stays visible in every report instead of only surfacing on
 * the PR that happens to touch a font meta — and so CI turns red the day it is fixed and
 * this entry has to go. Nothing here relaxes a threshold.
 *
 * See `docs/fit.md` for the measurement and the recommended remedy.
 */
const KNOWN_DIVERGENCE = [
  {
    engine: 'webkit',
    // The divergence is a property of CoreText, not of WebKit: Playwright's macOS WebKit
    // is a Mac-port build that shapes through it, while its Linux WebKit is WPE with
    // FreeType and HarfBuzz and no CoreText anywhere. On Linux the variant therefore
    // renders at its declared width and passes — a true statement about that engine, not
    // a missed failure, so the pin must not be armed there.
    platform: 'darwin',
    f: 'pacifico',
    v: 'n-fina-static',
    l: 'stack-fit',
    vp: { w: 390, h: 844 },
    why: 'CoreText does not apply the OpenType `fina` feature to Latin, so WebKit-on-macOS paints the base glyphs (3.099 em) while the build-time harfbuzz metric says 3.039 em: +1.97% on line 1. Linux WebKit shapes with HarfBuzz and is unaffected',
  },
]

/**
 * Where the ink actually lands inside the boxes the fit maths drew. §5.2's whole claim is
 * that the patched metrics put each line's ink top exactly on its block top, so this is
 * the quantity a vertical divergence moves — and the one a `fill` ratio cannot see,
 * because a vertical shift leaves every width alone.
 */
const INK_VS_BOX = () => {
  const px = (sel) => {
    const r = document.querySelector(sel).getBoundingClientRect()
    return { top: r.top, bottom: r.bottom }
  }
  return { l1: px('.l1'), l2: px('.l2'), fs1: getComputedStyle(document.querySelector('.l1')).fontSize }
}

test.describe('known engine divergences', () => {
  for (const k of KNOWN_DIVERGENCE) {
    test(`${k.f}.${k.v} on ${k.engine}/${k.platform} — ${k.why}`, async ({ page, browserName }) => {
      test.fail(browserName === k.engine && process.platform === k.platform)
      const href = url({ seed: SEEDS.flat, f: k.f, v: k.v, l: k.l })

      // A pinned divergence that only ever reports "expected failure" tells the next
      // reader nothing about how big it got. For the vertical ones the number is the
      // whole diagnosis, so it is logged on every engine and platform, pass or fail.
      if (k.probe) {
        const { probe, img } = await shoot(page, href, k.vp)
        const boxes = await page.evaluate(INK_VS_BOX)
        const fs1 = Number.parseFloat(boxes.fs1)
        const split = (boxes.l1.bottom + boxes.l2.top) / 2
        const ink = inkBox(img, isInk, probe.dpr)
        const top1 = bandTop(img, probe.dpr, 0, split)
        const d = top1 === null ? Number.NaN : top1 - boxes.l1.top
        console.log(
          `[divergence probe] ${k.f}.${k.v} ${browserName}/${process.platform} ${k.vp.w}x${k.vp.h}: ` +
            `line-1 ink top − box top = ${d.toFixed(2)}px (${(d / fs1).toFixed(4)} em), ` +
            `ink height ${ink.h.toFixed(1)}px vs block ${probe.n.height.toFixed(1)}px, ` +
            `dcy ${(ink.cy - k.vp.h / 2).toFixed(2)}px ` +
            `(${(((ink.cy - k.vp.h / 2) / k.vp.h) * 100).toFixed(3)}%)`,
        )
      }

      await measure(page, href, k.vp)
    })
  }
})

// `align` can only show a difference under `stack-eq`, where the two lines have different
// widths. The union bbox should be unmoved by it: the wider line still spans the block.
test.describe('alignment never moves the block', () => {
  for (const id of sweepFonts.slice(0, SCOPE === 'all' ? undefined : 3)) {
    test(`${id} · stack-eq alignments agree`, async ({ page }) => {
      const font = FONTS.find((f) => f.id === id)
      const v = font.variants[0]
      const vp = { w: 1440, h: 900 }
      const fills = []
      for (const seed of [SEEDS.flat, SEEDS.start, SEEDS.end]) {
        fills.push(await measure(page, url({ seed, f: id, v: v.id, l: 'stack-eq' }), vp))
      }
      // Different seeds also change `g`, so this is a band, not an equality.
      expect(Math.max(...fills) - Math.min(...fills)).toBeLessThan(0.03)
    })
  }
})
