---
name: writing-plans
description: Use after requirements or design are approved and the task benefits from a plan file. Produces precise .scratch implementation plans with exact tasks, TDD scenarios, verification commands, and review strategy for Pi workers/reviewers.
---

# Writing Plans

Create implementation plans that can be executed without implicit design decisions.

Use this for Tier 3 work or when the user explicitly asks for a written plan. Routine Tier 2 work can proceed from an approved chat plan without a `.scratch/plans/` file.

Plans live in `.scratch/plans/` unless the user explicitly asks for project documentation.

## Boundaries

Allowed:

- Read code, docs, tests, and relevant configs.
- Dispatch read-only scouts.
- Write implementation plans to `.scratch/plans/`.

Not allowed:

- Editing source/tests/config while planning.
- Hiding assumptions.
- Adding mutating git instructions.

## Before Planning

Verify you have:

- approved design or sufficiently clear requirements,
- known constraints from project instructions,
- likely files/symbols affected,
- project test/lint/typecheck commands when discoverable,
- human review triggers identified.

If not, use `brainstorming` or `scout` first.

## Plan Format

Every implementation plan should follow this structure:

```markdown
# <Feature> Implementation Plan

**Goal:** <one sentence>
**Approved design:** <link to design file or compact summary>
**Constraints:** <no mutating git, project conventions, review triggers>
**TDD strategy:** <how scenarios map across tasks>
**Review strategy:** <spec compliance, then code quality where useful>

## Assumptions

- **[ASSUMPTION: ...]**

## Tasks

### Task N: <small behavior>

**Scenario:** New behavior | Existing tested behavior | Trivial/non-behavioral
**Purpose:** <what this task accomplishes>
**Files:**

- Modify: `path/file.ext` (`symbol` or lines when known)
- Test: `path/test.ext`

**Red / Baseline:**

- For new behavior: add/run a failing test and expected failure.
- For existing tested behavior: run existing test command first and expected pass.
- For trivial changes: state why no new test is required.

**Green:**

- Minimal implementation target. Include exact symbols or small snippets only when necessary.

**Refactor/docs:**

- Cleanup, comments, docs, or none.

**Verification:**

- Exact command(s) and expected result.

**Review notes:**

- What spec reviewer and quality reviewer should check.
```

## Task Granularity

Make tasks small enough for a worker to complete without redesigning:

- one behavior or one coherent refactor per task,
- one TDD cycle per new behavior where practical,
- exact files and commands,
- explicit stop conditions.

If a task requires product judgment, split it or return to `brainstorming`.

## TDD Scenario Selection

Use `test-driven-development` terminology:

1. **New behavior/new file:** failing test first, verify red, implement, verify green.
2. **Existing tested behavior:** run relevant tests before and after, add coverage if changed behavior is not proven.
3. **Trivial/non-behavioral:** use judgment, run relevant checks if available.

## Git Policy

Do not include agent-run commands for:

- `git add`
- `git commit`
- `git push`
- `git checkout`
- `git reset`
- `git stash`
- `git rebase`
- `git merge`
- `git worktree`

If a handoff command is useful, label it as **User-run only** and prefer copying it to the clipboard at completion time, not in the implementation plan.

## Handoff

After writing the plan:

1. Present the plan path.
2. Summarize task count, highest risks, and verification strategy.
3. Ask for approval unless the user already approved this exact plan.
4. On approval, use the `manager-workflow` plan execution and delegation rules.
