# luzid.co

One name, endless looks.

A single page showing **Tomasz Cudziło** as large as the screen allows, linking to
[github.com/tomasz](https://github.com/tomasz). Every visit re-randomizes the colour
combination (from Japanese colour dictionaries), the display font, its OpenType
variant, the CSS text effect and the layout.

One Cloudflare Worker renders the whole page — CSS and the subsetted font inlined —
in a single response under 14 KB. No framework, no runtime dependencies, no client
JavaScript required.

## Contributing

Read [`AGENTS.md`](AGENTS.md) first (rules, layout, who merges what), then
[`docs/contracts.md`](docs/contracts.md), which wins over everything else. The fit and bleed
proofs are explained in [`docs/fit.md`](docs/fit.md), the accessibility policy in
[`docs/a11y.md`](docs/a11y.md).

### Start the container

Everything runs inside the devcontainer; the host needs only a container runtime. On a Mac:

```
brew install colima docker docker-buildx devcontainer
colima start --ssh-agent --cpu 4 --memory 8
devcontainer up --workspace-folder .
devcontainer exec --workspace-folder . bash
```

The first `up` installs dependencies and Playwright's browsers. Every command below runs in
that shell, from the repository root. Set your git name and email once per clone
(`git config --local user.name …`, `user.email …`); commits are signed with the first key
your forwarded ssh-agent lists.

### Check, run, build

```
pnpm run check      # format, lint, type check, unit tests: the gate for every PR
vp dev              # the Worker in workerd at http://localhost:5173, reloading on data changes
vp build            # the Worker to dist/, which is what deploys
pnpm run e2e        # Playwright in Chromium, Firefox and WebKit against vp build + vp preview
```

Any part of a look can be pinned in the URL to see one thing on purpose:
`http://localhost:5173/?seed=q1&e=depth-drop&f=fraunces&p=qa-bw`. The pin keys are
`f v p r e l` (font, variant, palette, role set, effect, layout), the plain ids of §5.3.

`pnpm run e2e` takes about 8 minutes at its default scope. Run one engine with
`pnpm exec playwright test --project=chromium`, or one spec with
`pnpm exec playwright test e2e/bleed.spec.js`. `FIT_SCOPE=all pnpm run e2e` widens the fit
sweep to every font and variant (much longer; CI runs it weekly). When several agents share
one container, wrap every Playwright run in `flock /tmp/e2e.lock …` so they queue.

### Add an effect

1. Copy a close relative in `effects/` to `effects/<family>-<slug>.js`; the file name is the
   id. The shape, the keys and their order, the helpers in `h` and what is forbidden are in
   §5.6 of the contracts. `bleed()` must bound every pixel the effect paints, hover included.
2. `pnpm run check`. The catalog build and the effect lint reject a malformed effect with
   `file: /pointer: message`. The first local run writes the effect's grid hash to
   `test/golden/effects/<id>.sha256`; commit it (CI fails on a missing one).
3. Look at it: `vp dev` and pin it with `?e=<id>`.
4. `pnpm exec playwright test e2e/bleed.spec.js` proves the bleed in pixels, at every
   parameter corner of an effect this branch changed.
5. `pnpm run sheet -- --changed`, then read the PNGs in `sheets/` and check them against the
   cultural guards in `AGENTS.md`. Your verdict goes in the PR body.

### Regenerate one font

Each font is one hand-written row, `fonts/sources/<id>.json` (schema in §5.5). The pipeline
writes everything else under `fonts/`: `meta/<id>.json`, `files/<id>.<stop>.woff2` and
`licenses/<id>.txt`.

```
pnpm run fonts -- --id pacifico           # rebuild one font (repeatable, or comma-separated)
pnpm run fonts -- --id pacifico --check   # rebuild in memory and compare with disk
pnpm run fonts -- --seed                  # the eight rows marked "seed": true
```

A new row's `sha256` may start empty; the first run fills it in, and the row is committed
with it. A change to `archetype`, `traits` or `odds` is a row edit alone: it needs no
rebuild, because the catalog build joins the row in. Then `pnpm run check`, the e2e fit
sweep (a changed meta widens it to that font automatically), and
`pnpm run sheet -- --changed --kind fonts`.

### Regenerate palettes

```
pnpm run palettes             # rewrite data/palettes/ from the adapters in scripts/palettes/sources/
pnpm run palettes -- --check  # write nothing; fail if a file on disk is stale
```

### Pull requests

One task per PR, a scoped subject (`effects: add the depth-drop shade`), signed commits,
squash merge. The PR template lists the proof to paste. Paths the owner merges, and the
labels `contract` and `needs-owner`, are in `AGENTS.md`. Only the owner deploys: a push to
`main` runs `.github/workflows/cd.yml`, which ships the Worker once deploys are enabled and
rolls it back if the post-deploy smoke test finds a Worker-level failure.
