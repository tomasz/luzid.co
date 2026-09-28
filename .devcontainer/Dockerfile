# Vite+'s official toolchain image: Debian bookworm, the global `vp` CLI, git, ssh and a
# non-root `vp` user with passwordless sudo. It ships no Node on purpose: `vp env` installs
# the version `engines.node` declares. A Dockerfile rather than an `image` field so that
# Dependabot's docker ecosystem can bump the digest. Cursor cloud agents build this same
# file (.cursor/environment.json).
FROM ghcr.io/voidzero-dev/vite-plus:1.0.0@sha256:8d788678fb9783ba8994c4fe5652af3316bfc414f7ef6ead0136932ee6075b8b

# pnpm is pinned here, not with package.json's packageManager field: see test/repo.test.js.
# `vp install` reads the first, the pnpm shim the second.
ENV VP_PACKAGE_MANAGER=pnpm@12.7.0 \
    VP_PNPM_VERSION=12.7.0

# Agent CLIs from each vendor's official installer, into ~/.local/bin. Not pinned: they do
# not touch build output, and old versions get cut off server-side. Rebuild to update.
# ~/.agents is created here so the named volume mounted over it (devcontainer.json)
# inherits the vp user's ownership.
RUN curl -fsSL https://claude.ai/install.sh | bash \
 && curl -fsSL https://cursor.com/install | bash \
 && curl -fsSL https://chatgpt.com/codex/install.sh | sh \
 && mkdir -p "$HOME/.agents"
