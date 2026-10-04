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
- **Git identity is repo-scoped.** No host git config enters the container. The image
  signs every commit with the first key `ssh-add -L` lists, so that must be your signing
  key, and writes the matching `allowed_signers` on start so `%G?` prints `G`. Name and
  email live in this clone's `.git/config`, which the workspace mount shares with the
  host; set them once per clone, on the host or inside:
  `git config --local user.name "…"` and `git config --local user.email "…"`. Without
  them git refuses to commit.
- **Resources:** Playwright and workerd share the VM, hence 4 CPUs and 8 GB.

The image is Vite+'s official toolchain image, pinned by digest.
- **Node:** `vp env` installs whichever version `engines.node` in `package.json`
  declares. That field is the one place the Node version lives: no `.nvmrc`, no
  `.node-version`.
- **pnpm:** `vp` installs `pnpm@12.8.1` from `devEngines.packageManager` in
  `package.json`, inside the container or out.
- **Commands:** inside the container, plain `pnpm` and `vp` are the right commands. CI sets
  up the same `vp` with `voidzero-dev/setup-vp`, which reads the same
  `devEngines.packageManager`; the workflows pin no pnpm version of their own.

There is deliberately **no `packageManager` field** in `package.json`. Given one, pnpm 12
self-installs that version and appends a second document to `pnpm-lock.yaml`; GitHub's
dependency graph reads only one document and can then report the repo as having no
dependencies, which silently disables Dependabot alerts. `devEngines.packageManager` does
the same unless its `onFail` is `"ignore"`, so it carries that. That field is the one pnpm
declaration (no `engines.pnpm`, no `VP_PNPM_VERSION` in the workflows), and
`test/repo.test.js` fails if this file stops quoting its version. Node
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

### Agents in the devcontainer

The image carries Claude Code, Codex and Cursor's CLI, each from its vendor's installer.
Each reads this file natively; Claude Code reads it through `CLAUDE.md`.

```
devcontainer exec --workspace-folder . claude
devcontainer exec --workspace-folder . codex --sandbox danger-full-access
devcontainer exec --workspace-folder . cursor-agent
```

Cursor's installer now exposes its binary as both `cursor-agent` and `agent`; either works.

