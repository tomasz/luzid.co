import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { beforeAll, test, vi } from "vite-plus/test";
import worker from "../src/worker.js";
import { GOLDEN_SEEDS } from "./catalog.js";

/**
 * The HTTP contract of the one route, against the live catalog that the catalog plugin
 * writes to build/catalog.js before any test runs. These are plain Request -> Response
 * checks, so they live here once instead of in e2e three times over.
 */

const SEED = "k3f9x2m7qa";

/** @param {string} path @param {RequestInit} [init] */
const get = (path, init) => worker.fetch(new Request(`http://x${path}`, init));

/** @param {Response} res */
const nonceOf = (res) => res.headers.get("content-security-policy").match(/'nonce-([^']+)'/)[1];

// The worker logs one JSON line per render; that is for Workers Logs, not for test output.
beforeAll(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

test("sends every required header, and the nonce in the CSP is the one in the page", async () => {
  const res = await get(`/?seed=${SEED}`);
  assert.equal(res.status, 200);
  const h = res.headers;
  assert.equal(h.get("content-type"), "text/html; charset=utf-8");
  assert.equal(h.get("cache-control"), "no-store");
  assert.equal(h.get("x-content-type-options"), "nosniff");
  assert.equal(h.get("referrer-policy"), "no-referrer");
  assert.match(h.get("strict-transport-security"), /max-age=31536000/);
  assert.ok(h.get("luzid-pick"));

  const csp = h.get("content-security-policy");
  for (const directive of [
    "default-src 'none'",
    "style-src-attr 'none'",
    "font-src data:",
    "frame-ancestors 'none'",
  ]) {
    assert.ok(csp.includes(directive), directive);
  }
  const n = nonceOf(res);
  assert.ok(csp.includes(`style-src 'nonce-${n}'`));
  assert.ok(csp.includes(`script-src 'nonce-${n}'`));
  assert.ok((await res.text()).includes(`<style nonce="${n}">`));

  // Drawn per request, never from the seed: the same seed must not repeat a nonce.
  assert.notEqual(nonceOf(await get(`/?seed=${SEED}`)), n);
});

test("an unknown path is a 404 and never costs a render", async () => {
  const res = await get("/wp-login.php");
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("luzid-pick"), null);
});

test("a method other than GET or HEAD is a 405 that names the allowed ones", async () => {
  for (const method of ["POST", "PUT", "DELETE"]) {
    const res = await get("/", { method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "GET, HEAD", method);
    assert.equal(res.headers.get("luzid-pick"), null, method);
  }
});

test("HEAD returns the headers and an empty body", async () => {
  const res = await get(`/?seed=${SEED}`, { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(res.headers.get("content-security-policy"), /'nonce-/);
  assert.equal(
    res.headers.get("luzid-pick"),
    (await get(`/?seed=${SEED}`)).headers.get("luzid-pick"),
  );
  assert.equal(await res.text(), "");
});

test("a malformed seed is rejected", async () => {
  for (const seed of ["NOT!VALID", "ilou", "", "0123456789abcdefg"]) {
    assert.equal((await get(`/?seed=${encodeURIComponent(seed)}`)).status, 400, seed);
  }
  assert.equal((await get(`/?seed=${SEED}`)).status, 200);
});

test("every golden seed is a valid public seed", async () => {
  // A golden is only useful as a bug report if its page reproduces at /?seed=<name>.
  for (const seed of GOLDEN_SEEDS) {
    assert.equal((await get(`/?seed=${seed}`)).status, 200, seed);
  }
});

test("a malformed or unknown pin is rejected without echoing the input", async () => {
  // The last one is shape-valid, but nothing in the catalog answers to it.
  for (const q of ["e=NOT VALID", "f=../../etc/passwd", "r=zz", "p=<script>", "e=no-such-effect"]) {
    const res = await get(`/?${q}`);
    assert.equal(res.status, 400, q);
    assert.equal(await res.text(), "Bad pin", q);
    assert.equal(res.headers.get("luzid-pick"), null, q);
  }
});

test("QA mask mode is reachable by pin alone", async () => {
  // `?p=qa-bw&e=plain` is what the fit pixel scan measures: black on white, no effect.
  // qa-bw has odds 0, so it is never drawn — a pin has to be able to resolve it anyway.
  const res = await get(`/?p=qa-bw&e=plain&seed=${SEED}`);
  assert.equal(res.status, 200);
  const pick = res.headers.get("luzid-pick");
  assert.ok(pick.includes("p:qa-bw."), pick);
  assert.ok(pick.includes("e:plain"), pick);

  const body = await res.text();
  assert.ok(body.includes("--bg:#ffffff"));
  assert.ok(body.includes("--fg:#000000"));
});

test("the Luzid-Pick header is the canonical tuple", async () => {
  const res = await get(`/?seed=${SEED}`);
  const pick = res.headers.get("luzid-pick");
  assert.match(pick, /^f:\S+\.\S+ p:\S+\.\S+ e:\S+ l:\S+$/);
  // The same string is in the colophon, so a "view source" bug report is the header.
  assert.ok((await res.text()).includes(`<!-- ${pick} ·`));
});

test("the same seed renders the same page; different visits differ", async () => {
  // Same bytes apart from the nonce, which is the one per-request value.
  const page = async () => {
    const res = await get(`/?seed=${SEED}`);
    return (await res.text()).replaceAll(nonceOf(res), "N");
  };
  assert.equal(await page(), await page());

  // No seed means a fresh one per visit. The pick space is now thousands of tuples, so six
  // visits colliding is negligible; what this catches is a cache or a frozen seed serving
  // one look to everyone.
  const picks = new Set();
  for (let i = 0; i < 6; i++) picks.add((await get("/")).headers.get("luzid-pick"));
  assert.ok(picks.size > 1);
});

test("every same-origin URL the page links is served", async () => {
  // The owner still has to supply og.png (issue #114); it is the one known gap.
  const ownerSupplied = new Set(["/og.png"]);
  for (const seed of GOLDEN_SEEDS) {
    const html = await (await get(`/?seed=${seed}`)).text();
    for (const [, url] of html.matchAll(/\s(?:href|content)="([^"]*)"/g)) {
      const path = url.startsWith("https://luzid.co/") ? url.slice(16) : url;
      if (!path.startsWith("/") || path.startsWith("//") || path === "/") continue;
      const file = new URL(`../public${path}`, import.meta.url);
      assert.ok(existsSync(file) || ownerSupplied.has(path), `${seed}: ${path} is not in public/`);
    }
  }
});
