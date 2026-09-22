/**
 * Contact sheets: the only way anybody sees what a branch actually changed.
 *
 * A pixel scan proves the name fits. It says nothing about whether the result is worth
 * looking at, and that judgement does not scale by clicking through seeds. So this renders
 * a grid of real pages, composes them into one PNG, and writes the pick string of every
 * tile next to it so an ugly one can be reproduced by pinning rather than by hunting.
 *
 * There is no image library and there will not be one: the composition is done by loading
 * the tile PNGs back into a blank page as `data:` URIs and screenshotting that. The
 * browser is already here and it is better at laying out a grid than we would be.
 *
 *   node scripts/sheet.mjs [--changed] [--kind fonts|palettes|effects|slash|random]
 *                          [--limit N] [--url http://…] [--out sheets] [--port N]
 *
 * `--changed` sheets exactly the items that differ from `origin/main`, which is what a
 * content PR wants; with nothing changed it falls back to one random sheet.
 */

import { execFileSync, spawn } from 'node:child_process'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { argv, env, exit } from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { chromium } from '@playwright/test'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 24 tiles, six across: 2880 px of sheet, which is still readable scaled to a PR width. */
const COLS = 6
const TILES = 24
const TILE = { w: 480, h: 300 }
const CAPTION = 22

const SEED_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

/** Deterministic seeds: the same branch always produces the same sheet. */
function seedAt(i) {
  let s = ''
  let n = i + 1
  do {
    s = SEED_ALPHABET[n % 32] + s
    n = Math.floor(n / 32)
  } while (n > 0)
  return `s${s}`
}

// --- catalog ------------------------------------------------------------------

async function catalog() {
  const fonts = []
  for (const f of (await readdir(resolve(ROOT, 'fonts/meta'))).sort()) {
    if (f.endsWith('.json')) fonts.push(JSON.parse(await readFile(resolve(ROOT, 'fonts/meta', f), 'utf8')))
  }
  const palettes = []
  for (const f of (await readdir(resolve(ROOT, 'data/palettes'))).sort()) {
    if (f.endsWith('.json'))
      palettes.push(...JSON.parse(await readFile(resolve(ROOT, 'data/palettes', f), 'utf8')))
  }
  const effects = []
  for (const f of (await readdir(resolve(ROOT, 'effects'))).sort()) {
    if (f.endsWith('.js')) effects.push((await import(`../effects/${f}`)).default)
  }
  return { fonts, palettes, effects }
}

/** Paths differing from `origin/main`, or null when git will not say. */
function changedPaths() {
  for (const base of ['origin/main', 'main']) {
    try {
      return execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .split('\n')
        .filter(Boolean)
    } catch {}
  }
  return null
}

// --- what to sheet ------------------------------------------------------------

/**
 * A plan is a list of sheets; a sheet is a name plus up to `TILES` tiles, each of which is
 * a pin set. The seed still randomizes every axis nobody pinned, which is the point: a
 * font sheet should show that font against real palettes and real effects.
 *
 * `limit` caps the sheets *per kind*, so a run with `--kind auto` still reaches the
 * effects even though the palette axis alone would fill a hundred sheets.
 *
 * @param {Awaited<ReturnType<typeof catalog>>} cat
 */
function plan(cat, kind, changed, limit) {
  const sheets = []
  const want = (k) => kind === k || kind === 'auto'

  const changedIds = (dir, ext) =>
    (changed ?? [])
      .filter((p) => p.startsWith(`${dir}/`) && p.endsWith(ext))
      .map((p) => p.slice(dir.length + 1, -ext.length))

  // --- fonts: one tile per variant ------------------------------------------
  let fonts = cat.fonts
  if (changed) {
    const ids = new Set(changedIds('fonts/meta', '.json'))
    fonts = cat.fonts.filter((f) => ids.has(f.id))
  }
  if (want('fonts') && fonts.length > 0) {
    const tiles = fonts.flatMap((f) => f.variants.map((v) => ({ f: f.id, v: v.id })))
    for (const [i, chunk] of chunks(tiles, TILES).slice(0, limit).entries()) {
      sheets.push({ name: `fonts-${String(i + 1).padStart(2, '0')}`, tiles: chunk })
    }
  }
  // The one crop that has to be checked by eye on every font: `Ł` and `ł` are the reason
  // half the candidate faces were rejected, and an empty or faked bar is invisible in a
  // whole-page tile.
  if (want('slash') && fonts.length > 0) sheets.push({ name: 'slash', crop: 'ł', tiles: slashTiles(fonts) })

  // --- palettes: one tile per role set of each palette ------------------------
  let palettes = cat.palettes
  if (changed) {
    const srcs = new Set(changedIds('data/palettes', '.json'))
    palettes = cat.palettes.filter((p) => srcs.has(p.src) || srcs.has(p.id))
  }
  if (want('palettes') && palettes.length > 0) {
    const tiles = palettes.flatMap((p) => p.roles.map((r) => ({ p: p.id, r: r.o })))
    for (const [i, chunk] of chunks(tiles, TILES).slice(0, limit).entries()) {
      sheets.push({ name: `palettes-${String(i + 1).padStart(2, '0')}`, tiles: chunk })
    }
  }

  // --- effects: one tile per effect, several seeds each -----------------------
  let effects = cat.effects
  if (changed) {
    const ids = new Set(changedIds('effects', '.js'))
    effects = cat.effects.filter((e) => ids.has(e.id))
  }
  if (want('effects') && effects.length > 0) {
    const per = Math.max(1, Math.floor(TILES / effects.length))
    const tiles = effects.flatMap((e) => Array.from({ length: per }, () => ({ e: e.id })))
    for (const [i, chunk] of chunks(tiles, TILES).slice(0, limit).entries()) {
      sheets.push({ name: `effects-${String(i + 1).padStart(2, '0')}`, tiles: chunk })
    }
  }

  // Nothing selected — or an explicit ask for it: 24 unpinned draws.
  if (kind === 'random' || sheets.length === 0) {
    sheets.push({ name: 'random', tiles: Array.from({ length: TILES }, () => ({})) })
  }
  return sheets
}

