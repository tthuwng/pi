---
description: Parallel subagents review
---

Launch parallel reviewers for an adversarial review of the current work.

This workflow is quality-first. Do not avoid useful reviewers merely to save cost, but every reviewer must add an independent attack surface. Use fresh context, not forked context, unless I explicitly ask for forked context. Reviewers should inspect the repository, relevant instructions, and current diff directly from files and commands. Do not rely on the main conversation history.

Give each reviewer a distinct adversarial angle. Generate the angles dynamically from the user's intent, the plan, the implemented code, and the current diff. If I specify angles, use mine. Otherwise, choose the highest-value review angles for this specific work.

These are examples, not fixed defaults:

1. Correctness and regressions
   Check whether the change satisfies the request, preserves existing behavior, handles edge cases, and avoids hidden runtime failures.

2. Tests and validation
   Check whether tests or validation were added at the right layer, whether assertions are meaningful, and whether the chosen verification commands are enough.

3. Simplicity and maintainability
   Check for unnecessary complexity, duplicate structure, single-use wrappers, brittle abstractions, confusing names, verbosity, and cleanup that is clearly worth doing.

Choose or adapt angles when the work calls for it:
- TypeScript-heavy changes: include type safety, source-of-truth types, casts, and error-boundary discipline.
- UI-heavy changes: include UX, accessibility, copy, and visual quality.
- Security-sensitive changes: include unsafe input/output handling, auth boundaries, privacy, and data exposure.
- Docs-heavy changes: include clarity, accuracy, completeness, reader flow, and non-robotic prose.
- Large multi-file changes: consider a fourth reviewer for structural friction, module boundaries, and testability.

Prefer three strong reviewers for normal changes. Use four or five when the work is large, security-sensitive, ops-heavy, architecture-heavy, or ambiguous. Do not spawn many vague reviewers.

Give every reviewer a specific task prompt naming its angle. Prefer `context: "fresh"`, `output: false`, `progress: false`, and deliberate `concurrency` in the runtime call. Ask reviewers to return concise, evidence-backed findings with file/line references and suggested fixes. The response should be review feedback, not a context summary. Reviewers must not edit files unless I explicitly ask for a writer pass.

While reviewers run, do your own narrow inspection if useful. After they return, synthesize the feedback into:
- fixes worth doing now
- optional improvements
- feedback to ignore or defer, with a short reason
- disagreements between reviewers and what you believe after comparing evidence

Do not blindly apply every reviewer suggestion. Do not claim consensus when reviewers conflict; preserve real disagreement and decide, investigate further, or ask me.

Autofix mode: enter write-continuation only when `autofix` is clearly supplied as a workflow flag, such as a trailing standalone token or explicit control phrase. Do not enter autofix when `autofix` is part of the review target, such as reviewing autofix docs, code, or behavior. Remove the control token before deciding the review target. After synthesis, apply only fixes worth doing now, validate, and summarize. Do not apply optional improvements unless explicitly requested. If there are no fixes worth doing now, do not edit.

Without autofix mode, ask before applying fixes when the invocation is review-only. If this review is part of an already approved implementation workflow, do not stop at review: synthesize the findings, apply only fixes worth doing now through the authorized write path, then validate. Stop and ask only when a finding requires an unapproved product, architecture, security, data, or scope decision.

When you ask, end with a compact numbered menu so I can respond with a number. Use wording suited to the findings, but include these choices when applicable:

```text
Reply with [1], [2], or further instructions:
[1] Apply only the fixes worth doing now.
[2] Apply the fixes worth doing now plus optional improvements.
```

Additional review target or focus from the user request, if any:

$@

If the invocation provides a URL, issue link, file path, plan path, or freeform focus, treat it as the primary review scope. Read or fetch that target before assigning reviewer angles, and pass the target explicitly into each reviewer task.
