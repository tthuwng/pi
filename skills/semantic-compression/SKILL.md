---
name: semantic-compression
description: Compress long context into dense handoffs, summaries, continuation files, and memory notes without losing decisions, constraints, evidence, or unresolved risks.
---

# Semantic Compression

Compress meaning, not words. The output should let a fresh agent continue safely without rereading the full transcript.

## Use When

- Writing `.scratch/sessions/` continuation notes.
- Summarizing long investigations, reviews, or plans.
- Preparing memory notes from reusable debugging/workflow knowledge.
- Reducing a large proposal to an implementation handoff.
- Creating compaction instructions or reviewing a compaction summary.

## Preserve Always

Keep these even if they are verbose:

- User decisions, approvals, rejections, and exact scope.
- Safety constraints, approval gates, destructive-operation limits.
- File paths, commands, IDs, URLs, branch names, issue/PR numbers.
- Root-cause evidence and verification output.
- Failed approaches and why they failed.
- Current state: changed files, uncommitted artifacts, running processes, blockers.
- Open questions and assumptions marked as assumptions.
- Risks that affect next actions.

## Delete Aggressively

Remove:

- greetings, apologies, praise, and narrative filler,
- repeated tool outputs once the conclusion is captured,
- speculation that did not affect the decision,
- obvious restatements of repo policy,
- partial plans superseded by later decisions,
- raw logs unless an exact line is required for diagnosis.

## Format

Prefer this structure for handoffs:

```markdown
# Continue: <task>

## Objective
<current goal and scope>

## Decisions
- <decision> — <why/evidence>

## Current State
- <done/in progress/broken>

## Files
- `<path>` — <why it matters>

## Evidence
- `<command>` → <result>

## Next Actions
1. <specific next step>

## Risks / Assumptions
- **[ASSUMPTION: ...]**
- RISK: <risk and evidence>
```

For memory notes, prefer short runbooks with exact commands and verification over transcript summaries.

## Compression Tiers

| Tier | Keep | Drop |
|---|---|---|
| Handoff | task state, decisions, next action, risks | detailed reasoning, duplicate evidence |
| Plan | requirements, tasks, files, checks, assumptions | exploration chatter |
| Memory | durable root cause/runbook/gotcha | one-off task details |
| Review | verdict, findings, evidence, required fixes | unsubstantiated concerns |

## Quality Gate

A compressed summary is bad if a fresh agent would need to ask:

- what was approved,
- which files are safe to edit,
- what command failed or passed,
- which approach was rejected,
- what remains unresolved,
- whether a risky operation is authorized.

If any answer is missing, add it before handing off.
