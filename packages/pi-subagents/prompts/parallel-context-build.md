---
description: Parallel context builders for planning handoff
---

Launch fresh-context `context-builder` subagents in parallel to build grounded handoff context for planning or implementation.

This recipe is not valid under strict no-artifact wording such as `do not write artifacts`, `no files`, or `inline only`; use parent-only synthesis or ask to relax the constraint. If the user says only `no repo artifacts`, `no project artifacts`, or `don't write .scratch files`, use inline advisory mode instead: set top-level `artifacts: false`, every child `output: false`, every child `progress: false`, and do not configure chain output paths.

Use the `subagent` tool in chain mode with a single parallel step, not top-level parallel tasks, so relative output files live under the temporary chain directory. Use `context: "fresh"` unless I explicitly ask for forked context. Give every parallel task a distinct `output` path, for example:

- `context-build/request-and-scope.md`
- `context-build/codebase-and-patterns.md`
- `context-build/validation-and-risks.md`

Do not write these context artifacts into the repository unless I explicitly ask for persistent files. Under repo-scoped no-artifact constraints, omit these `output` paths and keep all findings inline.

Primary request, target, or focus from the user request:

$@

If the invocation provides a URL, issue link, file path, plan path, or freeform request, read or fetch that target before assigning builder angles, then pass the target explicitly into every `context-builder` task.

Choose two or three strong builders based on the request. Prefer three only when the scope benefits from independent context slices. These are examples, not fixed defaults:

1. Request and scope
   Clarify the actual goal, user intent, constraints, non-goals, open questions, and decisions that affect the handoff.

2. Codebase and patterns
   Inspect relevant files, call paths, existing abstractions, tests, package constraints, and local conventions that the next agent must follow.

3. Validation and risks
   Identify likely failure modes, edge cases, test strategy, commands to run, dependency/API concerns, and escalation rules.

Adapt the angles when the request calls for it:

- Issue or PR URL: include issue requirements, acceptance criteria, linked discussion, and likely affected files.
- Plan file: include plan consistency, missing context, implementation sequence, and validation readiness.
- External API/library work: use parent-provided context7 evidence when available; otherwise use local source, official docs, source repos, `code_search`, or web search.
- Large refactor: include module boundaries, dependency direction, migration/cutover risks, and testability.
- UI/product work: include user flow, accessibility, copy, visual constraints, and implementation touchpoints.

Ask each builder to produce a compact handoff file with:

- relevant files and line ranges;
- key snippets or patterns, not full dumps;
- constraints and invariants;
- risks and unknowns;
- validation commands or next-best checks;
- a `meta-prompt` section for the next planner or role subagent.

After the builders return, synthesize their outputs into:

- the most important context the next agent needs;
- the recommended meta-prompt to use next;
- open questions or assumptions;
- the output artifact paths.

Do not start implementation from this command unless I explicitly ask for it.
