# pi-codex-retry

Local Pi extension that retries recoverable OpenAI Codex WebSocket transport failures while preserving live streaming.

## Behavior

- Overrides the `openai-codex-responses` API stream through `registerApiProvider()` with both raw and simple stream wrappers.
- Streams each attempt live.
- Retries recoverable transport failures such as `WebSocket closed 1006 Connection ended`, connection-ended failures, network errors, timeouts, and 502/503/504 responses.
- Forces `transport: "sse"` on retry attempts so a failed WebSocket path does not repeat indefinitely.
- Does **not** retry after a tool-call event starts, because replaying after tool side effects can duplicate actions.
- Covers direct `complete()` callers that use the provider registry, including compaction extensions, better than AgentSession-only retry hooks.

## Configuration

Defaults: 3 total attempts, 1000ms base exponential backoff.

Flags/env:

- `--codex-retry-max-attempts <n>` or `PI_CODEX_RETRY_MAX_ATTEMPTS=<n>`
- `--codex-retry-base-delay-ms <ms>` or `PI_CODEX_RETRY_BASE_DELAY_MS=<ms>`

## Verification

```sh
npm test
npm run typecheck
```
