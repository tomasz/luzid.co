import { expect, test } from '@playwright/test'

/**
 * The document shell and the response headers are the contract every later work package
 * builds on, so they are asserted here rather than inside any one effect's tests.
 */

test('serves the name as a single link to GitHub', async ({ page }) => {
  await page.goto('/')
  const link = page.getByRole('link', { name: 'Tomasz Cudziło' })
  await expect(link).toHaveAttribute('href', 'https://github.com/tomasz')
  await expect(link).toBeVisible()
  // Exactly once: duplicate layers must never reach the accessible name.
  await expect(page.getByRole('link')).toHaveCount(1)
})

test('sends every required header', async ({ page }) => {
  const res = await page.goto('/')
  const h = res.headers()
  expect(h['cache-control']).toBe('no-store')
  expect(h['x-content-type-options']).toBe('nosniff')
  expect(h['referrer-policy']).toBe('no-referrer')
  expect(h['strict-transport-security']).toContain('max-age=31536000')
  expect(h['luzid-pick']).toBeTruthy()

  const csp = h['content-security-policy']
  expect(csp).toContain("default-src 'none'")
  expect(csp).toContain("style-src-attr 'none'")
  expect(csp).toContain('font-src data:')
  expect(csp).toContain("frame-ancestors 'none'")
  expect(csp).toMatch(/nonce-/)
})

test('emits no inline style attribute (a nonce cannot cover one)', async ({ page }) => {
  await page.goto('/')
  expect(await page.locator('[style]').count()).toBe(0)
})

test('loads clean, and the nonce lets our own style and script run', async ({ page }) => {
  const problems = []
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))
  page.on('pageerror', (e) => problems.push(String(e)))
  await page.goto('/')
  await page.waitForTimeout(250)
  expect(problems).toEqual([])

  // The stylesheet is nonce'd; if the nonce were wrong the CSP would drop it and the
  // background would fall back to the UA default. This is the check that matters.
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(bg).not.toBe('rgba(0, 0, 0, 0)')
  // .l1 is sized by a calc() in that same stylesheet, so a default 16px means it never applied.
  const fs = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.querySelector('.l1')).fontSize),
  )
  expect(fs).toBeGreaterThan(40)
})

test('the CSP actually blocks a foreign inline script', async ({ page }) => {
  await page.goto('/')
  const ran = await page
    .addScriptTag({ content: 'window.__injected = true' })
    .then(() => page.evaluate(() => window.__injected === true))
    .catch(() => false)
  expect(ran).toBe(false)
})

test('never scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const { sw, cw, sh, ch } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
    sh: document.documentElement.scrollHeight,
    ch: document.documentElement.clientHeight,
  }))
  expect(sw).toBeLessThanOrEqual(cw)
  expect(sh).toBeLessThanOrEqual(ch)
})

test('an unknown path is a 404 and never costs a render', async ({ request }) => {
  const res = await request.get('/wp-login.php')
  expect(res.status()).toBe(404)
  expect(res.headers()['luzid-pick']).toBeUndefined()
})

test('a malformed seed is rejected', async ({ request }) => {
  expect((await request.get('/?seed=NOT!VALID')).status()).toBe(400)
  expect((await request.get('/?seed=k3f9x2m7qa')).status()).toBe(200)
})

test('a malformed or unknown pin is rejected without echoing the input', async ({ request }) => {
  for (const q of ['?e=NOT VALID', '?f=../../etc/passwd', '?r=zz', '?p=<script>']) {
    const res = await request.get(`/${q}`)
    expect(res.status(), q).toBe(400)
    expect(await res.text(), q).toBe('Bad pin')
  }
  // Shape-valid but nothing in the catalog answers to it.
  expect((await request.get('/?e=no-such-effect')).status()).toBe(400)
})

test('QA mask mode is reachable by pin alone', async ({ request }) => {
  // `?p=qa-bw&e=plain` is what the fit pixel scan measures: black on white, no effect.
  // qa-bw has odds 0, so it is never drawn — a pin has to be able to resolve it anyway.
  const res = await request.get('/?p=qa-bw&e=plain&seed=k3f9x2m7qa')
  expect(res.status()).toBe(200)
  const pick = res.headers()['luzid-pick']
  expect(pick).toContain('p:qa-bw.')
  expect(pick).toContain('e:plain')

  const body = await res.text()
  expect(body).toContain('--bg:#ffffff')
  expect(body).toContain('--fg:#000000')
})

test('the Luzid-Pick header is the canonical tuple', async ({ request }) => {
  const res = await request.get('/?seed=k3f9x2m7qa')
  expect(res.headers()['luzid-pick']).toMatch(/^f:\S+\.\S+ p:\S+\.\S+ e:\S+ l:\S+$/)
  // The same string is in the colophon, so a "view source" bug report is the header.
  expect(await res.text()).toContain(`<!-- ${res.headers()['luzid-pick']} ·`)
})

test('the same seed renders the same page; different visits differ', async ({ request }) => {
  const a = await request.get('/?seed=k3f9x2m7qa')
  const b = await request.get('/?seed=k3f9x2m7qa')
  expect(a.headers()['luzid-pick']).toBe(b.headers()['luzid-pick'])

  // Sampled rather than compared pairwise: until the font and palette batches land, the
  // whole catalog is one system font and one QA palette, so the pick space is a few dozen
  // outcomes and two consecutive visits collide about 2% of the time. Six visits still
  // catch what this test is for — a cache or a frozen seed serving one look to everyone.
  const picks = new Set()
  for (let i = 0; i < 6; i++) picks.add((await request.get('/')).headers()['luzid-pick'])
  expect(picks.size).toBeGreaterThan(1)
})

test('restoring from the back/forward cache re-rolls', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Chrome is the engine that bfcaches no-store pages')
  await page.goto('/')
  const before = await page.getAttribute('html', 'data-seed')
  await page.goto('/robots.txt')
  await page.goBack()
  await page.waitForFunction((prev) => document.documentElement.dataset.seed !== prev, before, {
    timeout: 5000,
  })
  expect(await page.getAttribute('html', 'data-seed')).not.toBe(before)
})
