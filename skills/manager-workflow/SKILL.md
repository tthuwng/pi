---
name: manager-workflow
description: Core delegation and workflow orchestration — 3-tier task routing with .scratch/ workspace. Use when asked to implement features, build systems, refactor code, create new services, migrate libraries, redesign architecture, or any multi-step implementation work.
---

# Manager Workflow

## Tier Assessment

Before starting any implementation, assess the tier and state the classification in chat.

For non-trivial work, the expanded workflow is:

```text
Clarify/Brainstorm → Plan → Approve → Execute → Verify → Review → Finish/Handoff
```

Use the added workflow skills as needed, but do not let them override this planning gate. If uncertain, pause and ask instead of continuing with assumptions.

### Planning Gate

Do not edit code until the user approves if any of these are true:

- The user asks to "think where it lives", "decide where", "design", "architecture", or otherwise implies placement/design judgment.
- The change may touch more than one tracked file.
- The change requires tests or docs.
- The change introduces a new config flag, public parameter, environment variable, registry field, API surface, or behavior toggle.
- There are multiple plausible implementation locations.

For Tier 2 tasks, present a brief table with option, location/files, pros, cons, and recommendation. Include the expected test/verification strategy when known. Then ask for explicit approval.

Only Tier 1 may proceed without approval:

- One file
- Under ~20 changed lines
- No behavior/config/API surface decision
- No docs/tests needed
- Requirements are unambiguous

If unsure, classify as Tier 2.

Before the first mutating tool call, internally verify:

1. Did I state the tier to the user?
2. Is there any placement/design decision?
3. Will this touch tests/docs/config?
4. Did the user explicitly approve if Tier 2+?
5. Which TDD scenario applies if behavior changes?

If any answer requires approval, stop and ask. Do not continue into file edits, worker dispatch, or multi-step execution while a material question is unresolved.

### Clarification Checkpoints

Pause for user clarification before continuing when:

- the next action would edit files and the scope is not explicitly approved,
- there are two or more plausible implementation paths,
- a task could be solved by changing behavior, tests, docs, config, or workflow and the intended target is unclear,
- the next step would dispatch a worker with broad instructions,
- a plan batch contains more than one task and the user has not approved that batch,
- new information invalidates or materially changes the approved plan.

Ask one focused question, preferably with options and a recommendation. Do not ask questions tools can answer.

### Tier 1 — Just Do It

- Single file, clear intent, < ~20 lines
- No discussion needed. Make the change, show what you did.
- Verify before claiming done.
- Examples: fix a type error, rename a variable, add an import

### Tier 2 — Talk First

- Multi-file or ambiguous intent
- Present what you'd change, where, and why. Get approval.
- Include test/verification strategy when behavior changes.
- No plan files unless the discussion shows the task is really Tier 3.
- Examples: add a new API endpoint, refactor a module, fix a bug touching 3+ files

### Tier 3 — Write It Down

- Architectural, > 5 files, new systems, irreversible
- Write plan to `.scratch/plans/YYYY-MM-DD-<slug>.md`
- Mark every assumption: **[ASSUMPTION: ...]**
- Present summary. Wait for explicit approval.
- Implement via worker subagents with exact instructions.
- Examples: redesign a system, migrate libraries, build a new service

The user can always escalate. If they say "wait", "let's talk", or "hold on" — move up a tier.

## Workflow Skill Routing

Load or apply these skills when their trigger fits:

| Situation                                             | Skill                            |
| ----------------------------------------------------- | -------------------------------- |
| Vague idea, new behavior, design/placement decision   | `brainstorming`                  |
| Approved requirements need task breakdown             | `writing-plans`                  |
| New behavior, logic change, or bug fix implementation | `test-driven-development`        |
| Test failure, bug, crash, unexpected behavior         | `systematic-debugging`           |
| Code/spec/plan review or review feedback evaluation   | `review`                         |
| Before done/fixed/passing claims                      | `verification-before-completion` |

