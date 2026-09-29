import { relative } from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite-plus'
import { build } from './scripts/build.mjs'

// The directories scripts/build.mjs globs into build/catalog.js. Never add build/ itself:
// rebuilding on a change to its own output would loop.
const SOURCES = ['effects/', 'presets/', 'fonts/meta/', 'data/']

/**
 * Generates build/catalog.js before anything imports it (dev, build and preview all load
 * this config first), and again whenever a data file changes under `vp dev`. Vite then
 * sees the regenerated module and reloads the Worker.
 */
function catalog() {
  return {
    name: 'luzid:catalog',
    async config() {
      await build({ quiet: true })
    },
    configureServer(server) {
      server.watcher.on('all', async (_event, file) => {
        const rel = relative(server.config.root, file)
        if (SOURCES.some((dir) => rel.startsWith(dir))) await build({ quiet: true })
      })
    },
  }
}

export default defineConfig({
  // The Cloudflare plugin runs the Worker in workerd.
  plugins: [catalog(), cloudflare()],
})
