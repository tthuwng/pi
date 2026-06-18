# pi-dynamic-workflows

Claude Code-style dynamic workflow orchestration for Pi, packaged separately
from `pi-subagents`.

`pi-dynamic-workflows` provides named, inspectable, rerunnable workflow specs
and slash-command UX. It does not reimplement child-agent execution. It uses
`pi-subagents` as the backend for agents, chains, async execution, fork context,
worktrees, intercom, and status rendering.

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
- exportable workflow specs.

It intentionally does not run arbitrary JavaScript workflow scripts. Workflow
files are declarative JSON and agents remain the execution boundary. It also
does not implement a standalone agent-view daemon or experimental agent teams;
use `pi-subagents`, Pi sessions, tmux/worktrees, and future packages for those
lower-level session/team primitives.

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
