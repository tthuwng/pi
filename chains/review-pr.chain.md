---
name: review-pr
description: Gather a GitHub PR with gh, then run read-only review and synthesize a verdict.
---

## scout

output: false
progress: true

Gather read-only PR context for:

{task}

Use the `github` skill and `gh` CLI. Do not mutate GitHub, do not checkout branches unless the user explicitly requested it, and do not push/comment/review. Return:

- PR/issue number or URL resolved
- files changed and likely review entry points
- comments/checks that matter
- local files or commands the reviewer should inspect

## reviewer

output: true
progress: true

Review the PR context below for correctness, scope, risks, and verification evidence. Do not mutate GitHub or files.

Context:

{previous}

End with:

```text
Verdict: PASS | FAIL | INCONCLUSIVE
Confidence: high | moderate | low
Blocking findings: <count and severities>
```
