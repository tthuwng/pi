# pi-dynamic-workflows

Claude Code-style dynamic workflow and agent-team orchestration for Pi,
packaged separately from `pi-subagents`.

`pi-dynamic-workflows` provides named, inspectable, rerunnable workflow specs,
package-local agent teams, and slash-command UX. It does not reimplement
child-agent execution. It uses `pi-subagents` as the backend for agents, chains,
parallel runs, async execution, fork context, worktrees, intercom, and status
rendering.

## Install

Install the backend first, then this package:

```bash
pi install npm:pi-subagents
pi install git:github.com/tthuwng/pi-dynamic-workflows
```

For local development in this repo, add `packages/pi-dynamic-workflows` to the
Pi `packages` list.

## Commands

```text
/workflows
/workflow deep-research -- What changed in Node.js permissions?
/workflow quality-gate -- Review the current diff before I call it ready
/workflow-cancel <run-id>
/workflow-save <run-id> -- .pi/workflows/saved.workflow.json
/workflow-export quality-gate -- .pi/workflows/quality-gate.workflow.json
/agents
/team-create Auth Team -- review=reviewer,tests=scout
/team-run auth-team -- Audit auth handlers
/team-status auth-team
/team-send auth-team/review -- Check middleware first
/team-stop auth-team/<task-id>
```

Prompt templates are also included:

```text
/deep-research <question>
/workflow <name> -- <arguments>
/workflow-author <workflow goal>
/workflow-review <path-or-workflow-name>
```

## Automatic routing

The extension listens to Pi's documented `input` event and conservatively
handles explicit workflow prompts before they reach the main agent:

```text
ultracode: deep research what changed in Node.js permissions
use workflow quality-gate on the current diff
run workflow research-decision -- compare these two libraries
```

By default, the installed extension routes both explicit workflow language and
broad research/review/audit/generate/refactor-style prompts through a heuristic
router, so substantive tasks can automatically fan out through bundled
workflows. Configure the package with `autoRoute: "explicit"` to require
explicit workflow language only, or `autoRoute: "off"` to disable automatic
routing. `defaultWorkflowName` controls the fallback workflow when no bundled
workflow name matches.

Explicit team prompts such as `assemble a team to audit auth` route to the
first configured agent team instead of the workflow router. If no team exists,
those prompts are left for the main agent so ordinary workflow heuristics do not
steal team intent.

The router skips slash commands and extension-injected messages to avoid
recursion and command/template collisions.

## Workflow files

Workflow specs are JSON files ending in `.workflow.json`.

Discovery order is package, then user, then project. Later scopes override
earlier scopes by workflow name.

| Scope | Path |
| --- | --- |
| Package | `workflows/*.workflow.json` in this package |
| User | `~/.pi/agent/workflows/*.workflow.json` |
| Project | nearest `.pi/workflows/*.workflow.json` |

Example:

```json
{
  "name": "quality-gate",
  "description": "Run fresh adversarial reviewers and reduce to a verdict.",
  "argumentHint": "<target>",
  "context": "fresh",
  "defaultAsync": false,
  "chain": [
    {
      "parallel": [
        { "agent": "reviewer", "task": "Review correctness for {task}" },
        { "agent": "reviewer", "task": "Review verification for {task}" }
      ],
      "concurrency": 2
    },
    { "agent": "reviewer", "task": "Synthesize a verdict from {previous}" }
  ]
}
```

The planner converts workflow specs into `pi-subagents` chain params. Template
values support `{task}`, `{args}`, `{workflow.name}`, and
`{workflow.description}`. Normal `pi-subagents` runtime variables such as
`{previous}` are preserved for chain execution.

## Dynamic fanout

Dynamic fanout specs are passed through to `pi-subagents`, but this package
validates the important safety bounds before launch:

- every dynamic fanout must set `expand.maxItems`,
- `expand.maxItems` must be `<= 1000`,
- static and dynamic step concurrency must be `<= 16`,
- dynamic source paths must use JSON Pointer syntax.

