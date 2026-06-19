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

- [ ] Did I state the tier to the user?
- [ ] Is there any placement/design decision?
- [ ] Will this touch tests/docs/config?
- [ ] Did the user explicitly approve if Tier 2+?
- [ ] Which TDD scenario applies if behavior changes?

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

| Situation                                                   | Skill                                                                                                             |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Vague idea, new behavior, design/placement decision         | `brainstorming`                                                                                                   |
| Approved requirements need task breakdown                   | `writing-plans`                                                                                                   |
| New behavior or logic change                                | `test-driven-development`                                                                                         |
| Bug, test failure, crash, flaky behavior, unexpected output | `systematic-debugging` first; use TDD for the fix after root cause is supported                                   |
| Code/spec/plan review or review feedback evaluation         | `review`; escalate to `pi-subagents` review patterns when parallel/adversarial/fresh review would improve quality |
| Before done/fixed/passing claims                            | `verification-before-completion`                                                                                  |

Do not stack heavy workflow on tiny Tier 1 edits.

## Subagent Recipe Routing

`pi-subagents` owns detailed natural-language recipe routing, prompt shortcut semantics, and proposal-verification mechanics. Do not duplicate its full recipe matrix here.

Implementation-specific routing rules:

- Load `pi-subagents` when independent context, adversarial pressure, or parallel evidence would materially improve implementation planning, review, research, handoff, or cleanup.
- Enter review requests through `review`, vague product/design requests through `brainstorming`, and implementation work through this skill before applying any subagent recipe.
- Apply fixes from review feedback only when the user explicitly authorizes writing; use one writer/fix pass at a time, then fresh review.
- If the user asks to verify or pressure-test a parent proposal before implementation, complete and inspect the proposal gate before scouting implementation locations or dispatching workers.
- For tiny Tier 1 edits, skip extra subagent process unless a concrete risk makes independent evidence materially useful.

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
- Do not run parallel implementation workers unless the user has created isolated workspaces/worktrees and approved that execution mode. If the request asks for parallel writers but clean worktrees/isolated workspaces are unavailable, refuse that shape or fall back to one writer plus parallel read-only reviewers/scouts; never launch workspace-mutation-capable implementation workers in the shared checkout.
- If two focused fix attempts fail, stop and ask; the plan likely needs redesign.

### Research Phase

- For nontrivial, ambiguous, high-impact, or externally grounded work, use quality-first fanout when independent evidence materially improves the plan.
- Route ordinary user language to the matching `pi-subagents` recipe; the user does not need to name a slash command. Keep detailed recipe examples in the `pi-subagents` skill so this workflow does not become a second routing authority.
- Dispatch scout agents for codebase exploration.
- Scouts can run in parallel (e.g., 5 scouts analyzing different modules) when their scopes are distinct.
- Give each child a distinct angle and output contract; avoid duplicate vague agents.
- For parallel scouts, pass `output: false` for concise findings or give every scout an explicit unique output path. Do not rely on a shared default artifact path.
- Scouts return findings inline or through parent-managed `.scratch/research/` output artifacts only when an explicit unique output path is provided.
- Read scout/research findings before planning.

### Implementation Phase

- Worker agents get exact instructions: which files, which functions, what changes, line numbers
- Include the TDD scenario and verification command when behavior changes
- If you can't specify exactly, you haven't planned enough — go back to planning
- Workers run in sequence, not parallel
- Workers run checks before reporting done
- Workers write results to `.scratch/`, not back to main context

### Review Phase

- Dispatch reviewer agents after implementation unless the change is truly Tier 1/trivial or the user requested no review.
- Prefer a fresh-context parallel review gate for nontrivial work when independent review materially improves evidence: correctness/regressions, tests/verification, and simplicity/maintainability. Add security, ops/resource, UX, or architecture reviewers when relevant.
- Use `/parallel-review` or `/quality-gate` patterns directly through `subagent(...)` when they fit.
- Use `/quick-adversarial-check` before committing to a diagnosis, architecture direction, or user-facing claim that has meaningful uncertainty.
- Reviewer checks against the plan and coding standards.
- For plan execution, prefer spec compliance review first, then code quality review when needed.
- Reviewer writes findings to `.scratch/reviews/` or returns concise inline output when artifacts are unnecessary.
- Parent synthesizes reviewer disagreements; do not blindly apply every suggestion.
- Address must-fix findings before presenting to user.

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
- a tool or plan asks for unapproved destructive, history-rewriting, credential-changing, or broad cleanup git commands
