---
name: conflict-resolution
description: Resolve Git merge/rebase conflict markers safely. Use when files contain conflict markers, git reports unmerged paths, or the user asks to resolve merge conflicts.
---

# Conflict Resolution

Resolve conflicts from evidence. Do not pick ours/theirs wholesale unless the user explicitly requested that exact choice or the surrounding code proves it is correct.

## Safety Rules

- Do not run `git reset --hard`, `git clean`, abort/rebase/merge cleanup, branch deletion, or history rewriting unless the user explicitly asks for that exact operation and scope.
- Do not stage, commit, push, or continue a merge/rebase unless the user requested that exact Git mutation or an approved workflow includes it.
- Preserve user changes and comments unless removal is explicitly required by the resolution.
- Resolve one file or one coherent conflict group at a time.

## Procedure

1. Inspect status with a bounded read-only command such as `git status --short`.
2. List unmerged files with `git diff --name-only --diff-filter=U` when available.
3. Read the conflicted region and enough surrounding code to understand ownership.
4. Compare sides:
   - `<<<<<<<` to `=======` is ours,
   - `=======` to `>>>>>>>` is theirs,
   - use `git show :1:path`, `:2:path`, `:3:path` only when base/ours/theirs context is needed.
5. Decide the smallest semantic resolution that preserves required behavior from both sides.
6. Edit the file to remove all conflict markers.
7. Run focused checks for the touched area.
8. Re-check no conflict markers remain in resolved files.

## Resolution Heuristics

Prefer semantic integration over textual compromise:

- Keep both changes when they affect independent behavior.
- Choose one side only when the other is obsolete, duplicated, or contradicted by the approved direction.
- Re-run formatters/tests when conflict resolution changes syntax, imports, generated order, or snapshots.
- For lockfiles or generated files, prefer the project’s package manager/regenerator over hand-editing when safe.

## Evidence to Report

- Files resolved.
- Which side or integration strategy was used and why.
- Checks run and results.
- Any unresolved conflicts or risky manual judgments.

## Anti-patterns

- Removing markers without understanding both sides.
- Resolving all conflicts with `--ours` or `--theirs` by default.
- Treating conflict resolution as permission to refactor unrelated code.
- Continuing a merge/rebase before verifying the working tree and tests.
