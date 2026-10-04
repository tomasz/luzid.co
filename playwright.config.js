import { defineConfig, devices } from "@playwright/test";

// Every worktree gets a free port, 8800+, so parallel agents never collide.
const port = Number(process.env.PORT ?? 8787);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  // The default of 2 leaves a 4-vCPU runner idle between screenshots. Three keeps one core
  // for `vp preview`, which every test shares.
  workers: process.env.CI ? 3 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html"]] : "list",
  // One fit test walks up to eight viewports, and the 3840x2160 screenshot alone is 8.3M
  // pixels to encode, transfer and scan. The default 30 s is not enough headroom for the
  // slowest of those on a loaded CI box; this is a ceiling, not a wait.
  timeout: 300_000,
  expect: { timeout: 10_000 },
  use: { baseURL, trace: "retain-on-failure" },
  webServer: {
    // The built Worker in workerd, i.e. what deploys; a green run proves `vp build` works.
    // --host 127.0.0.1 avoids the IPv4/IPv6 readiness flake.
    command: `pnpm exec vp build && pnpm exec vp preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${baseURL}/`,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // The bfcache test needs Chrome's back/forward cache, which Playwright disables.
        ignoreDefaultArgs: ["--disable-back-forward-cache"],
      },
    },
    { name: "firefox", use: devices["Desktop Firefox"] },
    {
      name: "webkit",
      // §9.2 measures at DPR 1: the fit thresholds are in CSS pixels and a HiDPI
      // screenshot would only add rasterization noise to the ink scan. Chrome's and
      // Firefox's descriptors are already DPR 1; Safari's is 2.
      use: { ...devices["Desktop Safari"], deviceScaleFactor: 1 },
    },
  ],
});
