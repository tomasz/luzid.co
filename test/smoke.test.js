import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { check } from "../scripts/smoke.mjs";

// What a healthy production response looks like on each of the three probes.
const page = '<a href="https://github.com/tomasz">Tomasz Cudziło</a>';
const healthy = (pick, encoding = "br") => ({
  status: 200,
  headers: {
    "cache-control": "no-store",
    "content-security-policy": "style-src 'nonce-abc'",
    "luzid-pick": pick,
    "content-encoding": encoding,
    "cf-cache-status": "DYNAMIC",
  },
  bytes: 9_000,
  html: page,
});
const probes = (overrides = {}) => ({
  a: healthy("one"),
  b: healthy("two"),
  plain: healthy("three", undefined),
  ...overrides,
});
// cd.yml rolls back exactly when smoke.mjs writes rollback=true, i.e. on worker failures.
const rollback = ({ worker }) => worker.length > 0;

test("a healthy deploy passes and does not roll back", () => {
  const result = check(probes());
  assert.deepEqual(result, { worker: [], zone: [] });
  assert.equal(rollback(result), false);
});

test("a worker-level failure rolls back", () => {
  const a = {
    ...healthy("one"),
    headers: { ...healthy("one").headers, "cache-control": "max-age=60" },
  };
  const result = check(probes({ a, plain: { ...healthy("three"), html: "<p>oops</p>" } }));
  assert.deepEqual(result.worker, [
    'cache-control is "max-age=60", expected no-store',
    "body is missing the GitHub link",
    "body is missing the name",
  ]);
  assert.deepEqual(result.zone, []);
  assert.equal(rollback(result), true);
});

test("a non-200 on any probe is a worker failure", () => {
  const result = check(probes({ b: { ...healthy("two"), status: 503 } }));
  assert.deepEqual(result.worker, ["br again: status 503, expected 200"]);
  assert.equal(rollback(result), true);
});

test("zone-level failures alone fail the job but do not roll back", () => {
  const a = {
    ...healthy("one"),
    headers: { ...healthy("one").headers, "speculation-rules": "/x" },
  };
  const plain = { ...healthy("three"), html: `${page}<script src="/cdn-cgi/beacon.js">` };
  const result = check(probes({ a, plain }));
  assert.deepEqual(result.worker, []);
  assert.deepEqual(result.zone, [
    "Speed Brain is on (speculation-rules header present)",
    'zone feature injected "<script src" into the page',
    'zone feature injected "/cdn-cgi/" into the page',
  ]);
  assert.equal(rollback(result), false);
});

test("a transport error means the site is down and rolls back", () => {
  const down = { error: "getaddrinfo ENOTFOUND luzid.co" };
  const result = check({ a: down, b: down, plain: down });
  assert.deepEqual(result.worker, [
    "br: request failed (getaddrinfo ENOTFOUND luzid.co)",
    "br again: request failed (getaddrinfo ENOTFOUND luzid.co)",
    "identity: request failed (getaddrinfo ENOTFOUND luzid.co)",
  ]);
  assert.deepEqual(result.zone, []);
  assert.equal(rollback(result), true);
});

test("an oversized body without brotli is a zone failure, not a budget breach", () => {
  // The zone served identity: the bytes are uncompressed, so the brotli budget does not apply.
  const a = { ...healthy("one", "identity"), bytes: 40_000 };
  const result = check(probes({ a }));
  assert.deepEqual(result.worker, []);
  assert.deepEqual(result.zone, ['content-encoding is "identity", expected br']);
  assert.equal(rollback(result), false);
});

test("an oversized brotli body is a worker failure", () => {
  const result = check(probes({ a: { ...healthy("one"), bytes: 14_001 } }));
  assert.deepEqual(result.worker, ["on-wire size 14001 B exceeds the 14000 B budget"]);
  assert.equal(rollback(result), true);
});

test("the same pick twice means the page is not randomizing", () => {
  const result = check(probes({ b: healthy("one") }));
  assert.deepEqual(result.worker, [
    "two requests returned the same pick — the page is not randomizing",
  ]);
});
