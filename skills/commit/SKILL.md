---
name: commit
description: Git commit message conventions — ok/ prefix, terse imperative messages. Read this skill before advising on git commits.
---

# Commit Conventions

**IMPORTANT: The agent must NEVER run git commit or git add. Only advise the user on the commit message.**

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

## What to Present

Show the user:

- Suggested commit message
- Files that should be staged
- Any files that should NOT be staged (secrets, .env, etc.)

Let the user run the actual git commands.
