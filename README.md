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

## Optional MCP

Notion is not enabled by default because it starts a browser OAuth flow on remote hosts. Add it to `mcp.json` only when you want to authenticate it.

## Update

```bash
cd ~/pi
git pull
./setup.sh
just doctor
```
