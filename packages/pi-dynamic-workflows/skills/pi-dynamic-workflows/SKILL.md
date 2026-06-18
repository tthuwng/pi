---
name: pi-dynamic-workflows
description: Use Pi dynamic workflows backed by pi-subagents for deep research, reusable orchestration, workflow specs, /workflow, and /workflows.
---

# Pi Dynamic Workflows

This skill is for parent/orchestrator sessions. It does not replace
`pi-subagents`; it uses `pi-subagents` as the execution backend.

## Mental model

- `pi-subagents` owns child agents, chain execution, async/background runs,
  fork context, intercom, and result/status rendering.
- `pi-dynamic-workflows` owns named workflow specs, workflow discovery,
  conservative automatic routing, run records/progress UI, command UX, and
  workflow authoring/review guidance.
- A workflow should hold orchestration policy. Child agents should receive
  concrete role-specific tasks.

## Commands

- `/workflows` opens the workflow progress UI when available, otherwise prints
  markdown with discovered specs, recent runs, phases, latest bridge update,
  and save/cancel hints.
- `/workflow <name> -- <arguments>` records, plans, and launches a workflow
  through the `pi-subagents` slash bridge.
- `/workflow-cancel <run-id>` emits the bridge cancel event for a run with an
  active request id and marks the run cancelled.
- `/workflow-save <run-id> -- <path>` saves the run's current workflow spec
  without overwriting existing files.
- `/workflow-export <name> -- <path>` copies a discovered spec to a user or
  project workflow path without overwriting existing files.
- `/deep-research <question>` is a prompt template that routes to
  `/workflow deep-research -- <question>` when available.

## Workflow specs

Workflows are JSON files ending in `.workflow.json`.

Locations:

- Package: `packages/pi-dynamic-workflows/workflows/*.workflow.json`
- User: `~/.pi/agent/workflows/*.workflow.json`
- Project: nearest `.pi/workflows/*.workflow.json`

A workflow contains:

```json
{
  "name": "quality-gate",
  "description": "Run fresh adversarial reviewers and reduce to a verdict.",
  "argumentHint": "<target>",
  "context": "fresh",
  "defaultAsync": false,
  "chain": [
    { "parallel": [{ "agent": "reviewer", "task": "Review {task}" }] },
    { "agent": "reviewer", "task": "Synthesize {previous}" }
  ]
}
```

Task templates support:

- `{task}` and `{args}` for invocation arguments.
- `{workflow.name}` and `{workflow.description}` for metadata.
- Normal `pi-subagents` chain variables such as `{previous}` still work at
  chain runtime.

## Routing guidance

Use workflows when the plan is repeatable or too large/noisy for a single
parent turn:

- deep research with cross-checking,
- quality gates,
- research decisions,
- generate/filter fan-in,
- bounded dynamic fanout from structured outputs,
- repeatable project/team orchestration.

The package also listens to Pi's `input` event. It handles explicit workflow
language such as `ultracode: ...`, `use workflow quality-gate on ...`, and
`deep research ...` before the main agent starts. It skips slash commands and
extension-injected input. Installed default auto-routing is `substantive`, so
broad research/review/audit/generate/refactor prompts can automatically launch
many-agent workflows. Set `autoRoute: "explicit"` to require explicit workflow
language, or `autoRoute: "off"` to disable automatic routing.

Use plain `subagent(...)` directly for one-off small delegation. Use prompt
templates when the parent should retain judgment turn by turn. Use workflow
specs when the orchestration itself should be named, inspectable, and
rerunnable.

## Safety and evidence

- Prefer `context: "fresh"` for independent review/research.
- Keep workflows bounded; every dynamic fanout needs `expand.maxItems`.
- Static and dynamic step concurrency is capped at 16.
- Dynamic fanout `expand.maxItems` is capped at 1000.
- Do not ask child agents to edit unless the user has approved implementation.
- Parent must inspect workflow/subagent outputs before final claims.
- Recent run records live under `~/.pi/agent/dynamic-workflows/runs/` and
  include status, phases, request id, bounded live update tail, and results.
- `/workflow-cancel` is supported through the bridge cancel event; pause,
  resume, and restart remain delegated to `pi-subagents` until a stable package
  API exists here.
- If direct `/workflow` launch fails with a bridge error, install/enable
  `pi-subagents`.
