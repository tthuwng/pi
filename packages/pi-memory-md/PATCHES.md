# Local pi-memory-md patches

This directory is a local path package copied from the npm `pi-memory-md` package so Pi can load a persistent patched extension without modifying the global npm install under `~/.npm-global/lib/node_modules`.

`settings.json` loads this package via `packages/pi-memory-md` instead of `npm:pi-memory-md`.

## Patches

- Deliver shared global memory from `memoryDir.globalMemory` even when the current project-specific memory directory does not exist.
- Let `memory_search` search both shared global memory and project memory, instead of failing when the project core directory is missing.
- Let `memory_check` report shared global memory even when the project memory directory is absent.
- Let `/memory-status` and `memory_sync { action: "status" }` recognize global-only local memory instead of reporting uninitialized.
- Avoid non-null assertions around `settings.localPath` in sync/status paths.
- Add regression tests for global-only delivery, search, check, and status behavior.
- Tolerate malformed frontmatter with a best-effort fallback so one bad memory file does not break delivery.
- Write `memory_write` output with JSON-compatible frontmatter via `JSON.stringify` to avoid ambiguous YAML scalars.
- Add regression tests for malformed frontmatter fallback and JSON frontmatter output containing YAML-hostile evidence strings.
- Add the missing runtime `@sinclair/typebox` dependency and align local Pi core dev/peer dependencies with the installed Pi version to avoid shadowing an older core package.
- Replace the broken upstream `tsgo` check script with a working `tsc` command.

## Maintenance

When updating from upstream, copy or merge upstream changes into this directory, preserve the patches above, then run:

```bash
(cd packages/pi-memory-md && npm install --ignore-scripts && npm run check && npm test)
```