- **Logins persist:** each CLI's login and settings, and `gh`'s, live in the `luzid-agents`
  volume through `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `CURSOR_CONFIG_DIR` and
  `GH_CONFIG_DIR`, so they survive rebuilds. `docker volume rm luzid-agents` logs all out.
- **Codex login:** `codex login --device-auth`. Its default localhost callback is not
  forwarded by the devcontainer CLI.
- **gh login**, once per volume, before any agent opens a PR:
  `gh auth login --hostname github.com --git-protocol ssh --skip-ssh-key`, then paste a
  fine-grained token. Repository access: only `tomasz/luzid.co`. Read and write:
  Contents, Pull requests, Issues, Actions. Read: Variables. Never Administration or
  Secrets: rulesets and deploy credentials stay the owner's. `gh auth status` confirms it.
- **The container is the boundary.** Codex's and Claude Code's own sandboxes need user
  namespaces, which an unprivileged container does not grant, hence Codex's
  `--sandbox danger-full-access`. Never add capabilities, `--privileged` or unconfined
  seccomp/AppArmor to make a nested sandbox start.
- **What an agent can reach:** the workspace, the forwarded ssh-agent and `gh`'s token.
  No Cloudflare token or `wrangler login` state ever enters the container, so no agent can
  deploy.
- **No egress firewall**, on purpose: an iptables allowlist does not stop exfiltration
  through DNS or an allowed host, and it needs extra capabilities. Keep secrets out instead.
- **Updating the CLIs:** they are unpinned, and the build fails if any installer does.
  To refresh them, `docker build --no-cache .devcontainer`, then
  `devcontainer up --workspace-folder . --remove-existing-container`.

## Commands

| Command | What |
|---|---|
| `pnpm run check` | `vp check` (Oxfmt, Oxlint), then `vp test` (Vitest). The gate for every PR. |
| `vp dev` | the Worker in workerd on 5173, reloading on data changes |
| `vp build` | the Worker to `dist/`, which `wrangler deploy` ships |
| `vp test` | Vitest alone, without the format and lint pass |
| `pnpm run e2e` | Playwright in Chromium, Firefox and WebKit against `vp build` + `vp preview` |
| `FIT_SCOPE=all pnpm run e2e` | the same, across every font and variant (`docs/fit.md`) |
| `pnpm run fonts` / `palettes` | regenerate committed font subsets / palette data |
| `pnpm run sheet -- --changed` | contact sheets of what this branch changed |

`build/catalog.js` is generated and gitignored. The `catalog` plugin in `vite.config.js`
writes it whenever the config loads — before `vp dev`, `vp build`, `vp preview` and
`vp test` — so no command has to build it first. Golden snapshots refresh with
`vp test -u`.

### Layout

`src/` holds the engine, `effects/` one file per effect, `fonts/` and `data/` the generated
and curated data, `scripts/` the generators and tools, `test/` the unit suite, `e2e/` the
browser suite, `docs/` the contracts. The refactor plan's final layout (its §6: `src/`
split into `look`, `layout`, `pick`, `fit`, `render` and `helpers`; `scripts/fonts/` and
`scripts/palettes/` modules, `.mjs` renamed `.js`) is a **target** until its row Z1 lands:
a new module takes its final name from the start, and Z1 moves the rest in one PR.

## Working as one of several parallel agents

```
ROOT=/workspaces/luzid.co           inside the devcontainer
WT=$ROOT/.claude/worktrees/<wp>     the orchestrator creates this; you work only inside it
PLANS=$ROOT/.plans                  absolute path — it is gitignored and NOT in your worktree
PORT=$((8800 + <wp number>))        export it; never use 8787 while others are running
```

1. `cd $WT && pnpm install --frozen-lockfile`
2. `ssh-add -l` must list a key. If it does not, **stop and report** — never disable signing.
3. Read your PR row in `$PLANS/2026-10-02-consolidated-plan.md` and the reports it cites
   under `$PLANS/reports/`.
4. Work only inside your PR row's Paths.
5. `pnpm run check`, plus your package's e2e command.
6. Review your own contact sheets (read the PNGs in `$WT/sheets/`) and put the verdict in the PR body.
7. `git commit` (signed; `git log -1 --format=%G?` must print `G`), then
   `git push origin HEAD` (never `-u`), then `gh pr create --head <branch>`.

**Agents never merge.** The orchestrator merges in dependency order after the required
`ci` check passes. Dependabot's weekly grouped PR is merged by the owner like any other.

## Branch, commit and PR rules

- Scoped Commits: `<scope>: <description>`, lowercase imperative, no `feat:`/`fix:` types.
  Scopes: `worker effects presets fonts palettes scripts ci docs deps treewide test e2e`.
- **The PR title must equal the subject of the PR's first commit.** GitHub's squash default
  takes the commit message for single-commit PRs, which keeps the trailer intact.
- Commit trailer `Co-Authored-By: Claude <noreply@anthropic.com>`; PR bodies end with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- One PR per work package. Squash merge (the only method the `main` ruleset allows; it
  also requires signed commits). Never force-push, never `git push -u`.
- Never touch DNS, Cloudflare settings, secrets, or anything under `.github/` unless that
  is your work package.

Owner-merged paths (a PR touching them gets the `needs-owner` label and waits):
`.github/**` (including `.github/ruleset.json`), `wrangler.jsonc`, `package.json`,
`pnpm-*.yaml`, `vite.config.js`, `.claude/**`, `.devcontainer/**`, and `src/**` once WP-13
has merged.

`.github/ruleset.json` records the live `main` ruleset. The owner applies it after a merge
that changes it: `gh api -X PUT repos/tomasz/luzid.co/rulesets/23998451 --input .github/ruleset.json`.

## Hard rules

- No `style=""` attribute in generated HTML, ever. A CSP nonce covers `<style>` elements
  only, never style attributes, and the policy sends `style-src-attr 'none'`.
- No `Math.random`, `Math.pow` or `Math.log` in `src/`: picks must be identical in Node,
  workerd and the browser.
- Never add `index.html` to `public/` (it shadows the Worker on `/`), never set
  `not_found_handling` or `run_worker_first`, never enable Workers Cache.
- Fonts: real `Ł` and `ł` required; the Google `css2` API is never the source (it strips
  stylistic sets); every subset ships its licence file and a change notice.
- Cultural guards in effects and backgrounds. Check every new effect, font and palette
  against each item on its contact sheets; "lint" marks what a test already enforces.
  - [ ] no red disc with rays (the rising-sun motif)
  - [ ] no `sayagata` (the interlocking-swastika fret)
  - [ ] no imperial crests (e.g. the chrysanthemum seal)
  - [ ] no faux-Asian display faces ("chop suey" lettering) — checked on font rows; an
    effect cannot bring its own face (lint: `font-family` is off the property allowlist, and
    `url()` other than `data:` is rejected)

## Definition of done

- `pnpm run check` is green, and so is the package's e2e run in all three engines.
- The response budget still holds (≤ 14,000 B brotli, asserted in `test/`).
- Contact sheets are attached as a CI artifact and you have written your own verdict on them.
- Nothing outside the work package's Paths changed.
- New data items carry their licence and provenance.
