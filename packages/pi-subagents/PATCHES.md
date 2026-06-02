# Local patches

This package is a local copy of `npm:pi-subagents` so Pi loads durable local fixes from `settings.json` instead of mutable global npm install state.

## WebSocket transport fallback

`src/runs/shared/model-fallback.ts` treats WebSocket transport closures as retryable model failures. This covers child runs that produce useful output or artifacts but exit with errors like:

```text
WebSocket closed 1006 Connection ended
```

When an agent has `fallbackModels` configured, pi-subagents can now retry these transport failures with the next model instead of stopping after one failed attempt.

Regression coverage: `test/unit/model-fallback.test.mjs`.

## Async parallel start labels

`src/shared/agent-labels.ts` keeps async start messages compact for large parallel groups. Repeated agents render as `N× agent`, so a top-level async parallel launch with 19 `delegate` children renders as `Async parallel: 19× delegate [id]` instead of `[delegate+delegate+...]`.

Regression coverage: `test/unit/agent-labels.test.mjs`.

## Setup

After copying or restoring this config on a new machine, run:

```sh
(cd packages/pi-subagents && npm install --omit=dev --ignore-scripts)
```

Use `--omit=dev` so the local package does not install local copies of stale `@mariozechner/pi-*` dev dependencies that can shadow the active Pi runtime packages.

Verify with:

```sh
(cd packages/pi-subagents && npm ls --omit=dev --depth=0)
(cd packages/pi-subagents && npm test)
```
