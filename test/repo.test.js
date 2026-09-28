import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'vite-plus/test'

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8')

test('the lockfile is a single YAML document', async () => {
  // Given a `packageManager` field, or `devEngines.packageManager` with any `onFail` but
  // "ignore", pnpm 12 appends a SECOND lockfile document describing itself. GitHub's dependency
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
  // devEngines.packageManager is the one pnpm declaration: `vp` reads it, and pnpm 12 does
  // not enforce engines.pnpm, so a second copy there could only drift.
  const pkg = JSON.parse(await read('package.json'))
  assert.equal('pnpm' in pkg.engines, false, 'declare pnpm once, in devEngines.packageManager')
  const wanted = pkg.devEngines.packageManager.version
  assert.match(wanted, /^\d+\.\d+\.\d+$/, 'devEngines.packageManager.version must be exact')

  // setup-vp in CI pins pnpm through these two variables: VP_PACKAGE_MANAGER for
  // `vp install`, VP_PNPM_VERSION for `pnpm`.
  for (const file of ['.github/workflows/ci.yml', '.github/workflows/deploy.yml']) {
    const yml = await read(file)
    assert.match(yml, new RegExp(`VP_PACKAGE_MANAGER: "?pnpm@${wanted}"?\\n`), `${file} VP_PACKAGE_MANAGER`)
    assert.match(yml, new RegExp(`VP_PNPM_VERSION: "?${wanted}"?\\n`), `${file} VP_PNPM_VERSION`)
    assert.equal(yml.includes('pnpm/action-setup'), false, `${file}: setup-vp provides pnpm`)
  }

  // onFail must stay "ignore": any other value adds the second lockfile document (see above).
  assert.deepEqual(pkg.devEngines.packageManager, { name: 'pnpm', version: wanted, onFail: 'ignore' })

  assert.ok((await read('AGENTS.md')).includes(`pnpm@${wanted}`), `AGENTS.md must document pnpm@${wanted}`)
})

test('the Node version is declared once, as a single major in engines.node', async () => {
  // `vp env` reads .node-version and .nvmrc before or after engines.node; a second file
  // could silently disagree. A range like ">=24" would let it pick a newer major.
  const { engines } = JSON.parse(await read('package.json'))
  assert.match(engines.node, /^\d+$/, `engines.node must be one major, got "${engines.node}"`)
  const { access } = await import('node:fs/promises')
  for (const file of ['.nvmrc', '.node-version']) {
    await assert.rejects(access(new URL(`../${file}`, import.meta.url)), `${file} must not exist`)
  }
})

test('dependency versions are pinned exactly', async () => {
  const pkg = JSON.parse(await read('package.json'))
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0, 'there must be no runtime dependencies')
  for (const [name, range] of Object.entries(pkg.devDependencies)) {
    assert.match(range, /^\d+\.\d+\.\d+$/, `${name} must be pinned exactly, got "${range}"`)
  }
  assert.equal('packageManager' in pkg, false, 'packageManager would add a second lockfile document')
  assert.equal('runtime' in pkg.devEngines, false, 'devEngines.runtime makes pnpm manage Node alongside vp env')

  // Vite+ requires overrides for vite and vitest; they must match what vite-plus bundles
  // (docs/guide/local-cli.md in the vite-plus package), so they move with it, never alone.
  const ws = await read('pnpm-workspace.yaml')
  const vp = pkg.devDependencies['vite-plus']
  assert.match(ws, new RegExp(`\\n  vite: npm:@voidzero-dev/vite-plus-core@${vp}\\n`), 'vite override ≠ vite-plus')
  const bundled = JSON.parse(await read('node_modules/vite-plus/package.json')).dependencies.vitest
  assert.match(ws, new RegExp(`\\n  vitest: ${bundled.replaceAll('.', '\\.')}\\n`), `vitest override ≠ ${bundled}`)
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
  // The catalog plugin in vite.config.js builds and watches instead; a custom build here
  // would run beside it.
  assert.ok(!('build' in cfg), 'wrangler must not run its own build')
})

test('public/ has no index.html', async () => {
  // It would shadow the Worker on "/" and the page would stop randomizing.
  const { glob } = await import('node:fs/promises')
  const found = []
  for await (const entry of glob('public/**/index.html')) found.push(entry)
  assert.deepEqual(found, [])
})
