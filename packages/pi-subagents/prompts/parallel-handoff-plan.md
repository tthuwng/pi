---
description: Parallel research/context builders into planner-ready handoff context
---

Use parallel subagents to understand the request, compare any external references, inspect the local codebase, and produce grounded planner-ready handoff context. This recipe prepares context for `manager-workflow`, `planner`, or `writing-plans`; it does not replace planning approval or authorize worker execution.

Primary request, target, or focus:

$@

Use `context: "fresh"` unless I explicitly ask for forked context. First read or fetch any URLs, issue links, PRs, screenshots, plans, docs, or local files mentioned in the request. Treat them as primary scope, not optional context.

Use the `subagent` tool in chain mode:

1. First step: a parallel group.
   - `researcher`, when the request includes external references, APIs, libraries, docs, current best practices, or prompt-guidance research.
   - `context-builder` for local codebase context.
   - Add a second `context-builder` only when the scope is large enough to benefit from a separate implementation-strategy pass.

2. Second step: a synthesis `context-builder` that reads the parallel findings and writes planner-ready handoff context and a meta-prompt for the next planning step.

Use distinct output paths under the chain directory. Example outputs:

- `handoff/external-reference.md`
- `handoff/local-context.md`
- `handoff/implementation-strategy.md`
- `handoff/final-handoff-plan.md`

Do not write these artifacts into the repository unless I explicitly ask for persistent files.

Role guidance:

External reference researcher:

- Study linked projects, docs, issues, examples, source code, or prompt guidance.
- For library/framework documentation, use parent-provided context7 evidence when available; otherwise use local source, official docs, source repos, `code_search`, or web search.
- Identify the behavior, API, implementation files, constraints, and transferable ideas.
- Conduct web research for non-library external evidence when needed. Use `web_search` if it is available; otherwise use whatever equivalent research capability is available.
- Return source links, repo paths, key evidence, risks, and what matters for this implementation.

Local context-builder:

- Read all files needed to fully understand the local issue, not just the first match.
- Follow imports, callers, tests, fixtures, configuration, docs, and adjacent patterns until the local problem, solution space, and validation path are clear.
- Return relevant file paths and line ranges, current architecture, constraints, tests, risks, and open questions.

Implementation-strategy context-builder, when used:

- Compare the external evidence against the local architecture.
- Propose the safest implementation shape, files likely to change, edge cases, validation commands, and decisions that need approval.
- Stay review/planning-only. Any implementation follow-on must re-enter `manager-workflow` and the applicable planning/approval path before worker launch.

Final synthesis context-builder:

- Read the parallel outputs and produce one concise planner-ready handoff.
- Include what the feature/change should do, what the external reference teaches, what the local codebase implies, the recommended approach, likely files to change, constraints, non-goals, validation, risks, and unresolved questions.
- End with a compact meta-prompt for the next planner or planning skill, not a worker-ready implementation prompt.

After the chain returns, synthesize the result for me with:

- the recommended approach;
- artifact paths;
- the final planner-ready meta-prompt;
- any questions or assumptions that remain.

Do not start implementation from this command. If I explicitly ask to implement after this handoff, re-enter `manager-workflow` first so tiering, approval, TDD, plan-file, and worker-dispatch rules still apply.
