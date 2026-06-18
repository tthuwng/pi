#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

need_command() {
	command -v "$1" >/dev/null
	printf 'ok: %s\n' "$1"
}

check_json() {
	node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$1"
	printf 'ok: %s\n' "$1"
}

for cmd in pi node npm bun uv uvx context7-mcp ast-grep just shellcheck tmux vim; do
	need_command "$cmd"
done

node -e 'require("assert")(Number(process.versions.node.split(".")[0]) >= 22)'
printf 'ok: node >= 22\n'

for file in package.json package-lock.json settings.json mcp.json models.json permissions.json keybindings.json; do
	check_json "$file"
done

for path in \
	packages/pi-subagents \
	packages/pi-memory-md \
	packages/pi-goal-supervisor \
	packages/pi-codex-retry
do
	[[ -d "$path" ]]
	printf 'ok: %s\n' "$path"
done

for module in gray-matter typebox @sinclair/typebox; do
	node -e 'require.resolve(process.argv[1], { paths: [process.cwd()] })' "$module"
	printf 'ok: %s\n' "$module"
done

for file in \
	node_modules/@mariozechner/pi-ai/dist/index.js \
	node_modules/@mariozechner/pi-coding-agent/dist/index.js \
	node_modules/@mariozechner/pi-tui/dist/index.js \
	node_modules/@aliou/pi-guardrails/src/index.ts \
	node_modules/@aliou/pi-toolchain/src/index.ts
do
	[[ -f "$file" ]]
	printf 'ok: %s\n' "$file"
done

[[ -L "$HOME/.pi/agent" ]]
[[ "$(readlink "$HOME/.pi/agent")" == "$root" ]]
printf 'ok: %s -> %s\n' "$HOME/.pi/agent" "$root"

pi --version
context7-mcp --version
ast-grep --version
just --version
