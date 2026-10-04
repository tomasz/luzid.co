/**
 * Post-deploy smoke test.  node scripts/smoke.mjs https://luzid.co
 *
 * Worker-level failures justify a rollback. Zone-level ones (an injected beacon, Speed
 * Brain) fail the job but must NOT roll the Worker back — the fix is a dashboard toggle.
 * Exit 1 = worker-level, exit 2 = zone-level only. In CI it also writes `rollback=true|false`
 * to $GITHUB_OUTPUT, which is what cd.yml gates the rollback on, and the on-wire size and
 * pick to the job summary.
 */
import { appendFileSync } from "node:fs";
import { get } from "node:https";
import { parseArgs } from "node:util";

const BUDGET = 14_000;

/**
 * Classify three probes of the page: `a` and `b` asked for brotli, `plain` for identity.
 * Each is `{status, headers, bytes, html}` or, when the request itself failed, `{error}`.
 * Pure, so the tests can feed it fabricated responses.
 * @returns {{worker: string[], zone: string[]}}
 */
export function check({ a, b, plain }) {
  const worker = [];
  const zone = [];

  // A probe that cannot be fetched or does not answer 200 means the site is down; the
  // remaining checks on it would only add noise.
  const ok = (name, r) => {
    if (r.error) worker.push(`${name}: request failed (${r.error})`);
    else if (r.status !== 200) worker.push(`${name}: status ${r.status}, expected 200`);
    else return true;
    return false;
  };
  const okA = ok("br", a);
  const okB = ok("br again", b);
  const okPlain = ok("identity", plain);

  if (okA) {
    if (a.headers["cache-control"] !== "no-store")
      worker.push(`cache-control is "${a.headers["cache-control"]}", expected no-store`);
    if (!/nonce-/.test(a.headers["content-security-policy"] ?? ""))
      worker.push("CSP header missing or has no nonce");
    if (!a.headers["luzid-pick"]) worker.push("Luzid-Pick header missing");
    if ((a.headers["cf-cache-status"] ?? "") === "HIT")
      worker.push("cf-cache-status is HIT — the HTML is being cached");
    // The budget is a brotli budget. Without br on the wire the zone (not the Worker)
    // changed the encoding, and the byte count says nothing about the Worker.
    if (a.headers["content-encoding"] !== "br")
      zone.push(`content-encoding is "${a.headers["content-encoding"]}", expected br`);
    else if (a.bytes > BUDGET)
      worker.push(`on-wire size ${a.bytes} B exceeds the ${BUDGET} B budget`);
    if (a.headers["speculation-rules"])
      zone.push("Speed Brain is on (speculation-rules header present)");
  }
  if (okA && okB && a.headers["luzid-pick"] === b.headers["luzid-pick"])
    worker.push("two requests returned the same pick — the page is not randomizing");

  if (okPlain) {
    if (!plain.html.includes('href="https://github.com/tomasz"'))
      worker.push("body is missing the GitHub link");
    if (!plain.html.includes("Tomasz Cudzi")) worker.push("body is missing the name");
    for (const needle of ["<script src", "cloudflareinsights", "/cdn-cgi/"]) {
      if (plain.html.includes(needle)) zone.push(`zone feature injected "${needle}" into the page`);
    }
  }

  return { worker, zone };
}

/** Fetch once over raw https so we can count on-wire bytes; fetch() decompresses silently. */
function fetchRaw(target, encoding) {
  return new Promise((resolve) => {
    const req = get(
      target,
      { headers: { "accept-encoding": encoding, "user-agent": "luzid-smoke" } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("error", (e) => resolve({ error: e.message }));
        res.on("end", () => {
          const raw = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            bytes: raw.length,
            html: raw.toString("utf8"),
          });
        });
      },
    );
    req.on("error", (e) => resolve({ error: e.message }));
    req.setTimeout(15_000, () => req.destroy(new Error("timeout")));
  });
}

async function main() {
  // `pnpm run <script> -- <url>` forwards the separator itself, so drop it (as sheet.mjs does).
  const { positionals } = parseArgs({
    args: process.argv.slice(2).filter((s) => s !== "--"),
    allowPositionals: true,
  });
  const url = positionals[0] ?? "https://luzid.co";

  const a = await fetchRaw(url, "br");
  const b = await fetchRaw(url, "br");
  // Body checks need the decoded text; ask for identity so we can read it directly.
  const plain = await fetchRaw(url, "identity");
  const { worker, zone } = check({ a, b, plain });

  const line = a.error
    ? `${url} → ${a.error}`
    : `${url} → ${a.status}, ${a.bytes} B on the wire (budget ${BUDGET}), pick "${a.headers["luzid-pick"]}"`;
  console.log(line);
  for (const f of worker) console.error(`worker: ${f}`);
  for (const f of zone) console.error(`zone:   ${f}`);

  const { GITHUB_OUTPUT, GITHUB_STEP_SUMMARY } = process.env;
  if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `rollback=${worker.length > 0}\n`);
  if (GITHUB_STEP_SUMMARY) {
    const failures = [...worker.map((f) => `worker: ${f}`), ...zone.map((f) => `zone: ${f}`)];
    appendFileSync(GITHUB_STEP_SUMMARY, [`smoke: ${line}`, ...failures, ""].join("\n\n"));
  }

  if (worker.length) {
    console.error("\nWorker-level failures — the deploy should be rolled back.");
    process.exitCode = 1;
  } else if (zone.length) {
    console.error("\nZone-level failures only — fix the Cloudflare toggles; do NOT roll back.");
    process.exitCode = 2;
  } else {
    console.log("smoke: all checks passed");
  }
}

if (import.meta.main) await main();