Do not stack heavy workflow on tiny Tier 1 edits.

## Delegation Rules

### Plan Execution Batches

Before executing an approved plan:

- Read the full plan.
- Re-check it against current code and project instructions.
- Stop if assumptions are stale, unsafe, or incomplete.
- Confirm approved batch scope before executing more than one task.

Default batch size:

- 1 task for risky, ambiguous, tightly coupled, or newly clarified work.
- Up to 3 tasks only for low-risk independent work when the user approved that batch size.

Progress tracking:

- Use `todo` for multi-session or user-visible state.
- Use `.scratch/sessions/` for local progress.
- Use repo-local `progress.md` only when explicitly instructed or already established.
- Do not create tracked progress files unless the project already uses them.

For each task:

1. Restate task scope.
2. Select TDD scenario.
3. Follow the plan exactly unless evidence shows it is wrong.
4. Run task verification.
5. Record results and risks.

Batch report:

```text
Tasks completed: <N>
Changed files: <paths>
Verification: <commands/results>
Review: <status/findings>
Blocked/risks: <none or details>
Ready for feedback.
```

Do not proceed past a requested checkpoint without feedback.

### Subagent Execution Policy

For approved plan execution with subagents:

- Use one fresh worker per task.
- Give exact file/function/change instructions.
- Include the TDD scenario and verification command.
- Workers write summaries to `.scratch/` or explicit output paths.
- Parent verifies worker claims from diffs, output, or rerun checks.
- Dispatch `reviewer` after implementation:
  1. spec compliance review against the approved task/design,
  2. code quality review when needed.
- Send must-fix findings back as focused worker tasks, then re-review the affected mode.
- Do not run parallel implementation workers unless the user has created isolated workspaces/worktrees and approved that execution mode.
- If two focused fix attempts fail, stop and ask; the plan likely needs redesign.

### Research Phase

- Dispatch scout agents for codebase exploration
- Scouts can run in parallel (e.g., 5 scouts analyzing different modules)
- Scouts write findings to `.scratch/research/`
- Read scout findings before planning

### Implementation Phase

- Worker agents get exact instructions: which files, which functions, what changes, line numbers
- Include the TDD scenario and verification command when behavior changes
- If you can't specify exactly, you haven't planned enough — go back to planning
- Workers run in sequence, not parallel
- Workers run checks before reporting done
- Workers write results to `.scratch/`, not back to main context

### Review Phase

- Dispatch reviewer agent after implementation
- Reviewer checks against the plan and coding standards
- For plan execution, prefer spec compliance review first, then code quality review
- Reviewer writes findings to `.scratch/reviews/`
- Address must-fix findings before presenting to user

### Completion Phase

- Run required checks and report evidence.
- Verify worker/subagent claims from actual output, diffs, or rerun checks before reporting completion.
- If the current branch has an open PR and the user explicitly asks to update the PR description/body, load the github skill and update only that PR description/body with what changed and how it was tested.
- Without an explicit user request for that exact PR description/body update, draft suggested PR text instead of mutating GitHub.
- When performing a requested PR body update, merge or append; never overwrite unrelated content.

## .scratch/ Workspace

Ensure `.scratch/` exists and is gitignored. Do not make unrelated setup edits such as adding `.scratch/` to `.gitignore` during a feature change unless the user approves or the edit is required for the requested change.

Organized:

- `research/` — scout findings
- `plans/` — change plans with [ASSUMPTION] annotations
- `reviews/` — reviewer output
- `sessions/` — session state for continuation

Quick lookups stay in context. Deeper research goes to files.
Check for existing .scratch/ files before re-researching.

## Stop Conditions

Stop and ask instead of improvising when:

- requirements conflict
- the approved plan is wrong
- a human review trigger activates
- implementation needs an unapproved product or architecture decision
- tests fail repeatedly and root cause is unclear
- a tool or plan asks for mutating git commands
