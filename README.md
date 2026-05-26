# Pi Config v2

Personal pi coding agent configuration.

## Architecture

```
pi/
├── AGENTS.md                  # Core agent behavior
├── APPEND_SYSTEM.md           # Machine- and workflow-specific details
├── settings.json              # Provider, model, packages, compaction
├── models.json                # Custom model definitions
├── mcp.json                   # MCP servers
├── permissions.json           # Permission mode
├── keybindings.json           # Terminal keybindings
├── setup.sh                   # Symlinks config to ~/.pi/agent
├── worktree-setup.sh          # Git worktree isolation setup
│
├── agents/                    # Subagent role definitions
│   ├── scout.md               # Read-only recon
│   ├── worker.md              # Implementation
│   ├── reviewer.md            # Code review
│   └── general-purpose.md     # Default subagent override
│
├── skills/                    # On-demand workflows
│   ├── manager-workflow/      # Tiered implementation workflow
│   ├── commit/                # Commit-message guidance
│   ├── systematic-debugging/  # Debugging workflow
│   ├── frontend/              # React/TypeScript conventions
│   ├── semantic-git/          # Structural git analysis
│   ├── github/                # GitHub CLI workflow
│   ├── learn-codebase/        # First-session project orientation
│   ├── iterate-pr/            # PR iteration workflow
│   ├── review/                # Code review standards
│   ├── self-improve/          # Config retrospective workflow
│   └── session-reader/        # Session JSONL inspection
│
├── extensions/
│   ├── claude-ui/             # Custom terminal UI
│   ├── todos/                 # File-based todo management
│   ├── guardrails.json        # Blocks destructive commands and git mutations
│   ├── answer.ts              # /answer question-answering TUI
│   ├── files.ts               # /files and /diff file browser
│   ├── continue.ts            # /continue session handoff
│   └── compact-advisor.ts     # Context notice and auto-continue shim
│
├── themes/
│   └── gruvbox-custom.json    # Gruvbox dark theme
│
├── mcp-servers/
│   └── tree-sitter/           # Local tree-sitter MCP server
│
└── .gitignore                 # Excludes auth, sessions, caches, logs, node_modules
```

## How It Works

### Workflow tiers

| Tier              | When                              | What happens                                                    |
| ----------------- | --------------------------------- | --------------------------------------------------------------- |
| 1 — Just do it    | Single-file, small, clear changes | Main agent edits directly                                       |
| 2 — Talk first    | Multi-file or ambiguous changes   | Agent discusses approach before editing                         |
| 3 — Write it down | Architectural or broad changes    | Agent writes a plan in `.scratch/plans/` and waits for approval |

### Agent roles

| Role     | Model        | Purpose                                               |
| -------- | ------------ | ----------------------------------------------------- |
| main     | gpt-5.5      | Planning, coordination, user interaction, small edits |
| scout    | gpt-5.4-mini | Fast read-only reconnaissance                         |
| worker   | gpt-5.4      | Implementation from specific instructions             |
| reviewer | gpt-5.4      | Review against plan and coding standards              |

### Tool priority

1. **Tree-sitter** for symbol-aware code navigation.
2. **context7** for library and framework documentation.
3. **Preferred CLIs** such as `uv`, `pnpm`, `difft`, `fd`, `bat`, `sd`, `ast-grep`, `shellcheck`, `gh`, and `aws`.
4. **Grep/Glob/Read** when structural tools do not apply.

### Git policy

The agent can inspect git state with `git log`, `git diff`, `git status`, `git blame`, and `git show`.

Git mutations are intentionally blocked by guardrails. Staging, committing, pushing, rebasing, resetting, and branch operations are manual.

### Scratch workspace

```
.scratch/           (gitignored, per-project)
├── research/       scout findings
├── plans/          change plans with assumptions
├── reviews/        reviewer output
└── sessions/       continuation notes
```

## Packages

