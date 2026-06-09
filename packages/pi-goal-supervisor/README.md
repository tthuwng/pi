# pi-goal-supervisor

Local Pi extension that adds a session-scoped `/goal` command and continues work at safe idle boundaries until evidence-backed completion or a typed stop state. It has no built-in turn, no-progress, or wall-clock budget limit.

## Commands

- `/goal` or `/goal status` — show current goal status.
- `/goal <objective>` — start or replace the active goal.
- `/goal start <objective>` — explicit start.
- `/goal pause [reason]` — pause auto-continuation and abort the active turn when Pi exposes `ctx.abort()`.
- `/goal resume` — resume and queue one continuation when idle.
- `/goal stop [reason]` or `/goal clear` — stop auto-continuation and abort the active turn when possible.
- `/goal done <evidence>` — record completion evidence for judging.
- `/goal help` — show command usage.

## Safety contract

This package is deliberately non-invasive:

- It does not call `getActiveTools`, `setActiveTools`, `getAllTools`, or `registerTool`.
- It does not change tools, permissions, guardrails, MCP servers, memory, subagents, or Slipstream settings.
- It does not auto-approve shell commands, sudo, destructive actions, mutating git operations, cloud/database mutations, or Google Docs/Drive changes.
- It uses `pi.sendMessage(..., { deliverAs: "followUp", triggerTurn: true })` for supervisor continuations.
- It does not stop automatically after a fixed number of turns, repeated no-progress turns, or elapsed wall-clock time; use `/goal pause`, `/goal stop`, or `GOAL_BLOCKED` to stop it.

## Completion policy

The worker must emit one of these markers:

```text
GOAL_DONE: <specific evidence from transcript/artifacts/verifications>
GOAL_BLOCKED: <specific blocker and smallest safe requested human decision>
```

`GOAL_DONE` is not accepted by self-claim alone. The extension runs deterministic prechecks and then a model-backed judge when available. Judge failures are fail-closed as inconclusive/blocked rather than complete.

## State

Primary state is persisted as Pi session custom entries with custom type `goal-supervisor-state`. This makes state branch-scoped and reload/compaction friendly without writing project `.pi/` runtime files.

## Verification

```bash
(cd packages/pi-goal-supervisor && npm run check)
(cd packages/pi-goal-supervisor && node --experimental-strip-types -e "await import('./src/index.ts'); console.log('goal supervisor import ok')")
node -e "JSON.parse(require('fs').readFileSync('settings.json','utf8')); console.log('settings json ok')"
pi list | grep -A3 -B3 'pi-goal-supervisor'
```

A bounded live smoke was run with an isolated session dir under `.scratch/live-goal-supervisor/`.
