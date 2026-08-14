# Pi configuration

Personal, credential-free configuration for the Pi coding agent on macOS.

## Layout

- `agent/settings.json` — Pi defaults and the repo-backed extension package.
- `agent/multi-pass.example.json` — generic example subscription configuration.
- `bootstrap.sh` — safely links the tracked files into `~/.pi/agent`.

The extension source lives separately in
[`tthuwng/pi-extensions`](https://github.com/tthuwng/pi-extensions), with
`multi-accounts/` as its first package.

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
