---
name: commit
description: Git commit workflow and message conventions — ok/ prefix, terse imperative messages. Read this skill before advising on or creating git commits.
---

# Commit Conventions

**IMPORTANT:** Routine `git add` and `git commit` are allowed inside the current trusted repo when the user asks to commit or an approved workflow includes committing. Stack publish/sync commands such as `gs submit` and `gs sync` follow the global bounded git policy. Inspect status/diff first, stage only intended paths, and never include secrets or unrelated files.

## Format

```
<prefix>: <message>
```

## Rules

- Branch prefix: `ok/`
- Prefixes: `feat:`, `fix:`, `change:`, `chore:`, `refactor:`, `remove:`
- `change:` for behavior modifications, `feat:` only for genuinely new functionality
- `chore: style` for formatting-only, `chore: typecheck` for type-fix-only
- Arrow notation for renames: `refactor: old_name -> new_name`
- Short, lowercase, no trailing period
- Drop articles (the, a) — terse as possible, 3-7 words after prefix
- Focus on the "why", not the "what"
- One concern per commit

## Atomic Split Workflow

Before advising on or creating commits:

1. Inspect `git status --short` and the effective diffs for candidate paths.
2. Identify unrelated changes, secrets, generated files, and scratch artifacts that must not be staged.
3. Group changes by one concern per commit: behavior, tests, docs, refactor, generated updates, or follow-up cleanup.
4. For each group, name the exact staged paths or hunks and the verification evidence that supports that commit.
5. Use the message rules below for each commit.
6. Stop and ask before staging broad mixed changes, committing unrelated existing work, or using any history-rewriting/destructive git command.

If the working tree already contains unrelated user changes, leave them unstaged and call them out explicitly.

## What to Present

When advising without committing, show the user:

- Suggested commit message
- Files that should be staged
- Any files that should NOT be staged (secrets, .env, etc.)

When committing directly, report:

- Status/diff evidence reviewed
- Exact staged paths
- Commit command/result
