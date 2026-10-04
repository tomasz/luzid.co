import { expect, test } from "@playwright/test";

/**
 * What only a real browser can show: the link as the accessibility tree sees it, the CSP
 * enforced, and the back/forward cache. Status codes, headers and pins are plain
 * Request -> Response checks and live in test/worker.test.js.
 */

test("serves the name as a single link to GitHub", async ({ page }) => {
  await page.goto("/");
  const link = page.getByRole("link", { name: "Tomasz Cudziło" });
  await expect(link).toHaveAttribute("href", "https://github.com/tomasz");
  await expect(link).toBeVisible();
  // Exactly once: duplicate layers must never reach the accessible name.
  await expect(page.getByRole("link")).toHaveCount(1);
});

test("loads clean, and the nonce lets our own style and script run", async ({ page }) => {
  const problems = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(String(e)));
  await page.goto("/");
  await page.waitForTimeout(250);
  expect(problems).toEqual([]);

  // The stylesheet is nonce'd; if the nonce were wrong the CSP would drop it and the
  // background would fall back to the UA default. This is the check that matters.
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).not.toBe("rgba(0, 0, 0, 0)");
  // .l1 is sized by a calc() in that same stylesheet, so a default 16px means it never applied.
  const fs = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.querySelector(".l1")).fontSize),
  );
  expect(fs).toBeGreaterThan(40);
});

test("the CSP actually blocks a foreign inline script", async ({ page }) => {
  await page.goto("/");
  const ran = await page
    .addScriptTag({ content: "window.__injected = true" })
    .then(() => page.evaluate(() => window.__injected === true))
    .catch(() => false);
  expect(ran).toBe(false);
});

test("restoring from the back/forward cache re-rolls", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Chrome is the engine that bfcaches no-store pages");
  await page.goto("/");
  const before = await page.getAttribute("html", "data-seed");
  await page.goto("/robots.txt");
  await page.goBack();
  await page.waitForFunction((prev) => document.documentElement.dataset.seed !== prev, before, {
    timeout: 5000,
  });
  expect(await page.getAttribute("html", "data-seed")).not.toBe(before);
});
