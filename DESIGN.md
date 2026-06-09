# Design Decisions

This document explains why the config is shaped this way. It is not the agent policy source; use `AGENTS.md` for that.

## Goals

- Keep always-loaded instructions concise
- Keep agent behavior stronger than human docs
- Put workflow detail in skills, not root prompt prose
- Make risky operations explicit and hard to trigger accidentally
- Keep large research/plans/reviews in files
- Give subagents narrow, self-contained contracts

## Authority split

| Surface                      | Role                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                  | Always-loaded parent-session policy: safety, tool routing, workflow triggers, memory rules                      |
| `APPEND_SYSTEM.md`           | Local machine, stack, commands, language conventions where possible                                             |
| `skills/`                    | On-demand workflow manuals                                                                                      |
| `agents/`                    | Local subagent role contracts; same-name files override packaged builtins and may not inherit all parent policy |
| `settings.json` / `mcp.json` | Runtime config registries for packages, models, UI, compaction, and MCP servers                                 |
| `extensions/`                | Auto-discovered local runtime behavior: commands, UI helpers, todos, and guardrails                             |
| `README.md`                  | Repository map and setup                                                                                        |
| `USAGE.md`                   | Human quick-start guide                                                                                         |

## Core choices

### Structural tools first

Code navigation should start from symbols and AST structure. Text search remains useful for logs, comments, config text, URLs, and fallback cases.

### Read-only git by default

The agent can inspect git state but does not mutate staging, history, refs, or branch state. The user remains responsible for commits, branches, merges, rebases, pushes, and stacked-PR operations.

### Guardrails plus prompt policy

Prompt rules are not enough for high-risk operations. `extensions/guardrails.json` blocks destructive shell patterns, git mutations, and configured auth/token paths, while `AGENTS.md` states the operating policy. Guardrails are not a full sandbox; with `permissions.json` in `yolo`, external/private MCP approval gates are prompt policy rather than runtime-enforced confirmations.

### Skills over prompt bloat

Detailed procedures live in skills so the base prompt stays smaller:

- `manager-workflow`: tiering and implementation flow
- `brainstorming`: vague/design work
- `writing-plans`: approved multi-step plans
- `systematic-debugging`: root-cause workflow
- `test-driven-development`: behavior-change testing discipline
- `review`: review standards
- `verification-before-completion`: final evidence gate
- `pi-subagents`: parallel/adversarial workflows

### Subagent prompts stay self-contained

Scout/worker/reviewer prompts intentionally repeat some safety and workflow rules because child agents may use replacement prompts and may not inherit root instructions.

### Scratch files for intermediate work

`.scratch/` is gitignored and holds research, plans, reviews, compaction artifacts, and continuation notes. This keeps large intermediate artifacts inspectable without flooding the conversation.

### Lazy integrations by default

MCP servers and heavier workflows load on demand unless they need direct-tool availability. Tree-sitter stays direct because code navigation is core behavior.

## Package selection rationale

The complete enabled-package inventory belongs in `settings.json` and is summarized in `README.md`. The design categories are:

- **Delegation:** subagents, review gates, research/decision workflows
- **Memory:** durable markdown memory delivered into prompt context
- **Code intelligence:** AST-aware search/refactoring and direct tree-sitter tools
- **Large-output handling:** context-mode indexing/analysis outside the main prompt
- **Research:** web/content access and library-doc lookup
- **Safety/tooling:** guardrails plus preferred CLI enforcement
- **Interaction:** structured user questions, inter-session coordination, session helpers
- **Resilience:** compaction, goal continuation, and recoverable transport retries

## Local-only assumptions

This is a personal config, not a turnkey distribution. Before reuse, review every authority surface, not only `AGENTS.md`:

- `APPEND_SYSTEM.md` for OS/editor/package-manager/cloud details
- `settings.json` for model, packages, memory, compaction, and paths
- `mcp.json` for MCP commands and OAuth dependencies
- `extensions/` for auto-discovered local runtime behavior and commands
- `permissions.json` for permission mode
- `extensions/guardrails.json` for command and secret-path policy

## Public repo hygiene

Tracked files should exclude credentials, sessions, caches, logs, generated artifacts, and dependency installs. See `.gitignore` and `README.md` for the current exclusion list.

## Attribution

Copied or closely adapted files are documented in `ATTRIBUTIONS.md` with source repositories and licenses.
