---
name: pi-dynamic-workflows
description: Use Pi dynamic workflows, native child agent sessions, agent teams, workflow specs, /workflow, /workflows, /agents, and /team-*.
---

# Pi Dynamic Workflows

This skill is for parent/orchestrator sessions that should use named,
inspectable, reusable orchestration in Pi.

## Mental model

- `pi-dynamic-workflows` owns workflow discovery, declarative workflow specs,
  conservative automatic routing, native child session orchestration, run
  records/progress UI, package-local agent teams, command UX, and workflow
  authoring/review guidance.
- Workflows and team runs create native Pi child `AgentSession` runtimes. Runtime
  objects stay process-local; persistent files store only metadata, bounded event
  tails, session ids, session-file paths, and results.
- `pi-subagents` is no longer the default backend for `/workflow`, `/agents`, or
  `/team-run`. Use `pi-subagents` directly for one-off delegation or advanced
  shapes not yet supported by the native declarative executor.
- A workflow should hold orchestration policy. Child sessions should receive
  concrete role-specific tasks.

## Commands

- `/workflows` opens a Claude-style focused workflow panel when available,
  otherwise prints markdown with discovered specs, recent runs, phases, latest
  update, and save/cancel hints.
- `/workflow <name> -- <arguments>` records, plans, and launches a workflow
  through native Pi child sessions.
- `/workflow-cancel <run-id>` stops native child sessions for a running workflow
  or emits the legacy bridge cancel event for old run records with a bridge
  request id.
- `/workflow-save <run-id> -- <path>` saves the run's current workflow spec
  without overwriting existing files.
- `/workflow-export <name> -- <path>` copies a discovered spec to a user or
  project workflow path without overwriting existing files.
- `/agents` opens a Claude-style standalone dashboard when available, otherwise
  prints a markdown dashboard. The focused dashboard shows native sessions,
  working/completed rows, available teams, input, and selected row stop/cancel.
- `/agent-start -- <prompt>` starts a native child session.
- `/agent-reply <session-id> -- <message>` queues or sends a reply to an active
  native child session.
- `/agent-stop <session-id>` stops an active native child session.
- `/agent-status [session-id]` prints native session and team state.
- `/team-create <name> -- <member>=<agent>[,<member>=<agent>]` creates a
  persistent package-local team.
- `/team-run <team-id> -- <task>` launches one native child session per team
  member and aggregates member results.
- `/team-status [team-or-task-id]` prints team, task, message, and control
  state.
- `/team-send <team-id>[/member-id] -- <message>` records a team note.
- `/team-stop <team-id>/<task-id>` stops active native member sessions and marks
  the task cancelled.
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
- `{previous}` between native sequential/reducer stages.

Native executor supports single task steps, static parallel groups, sequential
reducers, and bounded static concurrency.

Native executor currently rejects dynamic fanout (`expand`/`collect`) with a
clear error. Use direct `pi-subagents` orchestration for that advanced shape
until native structured-output fanout is added here.

## Routing guidance

Use workflows when the plan is repeatable or too large/noisy for a single parent
turn:

- deep research with cross-checking,
- quality gates,
- research decisions,
- generate/filter fan-in,
- repeatable project/team orchestration.

The package also listens to Pi's `input` event. It handles explicit workflow
language such as `ultracode: ...`, `use workflow quality-gate on ...`, and
`deep research ...` before the main agent starts. Explicit team prompts such as
`assemble a team to audit auth` route to the first configured team; if no team
exists, they are left for the main agent instead of falling through to workflow
heuristics. It skips slash commands and extension-injected input. Installed
default auto-routing is `substantive`, so broad research/review/audit/generate/refactor
prompts can automatically launch many-agent workflows. Set `autoRoute:
"explicit"` to require explicit workflow language, or `autoRoute: "off"` to
disable automatic routing.

Use `/agent-start` or `/agents` for ad hoc native child sessions. Use plain
`subagent(...)` directly for one-off small delegation if you specifically want
`pi-subagents` behavior. Use workflow specs when orchestration itself should be
named, inspectable, and rerunnable.

## Safety and evidence

- Prefer `context: "fresh"` for independent review/research.
- Static step concurrency is capped by workflow/step settings and local runtime
  limits.
- Do not ask child sessions to edit unless the user has approved
  implementation.
- Parent must inspect workflow/session outputs before final claims.
- Recent run records live under `~/.pi/agent/dynamic-workflows/runs/` and
  include status, phases, native session ids, bounded update tails, and results.
- Agent-view state lives under `~/.pi/agent/dynamic-workflows/agent-view.json`.
  It stores native session metadata, teams, tasks, messages, and bounded event
  tails, not runtime objects.
- Active child sessions are disposed on parent `session_shutdown`. Stale active
  records are reconciled to `detached` on startup.
- Pause, resume, and restart controls are not yet implemented.
