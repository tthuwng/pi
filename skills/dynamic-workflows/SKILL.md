---
name: dynamic-workflows
description: Claude Code-style dynamic multi-agent workflows for implementation, review, research, and agent supervision.
---

# Dynamic Workflows

Use `pi-subagents` when independent context or fresh review would improve the work.

Default implementation loop:

1. Scout the codebase.
2. Plan the smallest durable change.
3. Use one worker as the writer.
4. Run fresh reviewers in parallel when the change is nontrivial.
5. Send must-fix findings back to one worker.
6. Parent session verifies the final diff and checks.

## Routing

- Research or unfamiliar code: parallel scouts with separate scopes.
- Bug diagnosis: one scout for evidence, then one worker after the root cause is supported.
- Implementation: one worker, then review.
- Risky design choice: adversarial check before editing.
- Large cleanup: split into small approved chains.
- Final gate: quality reviewers plus direct parent verification.

## Agent Control

- Parent sessions own orchestration and synthesis.
- Child agents may contact the parent when blocked.
- Child agents do not launch other agents.
- Advisory agents are read-only.
- Use one writer unless isolated worktrees are approved.

## Commands

- `/parallel-review <task>` for fresh review fanout.
- `/quality-gate <task>` for implementation readiness checks.
- `/quick-adversarial-check <task>` for risky conclusions.
- `/run-chain implement-review -- <task>` for the default scout-worker-reviewer loop.
