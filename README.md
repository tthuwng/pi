# Pi configuration

Personal, credential-free configuration for the Pi coding agent on macOS.

## Layout

- `settings.json` — Pi defaults and the repo-backed package list.
- `AGENTS.md` — global Pi instructions.
- `agents/` — user agent profiles.
- `skills/` — reusable Pi skills.
- `mcp.json` — explicit documentation, monitoring, collaboration, and
  repository MCP servers.
- `multi-pass.example.json` — generic example subscription configuration.
- `packages/` — self-contained installable Pi packages.
- `extensions/` — extension source that is not a standalone package.
- `prompts/` — small, repo-backed prompt shortcuts.
- `bootstrap.sh` — safely links the tracked files into `~/.pi/agent`.

The enabled packages are:

- `pi-mcp-adapter` — MCP server discovery and native Pi tools.
- `packages/` — maintained Pi 0.84.2 packages. The bundle loads
  `pi-chrome-devtools`, `pi-codex-compact`, `pi-goal`, and `pi-subagents`.
- `extensions/multi-pass/` — vendored multi-account extension source.
- `pi-web-access` — web search and page fetching.
- `pi-observational-memory` — record useful session observations and compact
  long sessions with model-window-relative thresholds. Use `/om:status` and
  `/om:view` to inspect it.
- `@ff-labs/pi-fff` — local fuzzy file and content search with indexed results.
  The launcher loads it only inside Git repositories. It adds `fffind`,
  `ffgrep`, and `fff-multi-grep` without replacing Pi's built-in search tools.
- `pi-lens` — code diagnostics and inspection tools. It loads on demand.
- `context-mode` — bounded tool output and indexed context retrieval.
- `pi-session-search` — search past Pi sessions with local FTS5 indexing.
  It starts indexing three seconds after Pi starts and skips subagent sessions.
- `@narumitw/pi-caffeinate` — keep the host awake during long runs.
- `@narumitw/pi-worktree` — create and manage isolated worktrees.
- `@narumitw/pi-usage` — show provider usage limits.
- `pi-multi-account` — discover Codex accounts and rotate on auth or quota
  errors.
- `pi-shell-acp@0.11.1` — use the locally authenticated Claude Code and Codex ACP
  backends through Pi. Cycle to `pi-shell-acp/gpt-5.5` or a Claude model.
- `@quintinshaw/pi-dynamic-workflows` — run resumable, parallel JavaScript
  workflows with model routing, cost tracking, and worktree isolation.
- `@dietrichgebert/ponytail` — always-on coding guidance and skills.
- `pi-simplify` — `/simplify` reviews for recently changed code.

The tracked skills include `grilling` and `writing-for-agents` from
[`mattpocock/skills`](https://github.com/mattpocock/skills). Run
`/skill:grilling` to stress-test a plan before implementation.

`pi-web-access` is intentionally listed once; repeated install requests are
deduplicated by Pi.

`pi-multi-account` discovers authenticated provider slots from Pi's local
`auth.json`. Its failover settings and state remain local in
`~/.pi/agent/provider-failover.json` and
`~/.pi/agent/provider-failover-state.json`.

`pi-mcp-adapter` is configured with seven explicit servers in `mcp.json`.
Host-config discovery is off, so Pi does not silently import the unrelated
Codex or Claude Code MCP inventory. The definitions are credential-free:

- Context7 provides current library documentation through hosted OAuth. Run
  `/mcp-auth context7` once in Pi.
- Sentry provides hosted error-monitoring tools through OAuth. Run
  `/mcp-auth sentry` once in Pi.
- Google Docs provides Google Docs, Sheets, and Drive tools through a lazy local
  server. It also requests Gmail and Calendar scopes. Set
  `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then run the package's `auth`
  command before using `/mcp`.
- GitHub connects to the hosted official MCP server with the token from
  `gh auth token`. Pi reads it only when the lazy server connects.
- Slack and Notion use hosted OAuth. Run `/mcp-auth slack` and
  `/mcp-auth notion` in Pi once; tokens are stored in the OS credential store.
- Granola uses the local read-only cache server and is lazy. Granola must be
  installed and running with a readable local cache before its tools work.

Use `/mcp` to inspect or reconnect a server. Use `/mcp setup` only when you
intentionally want to adopt another host configuration.
`pi-web-access` works without a key through its zero-configuration providers;
optional provider keys belong in the local `~/.pi/web-search.json`.

`pi-subagents` exposes delegation tools and refreshes the available agent
catalog at session start and `/reload`. The model chooses when to delegate.
It does not start a subagent for every task. Detached completion messages are
delivered according to the configured completion policy. Its built-in
`reviewer` is read-only and evidence-first. The tracked `run-monitor` agent
adds the same read-only contract for one named tmux, log, or status-file run.
Use `/subagents` to review the catalog, then name the agent when delegating.

`@quintinshaw/pi-dynamic-workflows` registers its `workflow` tool at session
start. Use `/workflows` for the run navigator and `/reload` after package
changes.

`pi-session-search` provides `session_search`, `session_list`, and
`session_read`. Use `/session-sync` after a session finishes if you need its
results immediately.

Use `/atomic-commit` to preview and then create atomic commits with the local
`omp` command. It never pushes.

The machine also has the editor-facing `pi-acp` adapter. Configure an ACP
client such as Zed to run `pi-acp`; it starts this Pi setup in RPC mode.

Pi uses its built-in TUI. `multi-pass` already owns account rotation, so
`@narumitw/pi-accounts` is not added. `@narumitw/pi-tui-kit` is a library
dependency, not a standalone extension.

## Link this machine

From this checkout:

```bash
./bootstrap.sh
```

Existing regular files are moved into a timestamped
`~/.pi/agent/config-backups/` directory before linking. The script never links
or stores credentials. It deliberately leaves the machine's `multi-pass.json`
unlinked because account labels and routing choices are local preferences.

## Deliberately untracked

These remain machine-local and are never committed:

- `~/.pi/agent/auth.json`
- `~/.pi/agent/multi-pass.json`
- `~/.pi/agent/models-store.json`
- `~/.pi/agent/mcp-oauth/` (legacy import only; current OAuth uses Keychain)
- `~/.pi/agent/npm/`
- provider-failover logs and runtime state
