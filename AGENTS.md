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

All work happens inside the devcontainer (`.devcontainer/`). That covers Node, pnpm,
`vp`, Playwright's browsers and every agent. Nothing for this project is installed on the
host, which needs only a container runtime. On the owner's Mac that runtime is Colima,
never Docker Desktop:

```
brew install colima docker docker-buildx devcontainer
colima start --ssh-agent --cpu 4 --memory 8
devcontainer up --workspace-folder .
devcontainer exec --workspace-folder . bash
```

- **`--ssh-agent`** forwards the host agent to `/run/host-services/ssh-auth.sock`, which
  the container mounts for signed commits.
- **A stale agent:** if Colima restarts while the container is still running, the
  forwarded agent can go stale (`ssh-add -l` fails). Fix it with
  `colima stop && colima start --ssh-agent`, then rebuild the container.
- **Git identity:** the host `~/.gitconfig` and `~/.gitignore` are mounted read-only. In
  `~/.gitconfig`, `user.signingkey` must be the portable `key::ssh-ed25519 …` form and
  `core.excludesFile` must be `~/.gitignore`, not host file paths.
- **Resources:** Playwright and workerd share the VM, hence 4 CPUs and 8 GB.

The image is Vite+'s official toolchain image, pinned by digest.
- **Node:** `vp env` installs whichever version `engines.node` in `package.json`
  declares. That field is the one place the Node version lives: no `.nvmrc`, no
  `.node-version`.
- **pnpm:** `vp` installs `pnpm@12.4.2` from `devEngines.packageManager` in
  `package.json`, inside the container or out.
- **Commands:** inside the container, plain `pnpm` and `vp` are the right commands. CI sets
  up the same `vp` with `voidzero-dev/setup-vp`, pinning pnpm through `VP_PACKAGE_MANAGER`
  and `VP_PNPM_VERSION`.

There is deliberately **no `packageManager` field** in `package.json`. Given one, pnpm 12
self-installs that version and appends a second document to `pnpm-lock.yaml`; GitHub's
dependency graph reads only one document and can then report the repo as having no
dependencies, which silently disables Dependabot alerts. `devEngines.packageManager` does
the same unless its `onFail` is `"ignore"`, so it carries that. That field is the one pnpm
declaration (no `engines.pnpm`); `VP_PACKAGE_MANAGER` and `VP_PNPM_VERSION` in both
workflows must match it, and `test/repo.test.js` fails if they ever disagree. Node
built-ins are preferred over packages in scripts: `node:zlib`, `fs.glob`, `parseArgs`,
`fetch`. There are exactly six devDependencies (`vite-plus`, `@cloudflare/vite-plugin`,
`wrangler`, `@playwright/test`, `harfbuzzjs`, `subset-font`) and zero runtime dependencies.

Vite+ (`vp`) is the whole toolchain: Vite 8 with Rolldown builds the Worker, Vitest runs
the unit tests, Oxlint lints and Oxfmt formats, all with their defaults, configured in the
one `vite.config.js`. `vite-plus` pins its own Vite and Vitest through the two
`overrides` in `pnpm-workspace.yaml`; bump all three together, never one alone (the repo
test checks). **Only WP-00 may touch `package.json`, `pnpm-lock.yaml`,
`pnpm-workspace.yaml` or `vite.config.js`** — if your work package seems to need a new
dependency, stop and report instead.

## Commands

| Command | What |
|---|---|
| `pnpm run check` | `vp check` (Oxfmt, Oxlint), then `vp test` (Vitest). The gate for every PR. |
| `pnpm run dev` | `vp dev`: the Worker in workerd on 5173, reloading on data changes |
| `pnpm run build` | `vp build`: the Worker to `dist/`, which `wrangler deploy` ships |
| `pnpm run e2e` | Playwright in Chromium, Firefox and WebKit against `vp build` + `vp preview` |
| `pnpm run fonts` / `palettes` | regenerate committed font subsets / palette data |
| `pnpm run sheet -- --changed` | contact sheets of what this branch changed |

`build/catalog.js` is generated and gitignored. The `catalog` plugin in `vite.config.js`
writes it whenever the config loads — before `vp dev`, `vp build`, `vp preview` and
`vp test` — so no command has to build it first. Golden snapshots refresh with
`vp test -u`.

## Working as one of several parallel agents

```
ROOT=/workspaces/luzid.co           inside the devcontainer
WT=$ROOT/.claude/worktrees/<wp>     the orchestrator creates this; you work only inside it
RESEARCH=$ROOT/.research            absolute path — it is gitignored and NOT in your worktree
PORT=$((8800 + <wp number>))        export it; never use 8787 while others are running
```

1. `cd $WT && pnpm install --frozen-lockfile`
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

Owner-merged paths (a PR touching them gets the `needs-owner` label and waits):
`.github/**`, `wrangler.jsonc`, `package.json`, `pnpm-*.yaml`, `vite.config.js`,
`scripts/ruleset.json`, `.claude/**`, `.devcontainer/**`, and `src/**` once WP-13 has merged.

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