## Run registry and progress UI

Every `/workflow` launch and auto-routed workflow writes a run record under:

```text
~/.pi/agent/dynamic-workflows/runs/
```

Run records include status, phases, the active `pi-subagents` request id, a
bounded tail of live bridge updates, result/error text, and timestamps.
`/workflows` opens a lightweight Pi TUI component when `ctx.ui.custom` is
available and falls back to markdown output otherwise. The view shows discovered
workflow specs, recent runs, declared phases, latest tool update, and command
hints for saving or cancelling a run.

Supported controls today:

- `/workflow-cancel <run-id>` emits the `pi-subagents` bridge cancel event when
  the run has an active request id and marks the run `cancelled`.
- `/workflow-save <run-id> -- <path>` copies that run's current workflow spec
  without overwriting existing files.

Pause/resume/restart controls are not yet implemented here because this package
needs a stable `pi-subagents` control API for those operations. Use
`pi-subagents` async/status controls directly when you need deeper run control.

## Agent view and teams

Agent-view state is stored under:

```text
~/.pi/agent/dynamic-workflows/agent-view.json
```

Teams are declarative role groups that launch one `pi-subagents` parallel run
per team task. The package records team members, queued/running/completed tasks,
bridge request ids, a bounded live event tail, messages, result/error text, and
timestamps. Missing `pi-subagents` bridge detection fails fast after 15 seconds,
while started workflow/team runs wait up to 30 minutes for real agent results.

Supported controls today:

- `/agents` opens the agent-view dashboard when `ctx.ui.custom` is available and
  falls back to markdown otherwise.
- `/team-create <name> -- <member>=<agent>[,<member>=<agent>]` creates a
  persistent team. The team id is a slug of the name.
- `/team-run <team-id> -- <task>` launches one parallel `pi-subagents` task per
  team member.
- `/team-status [team-or-task-id]` prints team state, tasks, recent messages,
  and command controls.
- `/team-send <team-id>[/member-id] -- <message>` appends a package-local team
  message/note.
- `/team-stop <team-id>/<task-id>` emits the `pi-subagents` bridge cancel event
  for a task with an active request id and marks the task `cancelled`.

This is a control plane over `pi-subagents`, not a separate long-lived child
session daemon. Persistent interactive child sessions can be added later once Pi
and `pi-subagents` expose stable session/team primitives.

## Included workflows

- `deep-research` — fan out research, cross-check claims, synthesize a cited
  report.
- `quality-gate` — run adversarial reviewers and reduce to `PASS`, `FAIL`, or
  `INCONCLUSIVE`.
- `research-decision` — combine external evidence, local scout context, and
  tradeoff review.
- `generate-filter` — generate diverse options, then dedupe/filter/rank.

## Relationship to Claude Code workflows

This package aims for practical workflow parity in Pi:

- reusable named workflows,
- parallel agents and reducer phases,
- bounded dynamic fanout guardrails,
- explicit and opt-in heuristic auto-routing,
- background execution through `pi-subagents`,
- run records with live bridge update tails,
- `/workflows` progress UI with markdown fallback,
- save/cancel command affordances,
- exportable workflow specs,
- package-local agent-view/team control plane over `pi-subagents`.

It intentionally does not run arbitrary JavaScript workflow scripts. Workflow
files are declarative JSON and agents remain the execution boundary. The
agent-view/team layer is deliberately a package-local control plane, not a
standalone child-session daemon.

## Development

```bash
npm test
npm run typecheck
npm run check
```

## Relationship to pi-subagents

Use `pi-subagents` directly for one-off delegation. Use `pi-dynamic-workflows`
when the orchestration itself should be named, inspectable, and reusable.

If `/workflow` reports that the `pi-subagents` bridge is unavailable, install
and enable `pi-subagents` first.
