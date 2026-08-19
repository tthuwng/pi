# Pi extensions

Extensions and packages bundled with the Pi configuration repository.

## Packages

- [`multi-pass/`](multi-pass/) — subscription management, rotation pools,
  fallback chains, model presets, and Pi auth compatibility.
- [`../packages/pi-codex-compact/`](../packages/pi-codex-compact/) — Codex Remote
  Compaction V2 with Pi-native fallback.
- [`../packages/pi-subagents/`](../packages/pi-subagents/) — isolated single,
  parallel, and chained delegation.
- [`../packages/pi-chrome-devtools/`](../packages/pi-chrome-devtools/) — Chrome
  DevTools Protocol inspection, navigation, JavaScript, and screenshots.
- [`../packages/pi-goal/`](../packages/pi-goal/) — verified persistent goals with
  optional ordered queues.

These packages are adapted from the upstream
[`narumiruna/pi-extensions`](https://github.com/narumiruna/pi-extensions)
implementations. Pi loads the selected extensions from the repository root.

`pi-accounts` was reviewed but not loaded: `multi-pass` already owns account
rotation and provider switching here. Its useful fail-closed OAuth and atomic
private-storage patterns remain candidates for a later focused refactor.

## Loading

The root `settings.json` loads the repository package with this manifest:

```json
{
  "source": ".",
  "extensions": ["./extensions/multi-pass/extensions/multi-sub.ts"]
}
```

Credentials remain in Pi's local `~/.pi/agent/auth.json`; this repository must
never contain tokens, account exports, or local auth state.

The account metadata and pool definitions are also local: `~/.pi/agent/multi-pass.json`.
Use the generic example in [`../multi-pass.example.json`](../multi-pass.example.json)
as a starting point, but do not commit your filled-in copy.
