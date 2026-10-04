import { relative } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";
import { build } from "./scripts/catalog.js";

// The directories scripts/catalog.js globs into build/catalog.js. Never add build/ itself:
// rebuilding on a change to its own output would loop.
const SOURCES = ["effects/", "presets/", "fonts/meta/", "data/"];

/**
 * Generates build/catalog.js before anything imports it (dev, build, preview and tests all
 * load this config first), and again whenever a data file changes under `vp dev`. Vite then
 * sees the regenerated module and reloads the Worker.
 */
function catalog() {
  return {
    name: "luzid:catalog",
    async config() {
      await build({ quiet: true });
    },
    configureServer(server) {
      // A burst of saves must not start overlapping builds that interleave their writes:
      // while one runs, later events only mark it dirty, and it runs once more at the end.
      // `fresh` re-imports effect modules, which Node would otherwise serve from its cache.
      let running = false;
      let dirty = false;
      server.watcher.on("all", async (_event, file) => {
        const rel = relative(server.config.root, file);
        if (!SOURCES.some((dir) => rel.startsWith(dir))) return;
        if (running) {
          dirty = true;
          return;
        }
        running = true;
        try {
          do {
            dirty = false;
            await build({ quiet: true, fresh: true });
          } while (dirty);
        } finally {
          running = false;
        }
      });
    },
  };
}

export default defineConfig({
  // `vp check` type-checks src/ and effects/ (tsconfig.json) through tsgolint, which ships
  // with vite-plus: JSDoc types, no TypeScript dependency, no build step.
  lint: { options: { typeAware: true, typeCheck: true } },
  fmt: {
    // Code only. Data is generated (fonts/meta, data/palettes), upstream-verbatim
    // (data/sources) or hand-kept one row per line (fonts/sources); snapshots and fixtures
    // are byte-exact; Markdown holds specs whose code blocks are literal output.
    ignorePatterns: ["**/*.md", "data/**", "fonts/**", "test/golden/**", "test/fixtures/**"],
  },
  // The Cloudflare plugin runs the Worker in workerd; unit tests import src/ directly.
  plugins: [catalog(), process.env.VITEST ? [] : cloudflare()],
  test: {
    // Vitest's default glob would also collect Playwright's e2e/*.spec.js.
    dir: "test",
    // node:test had no limit. The brotli-heavy property and woff2 tests take ~5 s when all
    // files run in parallel, right at Vitest's default; this is a ceiling, not a wait.
    testTimeout: 15_000,
  },
});
