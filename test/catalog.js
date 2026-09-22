/**
 * Loads the frozen mini-catalog in `test/fixtures/catalog/`.
 *
 * Goldens run against this and never against the live catalog, so a font, palette or
 * effect PR cannot move another package's snapshots. The two effects are re-exported from
 * the real `effects/` files: changing the effect contract *should* move the goldens.
 *
 * Each test file is its own process under `node --test`, so the generated module gets a
 * per-process name; two files building at once can never read a half-written one.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from '../scripts/build.mjs'

const here = import.meta.dirname
let cached = null

/** @returns {Promise<object>} */
export async function fixtureCatalog() {
  if (cached) return cached
  const out = resolve(here, `../build/fixture-catalog.${process.pid}.js`)
  await build({ root: resolve(here, 'fixtures/catalog'), out, quiet: true })
  cached = (await import(pathToFileURL(out).href)).default
  return cached
}

/** Deterministic seed sequence for the property and coverage tests. */
export function* seeds(n, prefix = 's') {
  for (let i = 0; i < n; i++) yield `${prefix}${i}`
}

/**
 * The seeds every golden runs on. Chosen by set cover over the fixture catalog so that
 * four of them exercise both layouts, `side`, all three variants, all three palettes, both
 * derived grounds, both effects and a dark role set.
 */
export const GOLDEN_SEEDS = ['golden-001', 'golden-004', 'golden-005', 'golden-006', 'k3f9x2m7qa', 'a']
