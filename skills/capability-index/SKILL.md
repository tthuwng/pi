---
name: capability-index
description: Route tasks to this Pi config's installed capabilities: subagents, dynamic workflows, LSP/ast-grep, context-mode, web/browser, memory, todos, guardrails, GitHub, and Sentry.
---

# Capability Index

Use this as a routing map for capabilities already installed in this Pi config. Verify availability when a tool/package may be host-specific.

## Routing Table

| Task shape | Prefer | Notes |
|---|---|---|
| Multi-step implementation | `manager-workflow`, `writing-plans`, `pi-subagents` | Tier 2+ needs approval before edits. |
| Independent code reconnaissance | `scout` subagent, tree-sitter, LSP | Scouts are read-only. |
| Review or quality gate | `review` skill, reviewer subagents | Parent synthesizes final verdict. |
| Code navigation | `tree_sitter_*`, `lsp_navigation`, `lsp_diagnostics` | Use structural tools before grep for code. |
| Structural refactor | `ast_grep_search`, `ast_grep_replace`, `semantic-git` | Dry-run replacements before apply. |
| Large logs/output/data | `context-mode` tools | Use `ctx_execute`/`ctx_execute_file` to summarize without flooding context. |
| Library/API docs | `context7`, `code_search`, `web_search` | Sanitize queries; do not leak proprietary data. |
| Browser testing | `browser-use` skill | Use for real web interaction and screenshots. |
| GitHub PR/issues/CI | `github` skill and `gh` CLI | Read-only by default; mutations require exact user request. |
| Sentry issues/events | `sentry-cli` skills | Use only when user asks for Sentry work. |
| Memory/runbooks | `memory-runbook`, `memory_search`, `memory_write` | Store durable reusable knowledge only. |
| Task tracking | `todo` tool and `/todos` | Claim before working; close when complete. |
| Continuation/compaction | `/continue`, `semantic-compression`, slipstream compact | Preserve decisions, evidence, risks. |
| Safety/path gates | guardrails package and `extensions/guardrails.json` | Do not bypass approval gates. |

## Installed Package Anchors

Local package resources are declared in:

- `package.json` → local extensions, skills, themes.
- `settings.json` → Pi packages such as `pi-subagents`, `pi-lens`, `pi-web-access`, `pi-memory-md`, `context-mode`, `pi-intercom`, and guardrail/toolchain packages.
- `mcp.json` → MCP servers for `context7`, `tree-sitter`, and `context-mode`.

## Use Rules

- Use the least-powerful tool that gives fresh evidence.
- Prefer read-only tools before mutating tools.
- For broad or risky work, plan first and use one writer at a time.
- Do not advertise private integrations as available unless configured and explicitly requested.
- If a tool fails due to host setup, report the failing command/tool and switch to a safe alternate path.