| Package                | Purpose                                          |
| ---------------------- | ------------------------------------------------ |
| `extensions/claude-ui` | Local terminal UI customization                  |
| `pi-subagents`         | Scout/worker/reviewer delegation                 |
| `pi-mcp-adapter`       | Lazy MCP loading                                 |
| `pi-lens`              | AST-aware code tooling                           |
| `pi-web-access`        | Web search and content extraction                |
| `pi-memory-md`         | Git-backed markdown memory                       |
| `@aliou/pi-guardrails` | Command and path safety policies                 |
| `@aliou/pi-toolchain`  | Preferred CLI enforcement                        |
| `pi-rewind`            | Per-turn recovery checkpoints                    |
| `pi-ask-user`          | Structured user decision UI                      |
| `context-mode`         | Large-output processing outside the main context |

## MCP Servers

| Server       | Mode                     | Purpose                                                           |
| ------------ | ------------------------ | ----------------------------------------------------------------- |
| tree-sitter  | Direct tools, keep-alive | Code symbols, definitions, patterns, and maps                     |
| context7     | Lazy                     | Library/framework documentation lookup                            |
| nvim         | Lazy                     | Neovim buffers, cursor, selections, and diagnostics               |
| context-mode | Lazy                     | Large-output analysis and indexing                                |
| notion       | Lazy remote OAuth        | Notion workspace access via official remote MCP                   |
| google_docs  | Lazy local OAuth         | Google Docs/Drive read/write via local `@a-bonus/google-docs-mcp` |

`google_docs` is sensitive. `AGENTS.md` requires explicit user approval before any `google_docs_*` tool call other than schema inspection, and per-action approval for every mutation or destructive operation.

## Setup

Prerequisites:

- pi coding agent
- Node.js/npm for npm-hosted packages and the local tree-sitter MCP server
- uv/uvx for the nvim MCP server
- context7-mcp on PATH for library documentation lookup

```bash
cd ~/.config/pi
chmod +x setup.sh
./setup.sh
```

Tracked config uses relative paths where possible. `setup.sh` links this repository to `~/.pi/agent`, so relative local package and MCP paths resolve from the Pi agent directory.

## Publishing Safety

This repository intentionally excludes local runtime and secret-bearing files:

- `auth.json`
- `sessions/`
- `run-history.jsonl`
- `mcp-cache.json`
- `mcp-onboarding.json`
- `pi-crash.log`
- `**/node_modules`
- `.scratch/`

Review these intentional personal choices before reusing this config:

- `APPEND_SYSTEM.md` assumes Arch Linux on Wayland/sway with Foot, Neovim, `pacman`/`yay`, `wl-copy`, `uv`, `pnpm`, local PostgreSQL, `git-spice`, and `aws-cli`.
- `settings.json` and `models.json` prefer the `openai-codex` provider, GPT-5.x model IDs, the custom `gruvbox-custom` theme, and high-thinking defaults.
- `permissions.json` uses `yolo` mode, which is a high-trust local permission posture.
- `AGENTS.md` and `skills/commit/SKILL.md` encode the `ok/` branch prefix and read-only git policy.

## Design Decisions

- **Tree-sitter first**: Code navigation should start from symbols and structure instead of raw text search.
- **Read-only git**: The agent can inspect repository state but does not mutate git history or staging state.
- **File-backed scratch space**: Research, plans, reviews, and continuation notes are written to `.scratch/` instead of being pushed directly into the conversation.
- **Role-based delegation**: Scout, worker, and reviewer agents have narrow responsibilities.
- **Skills over prompt bloat**: Specialized workflows live in skills and load only when needed.
- **Guardrails over prompts alone**: Destructive shell and git operations are blocked by configuration, not just instructions.
- **Lazy integrations**: MCP servers and heavier workflows are loaded on demand unless they need to be direct tools.

See `DESIGN.md` for more detail and `ATTRIBUTIONS.md` for upstream sources and copied/adapted files.
