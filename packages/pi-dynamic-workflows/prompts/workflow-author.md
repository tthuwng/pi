---
description: Draft a pi-dynamic-workflows JSON workflow spec
argument-hint: "<workflow goal>"
---
# Author Dynamic Workflow

Draft a `pi-dynamic-workflows` `.workflow.json` spec for this goal:

$@

Use a declarative chain with sequential steps, parallel groups, and bounded
dynamic fanout only when a prior structured output provides an array. Do not use
arbitrary JavaScript. Set `expand.maxItems` on every dynamic fanout, keep
concurrency at 16 or below, and include a short explanation of the workflow
phases and verification strategy.
