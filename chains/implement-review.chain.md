---
name: implement-review
description: Scout, implement with one writer, then review the diff.
---

## scout

output: false
progress: true

Find the files, existing patterns, and verification command for this task:

{task}

## worker

output: false
progress: true

Implement the smallest correct change for:

{task}

Use this scout context:

{previous}

Verify the change before reporting.

## reviewer

output: true
progress: true

Review the final diff for correctness, scope, simplicity, and verification evidence. End with:

```text
Verdict: PASS | FAIL | INCONCLUSIVE
Confidence: high | moderate | low
Blocking findings: <count and severities>
```

Original task:

{task}

Implementation summary:

{previous}
