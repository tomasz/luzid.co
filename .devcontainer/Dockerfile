# Vite+'s official toolchain image: Debian bookworm, the global `vp` CLI, git, ssh and a
# non-root `vp` user with passwordless sudo. It ships no Node on purpose: `vp env` installs
# the version `engines.node` declares. A Dockerfile rather than an `image` field so that
# Dependabot's docker ecosystem can bump the digest.
FROM ghcr.io/voidzero-dev/vite-plus:1.0.0@sha256:8d788678fb9783ba8994c4fe5652af3316bfc414f7ef6ead0136932ee6075b8b

# Agent CLIs from each vendor's official installer, into ~/.local/bin. Not pinned: they do
# not touch build output, and old versions get cut off server-side. Rebuild to update.
# The ~/.agents subdirectories are created here because a named volume mounted over
# ~/.agents (devcontainer.json) starts as a copy of them, owned by `vp`; Codex refuses to
# start when CODEX_HOME does not exist.
RUN curl -fsSL https://claude.ai/install.sh | bash \
 && curl -fsSL https://chatgpt.com/codex/install.sh | sh \
 && curl -fsSL https://cursor.com/install | bash \
 && mkdir -p "$HOME/.agents/claude" "$HOME/.agents/codex" "$HOME/.agents/cursor" "$HOME/.agents/gh"
ENV PATH="/home/vp/.local/bin:${PATH}"

# Git signs every commit with the key the forwarded ssh-agent holds, so neither a key nor
# the host's git config enters the container. Name and email are repo-scoped, in the
# workspace's .git/config (AGENTS.md); useConfigOnly stops git guessing vp@<container>
# when they are missing. allowed_signers, which `%G?` needs to print G, is written from
# the agent on every start (postStartCommand in devcontainer.json).
RUN sudo git config --system gpg.format ssh \
 && sudo git config --system gpg.ssh.defaultKeyCommand "ssh-add -L" \
 && sudo git config --system gpg.ssh.allowedSignersFile "~/.config/git/allowed_signers" \
 && sudo git config --system commit.gpgSign true \
 && sudo git config --system tag.gpgSign true \
 && sudo git config --system user.useConfigOnly true

# The container trusts no SSH host on its own, so `git push` over SSH fails with "Host key
# verification failed". GitHub's published keys go in the system-wide file, which leaves
# ~/.ssh free and is read by every user. When GitHub rotates a key, update known_hosts.
COPY known_hosts /etc/ssh/ssh_known_hosts
