# Pi Config v2

Personal Pi coding-agent configuration. Always-loaded policy starts in `AGENTS.md`; subagent role behavior is also defined in `agents/`. Runtime behavior comes from `settings.json`, `mcp.json`, enabled packages, and auto-discovered local `extensions/`. Host-specific facts are in `APPEND_SYSTEM.md` where possible.

The active workflow target is kitty + tmux + Vim. Neovim-specific integrations are not enabled by default.

This fork adds a small local parity note and doctor script:

- `PARITY.md`: Codex and Claude Code parity map
- `just setup`: link this checkout to `~/.pi/agent`
- `just doctor`: verify required tools, JSON config, local packages, and the symlink

## File map

```text
pi/
├── AGENTS.md                  # Always-loaded agent policy
├── APPEND_SYSTEM.md           # Host/toolchain overlay
├── settings.json              # Model, packages, UI, memory, compaction
├── models.json                # Custom model definitions
├── mcp.json                   # MCP server registry
├── permissions.json           # Permission mode
├── keybindings.json           # Terminal keybindings
│
├── agents/                    # Local subagent role prompts; override same-name packaged builtins
│   ├── scout.md               # Read-only recon
│   ├── worker.md              # Single-task implementation
│   ├── reviewer.md            # Review-only feedback
│   └── general-purpose.md     # Fallback role
│
├── skills/                    # On-demand workflows
├── extensions/                # Local commands, UI, todos, guardrails
├── themes/                    # TUI theme
├── mcp-servers/               # Local MCP implementations
└── .gitignore                 # Runtime/secrets/cache exclusions
```

## Runtime shape

- Main model: configured in `settings.json`
- Subagents: local role prompts in `agents/` plus packaged `pi-subagents` roles/prompts; local same-name agents override packaged builtins
- Skills: progressive disclosure; descriptions are discoverable, full instructions load on demand
- MCP: registered in `mcp.json`; most servers are lazy
- Memory: `pi-memory-md` delivers selected memory into the system prompt
- Extensions: local commands, UI helpers, todos, and guardrails are auto-discovered from `extensions/`
- Safety: prompt policy plus `extensions/guardrails.json` for configured destructive command patterns and protected paths; `permissions.json` is `yolo`, so sensitive-tool approvals are not runtime confirmations

## Enabled packages

`settings.json` is the source of truth. Current package entries:

| Entry                            | Purpose                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `extensions/claude-ui`           | Terminal UI customization                                                      |
| `packages/pi-subagents`          | Subagent orchestration, roles, prompt recipes                                  |
| `npm:pi-mcp-adapter`             | Lazy MCP loading                                                               |
| `npm:pi-lens`                    | AST-aware code tooling; ast-grep skill only                                    |
| `npm:pi-web-access`              | Web search and content extraction                                              |
| `packages/pi-memory-md`          | Git-backed markdown memory                                                     |
| `npm:@aliou/pi-guardrails`       | Command/path safety policies                                                   |
| `npm:@aliou/pi-toolchain`        | Preferred CLI enforcement                                                      |
| `npm:pi-ask-user`                | Structured user decision UI                                                    |
| `packages/context-mode`          | Large-output processing plus Pi extension hooks/commands; selected skills only |
| `npm:pi-intercom`                | Local session coordination                                                     |
| `packages/pi-codex-retry`        | Recoverable Codex transport retry                                              |
| `packages/pi-slipstream-compact` | Validated compaction replacement                                               |
| `packages/pi-goal-supervisor`    | `/goal` continuation supervisor                                                |
| `packages/pisesh`                | Local session management helper                                                |
| `npm:pi-btw`                     | `/btw` side conversations plus bundled `btw` skill                             |

## MCP servers

| Server         | Mode              | Purpose                                                                                                                         |
| -------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `tree-sitter`  | direct/keep-alive | Symbols, definitions, patterns, codebase maps                                                                                   |
| `context7`     | lazy              | Library/framework docs                                                                                                          |
| `context-mode` | lazy              | Large-output analysis/indexing                                                                                                  |
| `notion`       | lazy remote OAuth | Notion access; external/private MCP policy in `AGENTS.md`                                                                       |
| `google_docs`  | lazy local OAuth  | Sources `mcp-oauth/google_docs/env.sh`; runs `npx -y @a-bonus/google-docs-mcp@1.10.0`; covers Docs and Drive-capable operations |
| `slack`        | lazy local OAuth  | Sources `mcp-oauth/slack/env.sh`; runs `${PI_SLACK_MCP_SERVER_BIN:-$HOME/.local/bin/slack-mcp-server-patched}`                  |

OAuth env/token files are ignored and must not be committed. External/private MCP content access and mutations are governed by `AGENTS.md`; with `permissions.json` in `yolo`, those approvals are prompt policy rather than runtime-enforced confirmations.

Slack scope minimization depends on the patched local Slack server. Prefer `SLACK_MCP_CHANNEL_TYPES=public_channel` and `SLACK_MCP_ADD_MESSAGE_TOOL` with explicit channel IDs. Expected reduced user scopes are `chat:write`, `channels:read`, `channels:history`, `users:read`, and `search:read`.

## Setup

Prerequisites:

- Pi coding agent
- Node.js 22+ / npm for npm packages and local MCP servers
- `uv` / `uvx` for Python-based tools
- `tmux` and `vim` for the local terminal/editor workflow
- `context7-mcp` on `PATH` for docs lookup
- `ast-grep` on `PATH` for the local tree-sitter MCP pattern tools

```bash
cd ~/.config/pi
chmod +x setup.sh
./setup.sh
```

`setup.sh` links this repo to `~/.pi/agent`, so relative local package and MCP paths resolve from the Pi agent directory. If `~/.pi/agent` is already a symlink to another path, the script repoints it to this repo.

## Runtime files not tracked

This repo intentionally excludes secrets, sessions, caches, logs, and dependency installs. Current `.gitignore` coverage includes:

- `.scratch/`
- `sessions/`
- `run-history.jsonl`
- `mcp-cache.json`
- `pi-crash.log`
- `/auth.json`
- `**/node_modules`
- `__pycache__/`, `*.py[cod]`, `.ruff_cache/`, `.pytest_cache/`
- `mcp-onboarding.json`
- `/mcp-oauth`
- `/intercom`
- `/.cache`
- `/.pi-lens/`
- `/compact-backups`
- `/favorites.json`
- `/pisesh-meta.json`

## Related docs

- `AGENTS.md`: agent policy and workflow routing
- `APPEND_SYSTEM.md`: local host/toolchain overlay
- `DESIGN.md`: rationale for the config structure
- `USAGE.md`: human-facing usage guide
- `ATTRIBUTIONS.md`: copied/adapted upstream files and influences
