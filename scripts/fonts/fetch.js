/**
 * PLAN §5.5 rule 1: where an upstream original and its licence come from. The only part of
 * the font pipeline that touches the network or the disk on the way in.
 *
 * The Google `css2` API is never a source. It silently strips `ssNN`, `salt`, `swsh` and
 * `dlig` from what it serves (google/fonts#1335), which is exactly the material this site
 * randomises over. Sources are raw files at an immutable commit, or a direct file URL plus a
 * copy committed under `fonts/upstream/` when the upstream has no VCS at all.
 *
 * Originals at a commit are cached under `cacheDir`, keyed by their sha256, so a re-run is
 * offline and cannot be poisoned.
 */
import { hash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pinnedToCommit, RowError, upstreamPaths } from "./rules.js";

const sha256 = (data) => hash("sha256", data);

async function fetchBinary(url) {
  // A stalled host would otherwise hang the whole batch with no error at all.
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`GET ${url} → ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchOriginal(row, { upstreamDir, cacheDir, writeRepo }) {
  if (!pinnedToCommit(row.url)) {
    const path = join(upstreamDir, upstreamPaths(row).original);
    const buffer = await readFile(path).catch(() => null);
    if (buffer) return buffer;
    const fetched = await fetchBinary(row.url);
    if (!writeRepo) return fetched;
    await mkdir(upstreamDir, { recursive: true });
    await writeFile(path, fetched);
    return fetched;
  }
  await mkdir(cacheDir, { recursive: true });
  if (row.sha256) {
    const cached = await readFile(join(cacheDir, `${row.sha256}.bin`)).catch(() => null);
    if (cached && sha256(cached) === row.sha256) return cached;
  }
  const fetched = await fetchBinary(row.url);
  await writeFile(join(cacheDir, `${sha256(fetched)}.bin`), fetched);
  return fetched;
}

/**
 * The upstream original, from `fonts/upstream` when committed, else from the sha-keyed cache,
 * else from the network; refused when it is not the file the row's `sha256` names.
 * The cache is always written. The repository is written only when `writeRepo` says so:
 * `--check` and `--traits` must leave the tree exactly as they found it.
 */
export async function readUpstream(row, dirs) {
  const original = await fetchOriginal(row, dirs);
  const digest = sha256(original);
  if (row.sha256 && row.sha256 !== digest)
    throw new RowError(row.id, `sha256 mismatch: row says ${row.sha256}, file is ${digest}`);
  return original;
}

/** The licence text, plus rule 8's committed upstream notice when the row has one. */
export async function readLicense(row, { upstreamDir, cacheDir }) {
  await mkdir(cacheDir, { recursive: true });
  const key = join(cacheDir, `${sha256(row.licenseUrl)}.txt`);
  let license = await readFile(key, "utf8").catch(() => null);
  if (license === null) {
    license = (await fetchBinary(row.licenseUrl)).toString("utf8");
    await writeFile(key, license);
  }
  // Rule 8 wants the upstream MANIFEST appended for GUST fonts. It is committed rather
  // than fetched: CTAN has no immutable URLs, so a build must not depend on reaching it.
  const notice = await readFile(join(upstreamDir, upstreamPaths(row).notice), "utf8").catch(
    () => null,
  );
  const tidy = (text) => text.replace(/\r\n/g, "\n").trimEnd();
  return { license: tidy(license), extras: notice ? [tidy(notice)] : [] };
}
