/**
 * Which e2e tests pass only on retry, and how often.
 *
 *   node scripts/flaky.mjs test-results/results.json   one run, as a CI job summary
 *   node scripts/flaky.mjs --runs 50                   the last 50 `ci` runs, through `gh`
 *
 * `retries: 1` keeps a flake from failing the gate, which also keeps it out of sight. Every
 * e2e job therefore uploads Playwright's JSON report as `e2e-results-<engine>`, and this
 * script reads those back: per test, how many runs it was in, how many it was flaky or failed
 * in, and the first line of the error that made it retry. Markdown on stdout; nothing is
 * written anywhere else.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { glob } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { runs: { type: "string" }, top: { type: "string", default: "30" } },
});

/** @type {Map<string, {runs: Set<string>, flaky: number, failed: number, why: Map<string, number>}>} */
const tests = new Map();
/** @type {{id: string, label: string, flaky: number, failed: number}[]} */
const runs = [];

/** Every test in one report, however deep its describe blocks are. */
function* walk(suite, path = []) {
  const here = suite.title && !suite.title.endsWith(".js") ? [...path, suite.title] : path;
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests)
      yield { file: spec.file, title: [...here, spec.title].join(" › "), t };
  }
  for (const s of suite.suites ?? []) yield* walk(s, here);
}

/** @param {string} run @param {string} file */
function add(run, file) {
  const report = JSON.parse(readFileSync(file, "utf8"));
  let row = runs.find((r) => r.id === run);
  if (!row) {
    row = { id: run, label: run, flaky: 0, failed: 0 };
    runs.push(row);
  }
  for (const s of report.suites) {
    for (const { file: f, title, t } of walk(s)) {
      if (t.status === "skipped") continue;
      const key = `[${t.projectName}] ${f} › ${title}`;
      let e = tests.get(key);
      if (!e) {
        e = { runs: new Set(), flaky: 0, failed: 0, why: new Map() };
        tests.set(key, e);
      }
      e.runs.add(run);
      if (t.status === "flaky") {
        e.flaky++;
        row.flaky++;
      }
      if (t.status === "unexpected") {
        e.failed++;
        row.failed++;
      }
      for (const r of t.results) {
        const msg = r.status !== "passed" && r.error?.message?.split("\n")[0].slice(0, 120);
        if (msg) e.why.set(msg, (e.why.get(msg) ?? 0) + 1);
      }
    }
  }
}

const gh = (...args) =>
  execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

let title;
if (values.runs) {
  const list = JSON.parse(
    gh(
      "run",
      "list",
      "--workflow",
      "ci.yml",
      "--status",
      "completed",
      "--limit",
      values.runs,
      "--json",
      "databaseId,createdAt,headBranch",
    ),
  );
  const dir = mkdtempSync(join(tmpdir(), "flaky-"));
  let missing = 0;
  try {
    for (const r of list) {
      const into = join(dir, String(r.databaseId));
      try {
        gh("run", "download", String(r.databaseId), "--pattern", "e2e-results-*", "--dir", into);
      } catch {
        missing++; // older than the report, expired, or the run never reached e2e
        continue;
      }
      for await (const f of glob("**/results.json", { cwd: into }))
        add(String(r.databaseId), join(into, f));
      const row = runs.find((x) => x.id === String(r.databaseId));
      if (row) row.label = `${r.createdAt.slice(0, 10)} ${r.headBranch}`;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  title = `## Flaky e2e tests: last ${list.length} \`ci\` runs, ${runs.length} with reports${missing ? `, ${missing} without` : ""}`;
} else {
  for (const f of positionals) add("this run", f);
  title = "## Flaky e2e tests: this run";
}

const bad = [...tests].filter(([, e]) => e.flaky || e.failed);
bad.sort(([, a], [, b]) => b.flaky + b.failed - (a.flaky + a.failed));

const out = [title, ""];
const hit = runs.filter((r) => r.flaky || r.failed);
out.push(
  `${hit.length} of ${runs.length} runs had a flaky or failed test; ${tests.size} tests seen.`,
  "",
);
if (bad.length) {
  out.push("| test | runs | flaky | failed | first error |", "|---|---|---|---|---|");
  for (const [key, e] of bad.slice(0, Number(values.top))) {
    const why = [...e.why].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    const cell = (s) => s.replaceAll("|", "\\|");
    out.push(`| ${cell(key)} | ${e.runs.size} | ${e.flaky} | ${e.failed} | ${cell(why)} |`);
  }
  if (bad.length > Number(values.top))
    out.push("", `…and ${bad.length - Number(values.top)} more.`);
}
if (values.runs && hit.length) {
  out.push("", "| run | flaky | failed |", "|---|---|---|");
  for (const r of hit) out.push(`| ${r.label} | ${r.flaky} | ${r.failed} |`);
}
console.log(out.join("\n"));
