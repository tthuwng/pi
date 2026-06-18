---
name: review
description: Code, plan, and implementation review against requirements and configured project standards. Use for review requests, after non-trivial implementation, or when dispatching reviewer subagents in spec-compliance or code-quality mode.
---

# Review

Review is evidence gathering, not rubber-stamping.

## Subagent Escalation for Normal Review Requests

For nontrivial review requests, high-quality review requests, implemented work, plans/diffs with meaningful risk, or user language such as “review this”, “check this”, “does this look right?”, “quality gate”, “before finalizing”, “fix review fix review”, or “review with many angles”, load/apply the `pi-subagents` skill and use fresh-context reviewer fanout when it would add material independent evidence. Do not require the user to name `/parallel-review` or `/quality-gate`.

Default routing:

- Simple local review or tiny Tier 1 change: perform this review skill directly unless a specific risk makes independent review materially useful.
- Nontrivial diff/plan/answer review: use `pi-subagents` `/parallel-review` pattern with distinct reviewer angles when independent review materially improves evidence.
- Pre-final claim that something is good enough: use `pi-subagents` `/quality-gate` pattern; review and synthesis only, ending with a parent-synthesized `PASS` / `FAIL` / `INCONCLUSIVE` verdict.
- Parent proposal verification: when the user asks to verify, pressure-test, argue against, research/decide, or “do it if it survives” after this parent proposed a plan/architecture/workflow/diagnosis, review the proposal itself before implementation scouting or worker/planner dispatch. Synthesize `PASS` / `FAIL` / `INCONCLUSIVE` first.
- Review feedback loop when the user explicitly authorizes fixes: one writer/fix pass at a time, then fresh reviewers.
- Cleanup/deslop/verbosity review: use `pi-subagents` `/parallel-cleanup` pattern.

The parent session owns synthesis. Reviewer subagents provide evidence; they do not replace direct inspection or final judgment.

## Review Modes

Choose the mode explicitly.

### 1. Spec Compliance Review

Check whether the implementation matches the approved task/plan exactly.

Flag:

- missing requirements,
- extra behavior beyond scope,
- wrong files or public API shape,
- tests that do not prove the specified behavior,
- deviations from explicit constraints.

In this mode, extra cleverness is a defect.

### 2. Code Quality Review

Check whether the implementation is safe, simple, tested, and maintainable.

Review:

- Correctness and edge cases.
- Meaningful behavioral tests.
- Security, auth, data exposure, secrets, injection.
- Error handling and failure modes.
- Simplicity/YAGNI and unnecessary abstraction.
- Existing codebase patterns.
- Artifacts inside the reviewed change: debug logs, commented experiments, hardcoded values, stray TODOs.
- Scope control.
- Structural maintainability:
  - scattered special cases, mode flags, or one-off conditionals in busy flows,
  - missed behavior-preserving simplifications that delete concepts, branches, or layers,
  - logic outside the canonical owner layer,
  - duplicate helpers instead of canonical utilities,
  - loose type or object boundaries hiding invariants,
  - non-atomic related state updates,
  - unnecessary wrappers or generic mechanisms,
  - AI-slop patterns such as unnecessary comments, abnormal defensive checks, cast-to-escape typing, or nesting/wrappers inconsistent with local style,
  - files crossing roughly 1000 lines without a decomposition reason.

Do not relitigate approved product scope unless the implementation creates risk.

Do not treat git-index or working-tree hygiene as normal code-review findings. Ignore staged/unstaged mismatches, untracked files, dirty working trees, and tracking status unless the user explicitly asks for commit/release/staging hygiene or the issue is a real secret/destructive artifact risk. Repo-local `progress.md` files are scratch/memory files; do not ask to remove them or add `.gitignore` rules just because they are untracked.

### 3. Plan Review

Check feasibility before implementation:

- tasks are ordered and small,
- assumptions are explicit,
- files and commands are specific enough,
- TDD scenarios are appropriate,
- human review triggers are identified,
- no mutating git instructions are included.

### 4. Review Feedback Evaluation

Treat review feedback as evidence to evaluate, not an order to obey blindly.

For each item:

1. Read the full feedback before reacting.
2. Verify it against code, tests, plan, and constraints.
3. Classify it:
   - `must-fix`: correctness, security, broken tests, requirement mismatch, unhandled critical edge case.
   - `should-fix`: maintainability, likely bug, insufficient test coverage, avoidable complexity.
   - `nit`: naming, wording, minor formatting, small cleanup.
   - `note`: useful observation that does not require action, including feedback that is invalid because it conflicts with requirements, violates YAGNI, or lacks necessary context.
   - `needs-discussion`: unclear feedback or feedback that would change behavior, architecture, tests, security, or scope.
4. Push back with evidence when feedback is wrong or conflicts with approved scope.
5. Ask one focused question when feedback changes behavior, architecture, tests, security, or scope.
6. Do not apply fixes from a review-only request. If fixes are explicitly authorized, route execution through the approved manager/implementation workflow; one writer applies the accepted fixes, then fresh evidence verifies the result.

Structural feedback is not automatically correct. Verify that the proposed simplification is concrete, behavior-preserving, and compatible with approved scope. If it changes architecture, behavior, schema, config, security, data mutation, or public contracts, ask before implementing.

Do not use filler such as “great catch,” “good point,” or “you're absolutely right.” Report technical action and evidence instead.

## How to Review

- Read the plan/spec and relevant diff/files before judging.
- When inspecting diffs, use total effective diffs. For tracked files, prefer `git diff HEAD -- <path>` or `git diff -U20 HEAD -- <path>` so staged and unstaged changes are both included. Raw `git diff -- <path>` only shows unstaged tracked changes; `git diff --cached -- <path>` only shows staged changes. When untracked files are in scope, list them with `git ls-files --others --exclude-standard` and read/review their contents separately because normal Git diffs do not include untracked file bodies.
- Use tree-sitter/LSP for precise code navigation.
- Run or inspect tests whenever they materially improve review confidence and are safe/proportionate.
- Cite file paths and line numbers for findings.
- Categorize findings: `must-fix`, `should-fix`, `nit`, `note`, or `needs-discussion`.
- Return findings inline unless an explicit output path/wrapper capture is provided. Do not use shell writes to create review artifacts. If review-only/no-artifact instructions conflict with workflow artifact habits, review-only/no-artifact wins.

## Delegated Reviewer Subagents

When dispatching a reviewer subagent, treat `~/.pi/agent/agents/reviewer.md` as the authoritative child contract. The reviewer agent does not inherit this skill by default, so standards that must apply inside delegated reviews must exist in the reviewer agent prompt or be included explicitly in the subagent task.

Use delegated reviewers for independent inspection of diffs, plans, proposed solutions, or implementation results. Prefer fresh context for adversarial code review unless inherited session history is necessary.

The parent session owns synthesis and decisions. Reviewer findings are evidence to evaluate, not orders to apply. Do not let a reviewer expand scope, approve architecture changes, or trigger implementation. If feedback requires behavior, architecture, schema, config, security, data, or public-contract decisions, ask the user or parent decision-maker before applying it.

## Finding Standard

Report only issues supported by evidence.

A useful finding includes:

```text
Severity: must-fix | should-fix | nit | note | needs-discussion
Location: path:line
Problem: what is wrong
Why it matters: concrete impact
Fix: specific direction, or the decision needed before a fix is safe
Evidence: code/test/plan reference
```

## What Not To Do

- Do not rubber-stamp.
- Do not rewrite the code during review.
- Do not flag intentional approved decisions as bugs.
- Do not expand scope beyond the change.
- Do not invent hypothetical issues without plausible impact.
