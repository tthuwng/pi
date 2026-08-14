# Pi configuration

Personal, credential-free configuration for the Pi coding agent on macOS.

## Layout

- `agent/settings.json` — Pi defaults and the repo-backed package list.
- `agent/multi-pass.example.json` — generic example subscription configuration.
- `bootstrap.sh` — safely links the tracked files into `~/.pi/agent`.

The enabled packages are:

- `pi-mcp-adapter` — MCP server discovery and native Pi tools.
- `tthuwng/pi-extensions:multi-pass-compat` — Pi 0.84.2 compatibility bridge
  required by the current `pi-multi-pass` release.
- `pi-multi-pass` — multiple OAuth subscriptions and rotation pools.
- `pi-web-access` — web search and page fetching.
- `pi-lens` — code diagnostics and inspection tools.
- `@dietrichgebert/ponytail` — always-on coding guidance and skills.
- `pi-simplify` — `/simplify` reviews for recently changed code.

`pi-web-access` is intentionally listed once; repeated install requests are
deduplicated by Pi.

The account manager is the upstream `pi-multi-pass` package. Its provider
accounts, pools, and labels remain local in `~/.pi/agent/multi-pass.json` and
are not part of this public repository. Credentials remain in Pi's local
`auth.json`.

The compatibility bridge only adapts Pi's current auth-status API to the
legacy interface expected by `pi-multi-pass`; it does not own, copy, or log
credentials.

`pi-mcp-adapter` has no MCP servers configured by default. Add or adopt a
server interactively with `/mcp setup` after reviewing its configuration.
`pi-web-access` works without a key through its zero-configuration providers;
optional provider keys belong in the local `~/.pi/web-search.json`.

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
- `~/.pi/agent/npm/`
- provider-failover logs and runtime state
