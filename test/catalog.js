/**
 * Loads the frozen mini-catalog in `test/fixtures/catalog/`.
 *
 * Goldens run against this and never against the live catalog, so a font, palette or
 * effect PR cannot move another package's snapshots. The two effects are re-exported from
 * the real `effects/` files: changing the effect contract *should* move the goldens.
 *
 * It is loaded in memory with `loadCatalog`, the same read and check `build/catalog.js` is
 * written from, so no test writes a module and no two test processes can race on one.
 */
import { resolve } from "node:path";
import { loadCatalog } from "../scripts/build.mjs";

let cached = null;

/** @returns {Promise<object>} */
export async function fixtureCatalog() {
  cached ??= await loadCatalog(resolve(import.meta.dirname, "fixtures/catalog"));
  return cached;
}

/** Deterministic seed sequence for the property and coverage tests. */
export function* seeds(n, prefix = "s") {
  for (let i = 0; i < n; i++) yield `${prefix}${i}`;
}

/**
 * The seeds every golden runs on. Chosen by set cover over valid public seeds (the
 * worker's SEED_RE), so each golden reproduces at `/?seed=<name>`: together they exercise
 * both layouts, `side`, all three variants, all three palettes, both derived grounds, both
 * effects and a dark role set.
 */
export const GOLDEN_SEEDS = ["gs", "gt", "gp", "gn", "k3f9x2m7qa", "a"];
