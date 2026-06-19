---
name: memory-runbook
description: Initialize, verify, and troubleshoot pi-memory-md directories and reusable memory notes. Use when memory search fails, memory folders are missing, or durable runbook knowledge should be stored.
---

# Memory Runbook

Memory stores durable reusable knowledge, not task scratchpads or raw transcripts.

## When to Use

- `memory_search` reports missing memory directories.
- A task discovers a reusable setup step, root cause, command flow, or gotcha.
- You need to verify what memory is loaded before nontrivial implementation/debugging.
- You are about to write or update a memory file.

## Verify Configuration

Inspect local config first:

- `settings.json` → `pi-memory-md.enabled`
- `settings.json` → `pi-memory-md.memoryDir.localPath`
- `settings.json` → `pi-memory-md.memoryDir.globalMemory`

Then use memory tools when available:

1. `memory_check` for directory status.
2. `memory_list` or `memory_search` for existing notes.
3. `memory_sync status` only when git sync is configured and relevant.

If directories are missing, report the exact missing paths before creating or writing anything.

## Initialize Safely

Prefer the `memory-init` skill when first setting up memory. If manual initialization is needed, create only the configured memory root and project/global subdirectories; do not import private notes or sync remotes without explicit approval.

Minimum expected directories for this repo configuration:

```text
~/.pi/memory-md/common
~/.pi/memory-md/pi
```

## Write Memory

Write memory only for durable, reusable knowledge:

- repo setup/runbooks,
- repeated failure causes and fixes,
- verification command flows,
- stable user preferences,
- environment gotchas.

Do not write:

- secrets, tokens, auth material,
- raw logs or large transcripts,
- one-off task state,
- broad policy duplicated from `AGENTS.md`.

Before writing, search/list existing memory and update a focused note instead of creating duplicates.

## Verification

After writing or updating memory:

- Re-read/list the memory file.
- Confirm frontmatter is valid and searchable.
- State why the note is durable enough to keep.

If no memory is written after a substantial task, say why: no durable reusable knowledge, memory unavailable, or user declined.
