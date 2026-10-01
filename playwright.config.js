import { defineConfig, devices } from "@playwright/test";

// Every agent gets its own port (8800 + WP number) so parallel worktrees never collide.
const port = Number(process.env.PORT ?? 8787);
const baseURL = `http://127.0.0.1:${port}`;

/**
 * §9.2's scope switch. `changed` is the required PR check and is what keeps the run inside
 * ~10 minutes: the per-variant fit sweep only fires when a font meta or the engine moved.
 * `all` is the WP-50 sweep, run weekly and on demand by `sweep.yml`, and is never a
 * required check.
 *
 * The specs read `FIT_SCOPE` themselves (`e2e/fit-lib.js`); it is named here because this
 * is where someone looks for it.
 */
const scope = process.env.FIT_SCOPE === "all" ? "all" : "changed";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  // The default of 2 leaves a 4-vCPU runner idle between screenshots. Three keeps one core
  // for `vp preview`, which every test shares.
  workers: process.env.CI ? 3 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The JSON report is what `scripts/flaky.mjs` reads; CI uploads it as `e2e-results-<engine>`.
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { open: "never" }],
        ["json", { outputFile: "test-results/results.json" }],
      ]
    : "list",
  // One fit test walks up to eight viewports, and the 3840x2160 screenshot alone is 8.3M
  // pixels to encode, transfer and scan. The default 30 s is not enough headroom for the
  // slowest of those on a loaded CI box; this is a ceiling, not a wait.
  timeout: scope === "all" ? 300_000 : 180_000,
  expect: { timeout: 10_000 },
  use: { baseURL, trace: "retain-on-failure" },
  webServer: {
    // The built Worker in workerd, i.e. what deploys; a green run proves `vp build` works.
    // --host 127.0.0.1 avoids the IPv4/IPv6 readiness flake.
    command: `pnpm exec vp build && pnpm exec vp preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${baseURL}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { WRANGLER_SEND_METRICS: "false" },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // The bfcache test needs Chrome's back/forward cache, which Playwright disables.
        ignoreDefaultArgs: ["--disable-back-forward-cache"],
        // §9.2 measures at DPR 1: the fit thresholds are in CSS pixels and a HiDPI
        // screenshot would only add rasterization noise to the ink scan.
        deviceScaleFactor: 1,
      },
    },
    { name: "firefox", use: { ...devices["Desktop Firefox"], deviceScaleFactor: 1 } },
    { name: "webkit", use: { ...devices["Desktop Safari"], deviceScaleFactor: 1 } },
  ],
});
