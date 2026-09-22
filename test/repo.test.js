import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8')

test('the lockfile is a single YAML document', async () => {
  // Given a `packageManager` (or `devEngines.packageManager`) field, pnpm 12 self-installs
  // that version and appends a SECOND lockfile document describing it. GitHub's dependency
  // graph reads one document, so the extra one can make the repo look dependency-free and
  // silently blind Dependabot alerts (dependabot-core#15904). Verified on 2026-09-22:
  // removing the field drops the lockfile from 1243 lines / 2 documents to 1085 / 1.
  const lock = await read('pnpm-lock.yaml')
  assert.ok(!lock.includes('packageManagerDependencies'), 'lockfile carries an env document')
  assert.ok(!/^---$/m.test(lock), 'lockfile has a YAML document separator')
})

test('the pnpm version is pinned identically everywhere', async () => {
  // Because `packageManager` cannot be used (see above), the version lives in more than one
  // file. This test is what keeps them one source of truth.
  const wanted = JSON.parse(await read('package.json')).engines.pnpm
  assert.match(wanted, /^\d+\.\d+\.\d+$/, 'engines.pnpm must be an exact version')

  for (const file of ['.github/workflows/ci.yml', '.github/workflows/deploy.yml']) {
    const yml = await read(file)
    const setups = [...yml.matchAll(/pnpm\/action-setup@[^\n]*\n\s*with:\n\s*version:\s*(\S+)/g)]
    const bare = (yml.match(/pnpm\/action-setup@/g) ?? []).length
    assert.equal(setups.length, bare, `${file}: every pnpm/action-setup needs an explicit version`)
    for (const [, v] of setups) assert.equal(v, wanted, `${file} pins pnpm ${v}, package.json says ${wanted}`)
  }

  assert.ok((await read('AGENTS.md')).includes(`pnpm@${wanted}`), `AGENTS.md must document pnpm@${wanted}`)
})

test('dependency versions are pinned exactly', async () => {
  const pkg = JSON.parse(await read('package.json'))
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0, 'there must be no runtime dependencies')
  for (const [name, range] of Object.entries(pkg.devDependencies)) {
    assert.match(range, /^\d+\.\d+\.\d+$/, `${name} must be pinned exactly, got "${range}"`)
  }
})

test('no template in src/ can emit an inline style attribute', async () => {
  // A CSP nonce covers <style> elements only, never style="" attributes (CSP3 §6.7.3.3).
  // The document template moved to src/render.js in WP-10, so this scans all of src/ —
  // grepping worker.js alone would now assert nothing. `test/render.test.js` makes the same
  // check against the rendered output; this one catches it at the source.
  const { glob } = await import('node:fs/promises')
  for await (const file of glob('src/*.js')) {
    const src = await read(file)
    assert.ok(!/\sstyle="/.test(src.replaceAll('<style', '<S')), `${file} contains a style attribute`)
  }
})

test('wrangler config keeps the routing invariants', async () => {
  const raw = await read('wrangler.jsonc')
  const cfg = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''))
  assert.equal(cfg.assets.directory, 'public')
  assert.ok(!('not_found_handling' in cfg.assets), 'not_found_handling must stay unset')
  assert.ok(!('run_worker_first' in cfg.assets), 'run_worker_first must stay unset on the Free plan')
  assert.ok(!('cache' in cfg), 'Workers Cache would freeze one look for every visitor')
  assert.deepEqual(cfg.routes, [{ pattern: 'luzid.co', custom_domain: true }])
  assert.ok(Array.isArray(cfg.build.watch_dir) && cfg.build.watch_dir.length > 0)
})

test('public/ has no index.html', async () => {
  // It would shadow the Worker on "/" and the page would stop randomizing.
  const { glob } = await import('node:fs/promises')
  const found = []
  for await (const entry of glob('public/**/index.html')) found.push(entry)
  assert.deepEqual(found, [])
})
