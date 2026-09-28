#!/usr/bin/env bash
# Sets up the devcontainer's toolchain in a cloud agent sandbox that cannot run the
# devcontainer itself: Claude Code on the web (SessionStart hook in .claude/settings.json)
# and Codex cloud (its environment setup script). Cursor cloud agents build the
# devcontainer's Dockerfile directly and do not need this.
#
# Every version comes from package.json, so nothing here needs bumping:
#   vp    = devDependencies["vite-plus"]   (the global CLI, same version as the local one)
#   Node  = engines.node                   (vp env reads it)
#   pnpm  = engines.pnpm                   (via VP_PACKAGE_MANAGER / VP_PNPM_VERSION)
#
# Needs network access to raw.githubusercontent.com, registry.npmjs.org and nodejs.org.
# Idempotent: a second run reuses the installed vp, Node and pnpm.
set -euo pipefail
cd "$(dirname "$0")/.."

field() { sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" package.json | head -1; }
VP_VERSION="$(field vite-plus)"
PNPM_VERSION="$(field pnpm)"
export VP_PACKAGE_MANAGER="pnpm@${PNPM_VERSION}" VP_PNPM_VERSION="${PNPM_VERSION}"
export CI="${CI:-true}"
# The global CLI's own shell setup: puts vp and its node/pnpm shims on PATH.
VP_ENV="${XDG_CONFIG_HOME:-${HOME}/.config}/vite-plus/env"
load_vp() { if [ -f "${VP_ENV}" ]; then . "${VP_ENV}"; fi; }
load_vp

if [ "$(vp --version 2>/dev/null | sed -n 's/^vp v//p' | head -1)" != "${VP_VERSION}" ]; then
  # The installer from the release tag; it fetches the vp binary from npm and checks its
  # provenance before running it.
  curl -fsSL "https://raw.githubusercontent.com/voidzero-dev/vite-plus/v${VP_VERSION}/packages/cli/install.sh" |
    VP_VERSION="${VP_VERSION}" bash
  load_vp
fi

vp env install
vp install --frozen-lockfile

# Later commands in a Claude Code session see the same toolchain.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo ". \"${VP_ENV}\""
    echo "export VP_PACKAGE_MANAGER=\"${VP_PACKAGE_MANAGER}\" VP_PNPM_VERSION=\"${VP_PNPM_VERSION}\""
  } >> "${CLAUDE_ENV_FILE}"
fi
