#!/usr/bin/env bash
# Worktree setup hook for pi-subagents
# Runs after a git worktree is created for a parallel subagent
# Installs dependencies so the worktree is ready to work

set -euo pipefail

warn() {
	printf 'worktree-setup: %s\n' "$*" >&2
}

# Python: uv sync from lockfile (fast, ~2s)
if [[ -f "uv.lock" ]]; then
	if ! uv sync --frozen --quiet; then
		warn "uv sync failed; continuing so the subagent can inspect/fix the worktree"
	fi
fi

# Node: pnpm install from lockfile (fast with store)
if [[ -f "pnpm-lock.yaml" ]]; then
	if ! pnpm install --frozen-lockfile --silent; then
		warn "pnpm install failed; continuing so the subagent can inspect/fix the worktree"
	fi
fi
