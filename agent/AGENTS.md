# Agent Instructions

## Writing

- Write agent-authored text in ASD-STE100 Simplified Technical English.
- Use short sentences, common words, and active voice.
- Preserve exact technical names, code identifiers, commands, and quotations.
- Follow the Google developer documentation style guide.

## Code

- Write simple, skimmable code.
- Minimize state, arguments, optional values, and overrides.
- Use discriminated unions for multi-shape objects.
- Handle every known object variant. Fail on unknown variants.
- Trust the types. Use asserts when required values must exist.
- Remove changes that are not strictly required.
- Prefer fewer lines, early returns, and simple functions.

## Workflow

- Read relevant files before editing them.
- Investigate failures before fixing them.
- Verify before claiming work is done.
- Keep changes narrow and preserve unrelated work.
- Use `ht/` when creating a git branch.
- Treat non-repository sessions as valid. Before Git commands, locate a repository and use `git -C <repo>`.
- Never run a bare Git command from a non-repository session. Skip Git checks when the task does not need Git.
- Read the source and instructions before editing.
- Verify the exact changed files before reporting success.
- Treat current instructions and source as authoritative over memory, caches, and old sessions.
- Report the objective, finding, risk, and next action during long tasks.
