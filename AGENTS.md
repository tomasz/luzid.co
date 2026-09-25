# luzid.co — agent guide

One page. It shows **Tomasz Cudziło** as large as the screen allows, as one link to
github.com/tomasz, and re-randomizes colour, font, font variant, effect and layout on
every visit. One Cloudflare Worker renders it in a single response under 14 KB.

**Simplicity, stability, predictability. Avoid complexity at all cost.** That is the
owner's rule and it outranks cleverness everywhere in this repo. The engine is small and
fixed; all variety lives in data files, one item per file, so parallel agents never edit
the same file.

`docs/contracts.md` is the source of truth for the engine, the fit maths, the file schemas
and the effect contract. It wins over this file. Changing it needs a PR labelled
`contract`, merged by the owner.

## Environment

On the owner's Mac pnpm is always invoked through mise. There is no mise.toml in this
repo, and `corepack` does not work here (the global Node 24.20.0 has no corepack binary).

```
mise exec node@24 pnpm@12.4.2 -- pnpm <args>
```

CI and the devcontainer use plain `pnpm`.

There is deliberately **no `packageManager` field** in `package.json`. Given one, pnpm 12
self-installs that version and appends a second document to `pnpm-lock.yaml`; GitHub's
dependency graph reads only one document and can then report the repo as having no
dependencies, which silently disables Dependabot alerts. The version lives in
`engines.pnpm` and in the `version:` input of every `pnpm/action-setup` step instead, and
`test/repo.test.js` fails if those ever disagree. Node built-ins are preferred over packages:
`node --test`, `node:zlib`, `fs.glob`, `parseArgs`, `fetch`. There are exactly five
devDependencies and zero runtime dependencies. **Only WP-00 may touch `package.json`,
`pnpm-lock.yaml`, `pnpm-workspace.yaml` or `biome.json`** — if your work package seems to
need a new dependency, stop and report instead.

## Commands

| Command | What |
|---|---|
| `pnpm run check` | build the catalog, then Biome, then `node --test`. The gate for every PR. |
| `pnpm run dev` | `wrangler dev` on 8787 |
| `pnpm run e2e` | Playwright in Chromium, Firefox and WebKit against `wrangler dev` |
| `pnpm run fonts` / `palettes` | regenerate committed font subsets / palette data |
| `pnpm run sheet -- --changed` | contact sheets of what this branch changed |

`check` builds first on purpose: `build/catalog.js` is generated and gitignored, so tests
that import it fail on a clean checkout otherwise.

## Working as one of several parallel agents

```
ROOT=/Users/tomasz/Workshop/github.com/tomasz/luzid.co
WT=$ROOT/.claude/worktrees/<wp>     the orchestrator creates this; you work only inside it
RESEARCH=$ROOT/.research            absolute path — it is gitignored and NOT in your worktree
PORT=$((8800 + <wp number>))        export it; never use 8787 while others are running
```

1. `cd $WT && mise exec node@24 pnpm@12.4.2 -- pnpm install --frozen-lockfile`
2. `ssh-add -l` must list a key. If it does not, **stop and report** — never disable signing.
3. Read your work package row in `$RESEARCH/PLAN.md` and the reports it names under "Read first".
4. Work only inside your work package's Paths. Touching anything else fails the path guard.
5. `pnpm run check`, plus your package's e2e command.
6. Review your own contact sheets (read the PNGs in `$WT/sheets/`) and put the verdict in the PR body.
7. `git commit` (signed; `git log -1 --format=%G?` must print `G`), then
   `git push origin HEAD` (never `-u`), then `gh pr create --head <branch>`.

**Agents never merge.** The orchestrator merges in dependency order after the path guard
and the required `ci` check pass. The one exception is Dependabot: its minor and patch
updates auto-merge once `ci` is green; majors wait for the owner.

## Branch, commit and PR rules

- Scoped Commits: `<scope>: <description>`, lowercase imperative, no `feat:`/`fix:` types.
  Scopes: `worker effects presets fonts palettes scripts ci docs deps treewide`.
- **The PR title must equal the subject of the PR's first commit.** GitHub's squash default
  takes the commit message for single-commit PRs, which keeps the trailer intact.
- Commit trailer `Co-Authored-By: Claude <noreply@anthropic.com>`; PR bodies end with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- One PR per work package. Squash merge (the only method the `main` ruleset allows; it
  also requires signed commits). Never force-push, never `git push -u`.
- Never touch DNS, Cloudflare settings, secrets, or anything under `.github/` unless that
  is your work package.
- `.claude/settings.json` denies `wrangler deploy` outright, including `--dry-run`, because
  a glob cannot express the exception and an accidental production deploy is not undoable.
  Nothing is lost: `pnpm run e2e` starts `wrangler dev`, which bundles the Worker through
  the same esbuild pipeline, so a green e2e run already proves the Worker builds.

Owner-merged paths (a PR touching them gets the `needs-owner` label and waits):
`.github/**`, `wrangler.jsonc`, `package.json`, `pnpm-*.yaml`, `biome.json`,
`scripts/ruleset.json`, `.claude/**`, and `src/**` once WP-13 has merged.

## Hard rules

- No `style=""` attribute in generated HTML, ever. A CSP nonce covers `<style>` elements
  only, never style attributes, and the policy sends `style-src-attr 'none'`.
- No `Math.random`, `Math.pow` or `Math.log` in `src/`: picks must be identical in Node,
  workerd and the browser.
- Never add `index.html` to `public/` (it shadows the Worker on `/`), never set
  `not_found_handling` or `run_worker_first`, never enable Workers Cache.
- Fonts: real `Ł` and `ł` required; the Google `css2` API is never the source (it strips
  stylistic sets); every subset ships its licence file and a change notice.
- Cultural guards in effects and backgrounds: no red disc with rays, no `sayagata`, no
  imperial crests, no faux-Asian display faces.

## Definition of done

- `pnpm run check` is green, and so is the package's e2e run in all three engines.
- The response budget still holds (≤ 14,000 B brotli, asserted in `test/`).
- Contact sheets are attached as a CI artifact and you have written your own verdict on them.
- Nothing outside the work package's Paths changed.
- New data items carry their licence and provenance.
