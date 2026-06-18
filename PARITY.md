# Pi Parity Setup

This fork uses `OrestesK/pi` as the base config and keeps the added surface small.

## Installed Local Tools

| Tool | Purpose |
| --- | --- |
| `pi` | Pi coding-agent CLI |
| Node.js 22+ / `npm` | Pi package runtime and global package manager |
| `bun` | Pi extension/package runtime used by comparison examples |
| `just` | Small task runner for setup/check recipes |
| `uv` / `uvx` | Python tool runner for MCP helpers |
| `context7-mcp` | Library and framework docs MCP |
| `ast-grep` | Structural code search used by Pi Lens and tree-sitter workflows |
| `shellcheck` | Shell script verification |

## Codex-Style Parity

| Capability | Local Pi config |
| --- | --- |
| Always-loaded repo instructions | `AGENTS.md` |
| Progressive skills | `skills/` plus package skills |
| `/goal` continuity | `packages/pi-goal-supervisor` |
| Memory | `packages/pi-memory-md` |
| Web/code research | `npm:pi-web-access` |
| MCP routing | `mcp.json` plus `npm:pi-mcp-adapter` |
| Safer command/tool defaults | `extensions/guardrails.json`, `npm:@aliou/pi-guardrails`, `npm:@aliou/pi-toolchain` |
| Transport retry | `packages/pi-codex-retry` |

## Claude Code-Style Parity

| Capability | Local Pi config |
| --- | --- |
| Named agents | `agents/scout.md`, `agents/worker.md`, `agents/reviewer.md`, `agents/general-purpose.md` |
| Multi-agent workflows | `packages/pi-subagents` |
| Background child runs | `subagent` async runs from `packages/pi-subagents` |
| Parent control of child sessions | `subagent({ action: "status" })`, `interrupt`, and `resume` |
| Child-to-parent coordination | `npm:pi-intercom` bridge with `contact_supervisor` |
| Session browsing/resume | `packages/pisesh` |
| Claude-like terminal UI | `extensions/claude-ui` |
| Large-context support | `packages/context-mode` and `packages/pi-slipstream-compact` |

## Comparison Repo Boundary

`disler/pi-vs-claude-code` is useful as a feature map. This fork does not copy its large demo extensions by default. The same core needs are covered through maintained Pi packages:

- Team/chain orchestration: `pi-subagents`
- Parent-child session control: `pi-subagents` status, interrupt, and resume
- Agent communication: `pi-intercom`
- Session management: `pisesh`

Use `just doctor` after `just setup` to verify the local install.
