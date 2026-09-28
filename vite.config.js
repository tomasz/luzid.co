import { relative } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";
import { build } from "./scripts/build.mjs";

// The directories scripts/build.mjs globs into build/catalog.js. Never add build/ itself:
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
      server.watcher.on("all", async (_event, file) => {
        const rel = relative(server.config.root, file);
        if (SOURCES.some((dir) => rel.startsWith(dir))) await build({ quiet: true });
      });
    },
  };
}

export default defineConfig({
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
    testTimeout: 60_000,
  },
});
