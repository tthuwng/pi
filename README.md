# Pi Agent Config

Personal Pi coding-agent config for a kitty -> tmux -> Vim workflow.

## Install

```bash
git clone https://github.com/tthuwng/pi.git ~/pi
cd ~/pi
./setup.sh
just doctor
```

`setup.sh` links this repo to `~/.pi/agent` and runs `npm ci` for the pinned local runtime dependencies and local MCP server dependencies. The symlink keeps local package paths simple and makes updates a normal `git pull`.

## Use

```bash
cd ~/your-project
pi
```

In tmux:

```bash
tmux new -s pi -c ~/your-project
pi
```

One-shot:

```bash
pi -p "review this repo and find the risky parts"
```

## Shape

```text
AGENTS.md          always-loaded agent policy
APPEND_SYSTEM.md   local terminal/editor/tooling facts
settings.json      Pi runtime settings and packages
mcp.json           MCP servers
package.json       Pi package manifest and pinned local runtime dependencies
package-lock.json  npm lockfile for setup
agents/            local subagent prompts
extensions/        small local commands
skills/            workflow skills
chains/            saved multi-agent workflows
themes/            terminal themes
packages/          only patched or unpublished local packages
mcp-servers/       local MCP servers that need npm install
```

Most packages are installed by Pi from npm through `settings.json`. Dependencies that must match the current Pi `0.73.1` runtime are pinned in `package.json`. Local packages stay only when they are patched or unpublished:

- `packages/pi-subagents`
- `packages/pi-memory-md`
- `packages/pi-codex-retry`
- `packages/pi-goal-supervisor`

## Checks

```bash
just check
just doctor
pi list
```

`just doctor` also handshakes every default MCP server and lists its tools.

## MCP

Default MCP servers are local and installable from this repo:

- `tree-sitter` for code navigation
- `context7` for library docs
- `context-mode` for context packing

Google Docs, Slack, and Notion are not enabled by default because they need private OAuth files or host-specific binaries. Add them to `mcp.json` only after the credential files and server binary exist on the host.

## Multi-Agent Workflows

This repo enables `pi-subagents` plus local scout, worker, and reviewer agents. Use natural language, or run the default implementation loop directly:

```text
/run-chain implement-review -- fix the failing MCP startup
```

Useful shortcuts:

```text
/parallel-review <task>
/quality-gate <task>
/quick-adversarial-check <task>
```

## Optional MCP

Keep private MCP setup outside the default config until it is ready:

```bash
mkdir -p ~/.config/pi/mcp-oauth/google_docs ~/.config/pi/mcp-oauth/slack
```

## Update

```bash
cd ~/pi
git pull
./setup.sh
just doctor
```
