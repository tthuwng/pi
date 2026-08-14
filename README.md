# Pi configuration

Personal, credential-free configuration for the Pi coding agent on macOS.

## Layout

- `agent/settings.json` — Pi defaults and the repo-backed package list.
- `agent/pi-starship.toml` — compact footer layout and status filtering.
- `agent/multi-pass.example.json` — generic example subscription configuration.
- `bootstrap.sh` — safely links the tracked files into `~/.pi/agent`.

The enabled packages are:

- `pi-mcp-adapter` — MCP server discovery and native Pi tools.
- `tthuwng/pi-extensions:multi-pass` — maintained fork of upstream
  `pi-multi-pass`, including Pi 0.84.2 auth compatibility.
- `pi-web-access` — web search and page fetching.
- `pi-lens` — code diagnostics and inspection tools.
- `@narumitw/pi-starship` — minimal footer showing only the Codex 7-day quota.
- `@dietrichgebert/ponytail` — always-on coding guidance and skills.
- `pi-simplify` — `/simplify` reviews for recently changed code.

`pi-web-access` is intentionally listed once; repeated install requests are
deduplicated by Pi.

The account manager is maintained in the public
[`tthuwng/pi-extensions/multi-pass`](https://github.com/tthuwng/pi-extensions/tree/main/multi-pass)
fork. Its provider accounts, pools, and labels remain local in
`~/.pi/agent/multi-pass.json` and are not part of this public repository.
Credentials remain in Pi's local `auth.json`.

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