/**
 * Two crops per font: the uppercase `Ł` where the font has an uppercase variant, and the
 * lowercase `ł` otherwise. `capsOnly` faces only have one, which is the honest answer.
 */
function slashTiles(fonts) {
  const out = []
  for (const f of fonts) {
    const upper = f.variants.find((v) => v.case === 'uppercase')
    const lower = f.variants.find((v) => v.case === 'lowercase') ?? f.variants.find((v) => v.case === 'none')
    for (const v of [upper, lower]) {
      if (v && !out.some((t) => t.f === f.id && t.v === v.id)) out.push({ f: f.id, v: v.id })
    }
  }
  return out.slice(0, TILES)
}

function chunks(xs, n) {
  const out = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

// --- the server ---------------------------------------------------------------

/** Start `wrangler dev` and wait for it to answer, unless `--url` points at a live one. */
async function serve(port) {
  const child = spawn(
    resolve(ROOT, 'node_modules/.bin/wrangler'),
    ['dev', '--ip', '127.0.0.1', '--port', String(port), '--show-interactive-dev-session=false'],
    { cwd: ROOT, stdio: 'ignore', env: { ...env, WRANGLER_SEND_METRICS: 'false' } },
  )
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(`${base}/?seed=a`)).ok) return { base, stop: () => child.kill() }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  child.kill()
  throw new Error(`wrangler dev did not come up on ${port}`)
}

// --- rendering ----------------------------------------------------------------

/** @param {Record<string, string>} pins */
function tileUrl(base, seed, pins) {
  const q = new URLSearchParams({ seed })
  for (const [k, v] of Object.entries(pins)) if (k.length === 1) q.set(k, v)
  return `${base}/?${q}`
}

/**
 * Zoom on the `ł` of `Cudziło`. Its position is asked of the engine with a Range over that
 * one character, so the crop is right whatever the font, the case transform or the
 * alignment did — no guessing at a fraction of the line.
 */
const SLASH_RECT = () => {
  const node = document.querySelector('.l2').firstChild
  const i = node.data.indexOf('ł')
  const r = document.createRange()
  r.setStart(node, i)
  r.setEnd(node, i + 1)
  const b = r.getBoundingClientRect()
  return { x: b.x, y: b.y, width: b.width, height: b.height }
}

/**
 * A window around `r`, in the tile's own aspect ratio and clamped to the viewport, so the
 * crop fills its cell and carries a letter of context on each side. A Range rect is the
 * line box, which a tall ascender or a descender can overshoot; the 1.6x zoom-out is what
 * keeps `Ł`'s bar and `ł`'s stroke inside the picture whatever the face does.
 *
 * @param {{x: number, y: number, width: number, height: number}} r
 * @param {{width: number, height: number}} view
 */
