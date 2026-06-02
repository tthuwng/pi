---
name: review
description: Code, plan, and implementation review against requirements and configured project standards. Use for review requests, after non-trivial implementation, or when dispatching reviewer subagents in spec-compliance or code-quality mode.
---

# Review

Review is evidence gathering, not rubber-stamping.

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

1. Correctness and edge cases.
2. Meaningful behavioral tests.
3. Security, auth, data exposure, secrets, injection.
4. Error handling and failure modes.
5. Simplicity/YAGNI and unnecessary abstraction.
6. Existing codebase patterns.
7. Artifacts: debug logs, commented experiments, hardcoded values, stray TODOs.
8. Scope control.
9. Structural maintainability:
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
4. Implement valid fixes in severity order.
5. Push back with evidence when feedback is wrong or conflicts with approved scope.
6. Ask one focused question when feedback changes behavior, architecture, tests, security, or scope.
7. Verify after each logical fix group.

Structural feedback is not automatically correct. Verify that the proposed simplification is concrete, behavior-preserving, and compatible with approved scope. If it changes architecture, behavior, schema, config, security, data mutation, or public contracts, ask before implementing.

Do not use filler such as “great catch,” “good point,” or “you're absolutely right.” Report technical action and evidence instead.

## How to Review

- Read the plan/spec and relevant diff/files before judging.
- Use tree-sitter/LSP for precise code navigation.
- Run or inspect tests when needed and safe.
- Cite file paths and line numbers for findings.
- Categorize findings: `must-fix`, `should-fix`, `nit`, `note`, or `needs-discussion`.
- Write findings to `.scratch/reviews/` when requested by the workflow.

## Delegated Reviewer Subagents

When dispatching a reviewer subagent, treat `/home/orestes/.pi/agent/agents/reviewer.md` as the authoritative child contract. The reviewer agent does not inherit this skill by default, so standards that must apply inside delegated reviews must exist in the reviewer agent prompt or be included explicitly in the subagent task.

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
