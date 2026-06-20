# pi-dynamic-workflows

Claude Code-style dynamic workflow, agent-view, and agent-team orchestration for
Pi, packaged separately from `pi-subagents`.

`pi-dynamic-workflows` provides named, inspectable, rerunnable workflow specs,
native Pi child agent sessions, package-local agent teams, slash-command UX, and
focused TUI panels. Workflow and team execution now use Pi `AgentSession`
runtimes directly; `pi-subagents` is not the default execution backend for
`/workflow`, `/agents`, or `/team-run`.

## Install

```bash
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
/agent-start -- Investigate the flaky checkout test
/agent-reply <session-id> -- Continue with auth handlers
/agent-stop <session-id>
/agent-status [session-id]
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

The planner applies `{task}`, `{args}`, `{workflow.name}`, and
`{workflow.description}`. The native workflow executor also applies `{previous}`
between sequential/reducer stages.

## Native workflow execution

`/workflow` and auto-routed workflows create one native Pi child session per
workflow task. Static parallel steps run multiple child sessions concurrently and
then pass ordered results to later reducer steps through `{previous}`.

Supported native workflow shapes:

- single `WorkflowTask` steps,
- static `parallel` groups,
- sequential reducer stages using `{previous}`,
- bounded static concurrency.

Unsupported native workflow shapes:

- dynamic fanout (`expand`/`collect`) is rejected with a clear error. Rewrite the
  workflow as static steps or use direct `pi-subagents` orchestration for that
  advanced shape until native structured-output fanout is implemented here.

## Run registry and progress UI

Every `/workflow` launch and auto-routed workflow writes a run record under:

```text
~/.pi/agent/dynamic-workflows/runs/
```

Run records include status, phases, native child session ids, a bounded live
update tail, result/error text, and timestamps. Legacy run records can still
contain a `pi-subagents` bridge request id; `/workflow-cancel` handles both
native session ids and legacy bridge request ids.

`/workflows` opens a lightweight Claude-style focused Pi TUI component when
`ctx.ui.custom` is available and falls back to markdown output otherwise. The
custom panel focuses on running/completed workflows in the current session and
uses the Claude-style empty state when no runs exist. The markdown fallback still
shows discovered workflow specs, recent runs, declared phases, latest update, and
command hints for saving or cancelling a run.

Supported controls today:

- `/workflow-cancel <run-id>` stops active native child sessions for a run, or
  emits the legacy bridge cancel event when the run has only a bridge request id.
- `/workflow-save <run-id> -- <path>` copies that run's current workflow spec
  without overwriting existing files.

Pause/resume/restart controls are not yet implemented.

## Native agent sessions, agent view, and teams

Agent-view state is stored under:

```text
~/.pi/agent/dynamic-workflows/agent-view.json
```

Native agent sessions are process-local child Pi sessions with persisted
metadata, bounded event tails, and Pi session-file references. Runtime objects
are never persisted. Active child sessions are disposed when the parent Pi
session shuts down; stale active records are reconciled to `detached` on startup.

Teams are declarative role groups. `/team-run` starts one native child session
per team member, records the member-to-session mapping, waits for member results,
and aggregates the result into the team task.

Supported controls today:

- `/agents` opens a Claude-style standalone dashboard when `ctx.ui.custom` is
  available and falls back to markdown otherwise. The custom dashboard shows
  native sessions, working/completed task sections, available teams, an input
  line, and `ctrl+x` stop/cancel for the selected running row.
- `/agent-start -- <prompt>` starts a native child session.
- `/agent-reply <session-id> -- <message>` queues or sends a reply to an active
  native child session.
- `/agent-stop <session-id>` stops an active native child session.
- `/agent-status [session-id]` prints native session and team state.
- `/team-create <name> -- <member>=<agent>[,<member>=<agent>]` creates a
  persistent team. The team id is a slug of the name.
- `/team-run <team-id> -- <task>` launches one native child session per team
  member and aggregates results.
- `/team-status [team-or-task-id]` prints team state, tasks, recent messages,
  and command controls.
- `/team-send <team-id>[/member-id] -- <message>` appends a package-local team
  message/note.
- `/team-stop <team-id>/<task-id>` stops active native member sessions and marks
  the task `cancelled`.

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
- native child sessions,
- parallel agents and reducer phases,
- explicit and opt-in heuristic auto-routing,
- run records with live update tails,
- `/workflows` progress UI with markdown fallback,
- `/agents` dashboard with native session rows,
- save/cancel command affordances,
- exportable workflow specs,
- package-local agent teams over native sessions.

It intentionally does not run arbitrary JavaScript workflow scripts. Workflow
files are declarative JSON and agents remain the execution boundary.

## Development

```bash
npm test
npm run typecheck
npm run check
```

## Relationship to pi-subagents

Use `pi-subagents` directly for one-off delegation or advanced chain features
not yet supported by the native declarative executor, such as dynamic structured
fanout. Use `pi-dynamic-workflows` when orchestration should be named,
inspectable, reusable, and visible in `/workflows` or `/agents`.