function frame(r, view) {
  const aspect = TILE.w / TILE.h
  const h = Math.min(view.height, Math.max(r.height, r.width / aspect) * 1.6)
  const w = Math.min(view.width, h * aspect)
  return {
    x: clamp(r.x + r.width / 2 - w / 2, 0, view.width - w),
    y: clamp(r.y + r.height / 2 - h / 2, 0, view.height - h),
    width: w,
    height: h,
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

async function main() {
  // `pnpm run sheet -- --changed` forwards the separator itself, so drop it.
  const { values } = parseArgs({
    args: argv.slice(2).filter((a) => a !== '--'),
    options: {
      changed: { type: 'boolean', default: false },
      kind: { type: 'string', default: 'auto' },
      limit: { type: 'string', default: '3' },
      url: { type: 'string' },
      out: { type: 'string', default: 'sheets' },
      port: { type: 'string', default: String(env.PORT ?? 8788) },
    },
  })

  const cat = await catalog()
  const changed = values.changed ? (changedPaths() ?? []) : null
  const sheets = plan(cat, values.kind, changed, Number(values.limit))
  if (sheets.length === 0) {
    console.log('nothing to sheet')
    return
  }

  const outDir = resolve(ROOT, values.out)
  await mkdir(outDir, { recursive: true })

  const server = values.url
    ? { base: values.url.replace(/\/$/, ''), stop: () => {} }
    : await serve(Number(values.port))
  const browser = await chromium.launch()
  /** @type {Record<string, object[]>} */
  const index = {}

  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 })
    let n = 0

    for (const sheet of sheets) {
      const shots = []
      const rows = []
      for (const [i, pins] of sheet.tiles.entries()) {
        const seed = seedAt(n++)
        const href = tileUrl(server.base, seed, pins)

        let png
        if (sheet.crop) {
          // A crop wants the glyph as large as it gets, so it is taken off a wide viewport
          // and then clipped rather than scaled up from a tile.
          const view = { width: 1600, height: 1000 }
          await page.setViewportSize(view)
          await page.goto(href, { waitUntil: 'load' })
          await page.evaluate(() => document.fonts.ready)
          png = await page.screenshot({ clip: frame(await page.evaluate(SLASH_RECT), view) })
        } else {
          await page.setViewportSize({ width: TILE.w, height: TILE.h })
          await page.goto(href, { waitUntil: 'load' })
          await page.evaluate(() => document.fonts.ready)
          png = await page.screenshot()
        }

        const res = await fetch(href)
        const pick = res.headers.get('luzid-pick') ?? ''
        shots.push(png.toString('base64'))
        rows.push({ tile: i, seed, pick, url: href.slice(server.base.length) })
      }

      const file = resolve(outDir, `${sheet.name}.png`)
      await writeFile(file, await compose(browser, shots, rows, sheet))
      index[sheet.name] = rows
      console.log(`${values.out}/${sheet.name}.png · ${rows.length} tiles`)
    }

    await writeFile(resolve(outDir, 'sheet.json'), `${JSON.stringify(index, null, 1)}\n`)
    console.log(`${values.out}/sheet.json`)
  } finally {
    await browser.close()
    server.stop()
  }
}

/**
 * Lay the tiles out as `<img>` elements in a blank page and screenshot it. The caption
 * carries the tile number so `sheet.json` can be read against the picture.
 */
async function compose(browser, shots, rows, sheet) {
  const cols = Math.min(COLS, shots.length)
  const cells = shots
    .map(
      (b64, i) =>
        `<figure><img src="data:image/png;base64,${b64}" alt=""><figcaption>${i + 1} · ${escapeHtml(
          label(rows[i], sheet),
        )}</figcaption></figure>`,
    )
    .join('')

  const page = await browser.newPage({ deviceScaleFactor: 1 })
  try {
    await page.setViewportSize({
      width: cols * TILE.w,
      height: Math.ceil(shots.length / cols) * (TILE.h + CAPTION),
    })
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><style>
       *{margin:0;padding:0;box-sizing:border-box}
       body{background:#222;display:grid;grid-template-columns:repeat(${cols},${TILE.w}px);font:11px/${CAPTION}px ui-monospace,monospace}
       figure{width:${TILE.w}px;height:${TILE.h + CAPTION}px;overflow:hidden;background:#111}
       img{display:block;width:${TILE.w}px;height:${TILE.h}px;object-fit:contain;background:#fff}
       figcaption{height:${CAPTION}px;color:#bbb;padding:0 6px;white-space:nowrap;overflow:hidden}
       </style><body>${cells}`,
      { waitUntil: 'load' },
    )
    return await page.screenshot()
  } finally {
    await page.close()
  }
}

/** The shortest string that still identifies the tile in the picture. */
function label(row, sheet) {
  const pick = row.pick
  if (sheet.crop) return /f:(\S+)/.exec(pick)?.[1] ?? row.seed
  if (sheet.name.startsWith('fonts')) return /f:(\S+)/.exec(pick)?.[1] ?? row.seed
  if (sheet.name.startsWith('palettes')) return /p:(\S+)/.exec(pick)?.[1] ?? row.seed
  if (sheet.name.startsWith('effects')) return /e:(\S+)/.exec(pick)?.[1] ?? row.seed
  return row.seed
}

const HTML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => HTML[c])

main().catch((err) => {
  console.error(err)
  exit(1)
})
