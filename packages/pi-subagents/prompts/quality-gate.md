---
description: Quality gate with adversarial parallel review
---

Run a quality gate on the current answer, plan, diff, PR, issue, or target.

Primary target or focus:

$@

This workflow is quality-first. Do not avoid useful reviewers merely to save cost. Use fresh context unless I explicitly ask for forked context. Before launching children, hydrate the target: read/fetch the referenced file, diff, URL, issue, PR, plan, log, screenshot, or quoted claim enough to name the concrete scope. Include that concrete target and any relevant paths/links in every child task. The child reviewers should inspect the target directly from files, diffs, linked sources, commands, or fetched content; they must not rely on the main conversation history.

Use the `subagent` tool with parallel fresh-context reviewers. Prefer three strong reviewers for normal work and add a fourth or fifth when the target is large, security-sensitive, ops-heavy, architecture-heavy, or ambiguous. Do not spawn duplicate vague reviewers.

Default angles:

1. Correctness/regression adversary
   Attack whether the target satisfies the request, preserves behavior, handles edge cases, and avoids hidden runtime failures.

2. Tests/verification adversary
   Attack whether the evidence actually proves the claim. Check tests, typecheck/lint/build commands, manual validation, missing red/green evidence, and stale or insufficient verification.

3. Simplicity/maintainability adversary
   Attack unnecessary complexity, duplication, vague abstractions, brittle ownership boundaries, misleading names, and cleanup that is clearly worth doing.

Add these when relevant:

- Security/privacy adversary for auth, permissions, secrets, data exposure, untrusted input/output, or destructive actions.
- Ops/resource adversary for tmp/log/session pressure, concurrency, cloud resources, migrations, deploy risk, rollback, or observability.
- User-preference/adoption adversary for workflow, UX, documentation, or behavior that might violate known user preferences.

Recommended runtime shape:

```typescript
subagent({
  tasks: [
    {
      agent: "reviewer",
      task: "Quality gate: attack correctness and regression risk for <target>. Inspect files/diffs/sources directly. Return concise evidence-backed findings with severity and file/line references where applicable. Do not edit.",
      output: false,
      progress: false,
    },
    {
      agent: "reviewer",
      task: "Quality gate: attack tests and verification evidence for <target>. Identify missing, stale, weak, or overclaimed validation. Return concise evidence-backed findings. Do not edit.",
      output: false,
      progress: false,
    },
    {
      agent: "reviewer",
      task: "Quality gate: attack simplicity and maintainability for <target>. Flag only concrete issues that affect correctness, reasoning, testability, or future change cost. Do not edit.",
      output: false,
      progress: false,
    },
  ],
  concurrency: 3,
  context: "fresh",
});
```

After reviewers return, parent synthesis is mandatory. Do not outsource the final decision to a child. Classify feedback as:

- must-fix now;
- should-fix now;
- optional/defer;
- reject/ignore with reason;
- ask user because applying it changes product, architecture, security, data, or scope.

Then emit a structured gate verdict:

```text
Verdict: PASS | FAIL | INCONCLUSIVE
Blocking findings: <count and one-line list>
Evidence inspected: <commands/files/artifacts actually inspected>
Decision: <claim allowed, claim blocked, or more evidence needed>
```

Blocking rule:

- `FAIL` when any accepted must-fix remains, required verification is missing/stale, a reviewer found a real unresolved correctness/security/ops blocker, or the target cannot support the claim being gated.
- `INCONCLUSIVE` when the reviewers lacked access to the target, evidence is incomplete, tool failures prevent inspection, or the parent cannot reconcile contradictory reviewer findings.
- `PASS` only when no accepted must-fix remains, required evidence is fresh enough for the claim, and the parent can state why should-fix/optional findings do not block.

This gate is review and synthesis only. Do not edit files, launch a fix worker, or apply fixes from `/quality-gate` itself. If the target needs changes, report the accepted findings and the next authorized fix workflow. Stop and ask when a finding requires an unapproved product, architecture, security, data, or scope decision.
