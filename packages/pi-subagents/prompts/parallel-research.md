---
description: Parallel subagents research
---

Launch parallel research subagents to build a grounded answer to the current question or decision.

This workflow is quality-first. Use enough independent evidence to avoid single-context bias, self-preferential conclusions, and stale assumptions. Use fresh context, not forked context, unless I explicitly ask for forked context. Researchers and scouts should inspect sources directly instead of relying on the main conversation history.

Use a combination of `researcher` and `scout` subagents:

- Use `researcher` for web, docs, standards, ecosystem, recent changes, benchmarks, and primary-source evidence.
- Use `scout` for local codebase context, existing implementation patterns, repo constraints, and files that would be affected.

Give each subagent a distinct angle. Unless I specify angles, use these three:

1. External evidence
   Use `researcher` to find current, authoritative sources: official docs, specs, release notes, benchmarks, issue threads, or primary explanations.

2. Local code context
   Use `scout` to inspect the repository for relevant files, existing patterns, constraints, tests, and likely integration points.

3. Practical tradeoffs
   Use `researcher` or `scout`, whichever fits the question, to compare options, risks, edge cases, maintenance cost, and what would be easiest to validate.

Adapt the angles when the question calls for it:

- Library/API questions: use parent-provided context7 evidence when available; otherwise use official docs, source repos, local source, `code_search`, or web search. Include recent examples only when primary documentation/source is insufficient.
- Architecture decisions: include local module boundaries, dependency direction, and migration cost.
- Debugging questions: include likely failure modes, local call paths, and exact error evidence.
- UI/product questions: include user flow, accessibility, design precedent, and implementation constraints.
- Time-sensitive topics: include a recent-developments angle and prefer 2026/2025 sources.

Prefer three strong subagents for normal research decisions. Use four or five when the decision is high-impact, architecture-heavy, security-sensitive, ops-heavy, or strongly ambiguous. Do not spawn many vague ones. The parent agent should frame the question and assign angles; the child agents should research, scout, or adversarially critique evidence, not invent broad plans.

Ask each subagent to return concise findings with evidence:

- file paths and line ranges for local findings
- source links for external findings
- confidence level and gaps
- recommended next step or decision implication

Do not ask subagents to edit files. Prefer `outputMode: "file-only"` with distinct output paths for large research outputs, or `output: false` for concise advisory passes. This is a research pass only unless I explicitly ask for implementation.

After the subagents return, synthesize the answer into:

- what we know
- what the local codebase implies
- tradeoffs and risks
- gaps or assumptions
- the recommended next move

If findings disagree, call out the disagreement instead of smoothing it over. State the strongest counterargument to the recommendation and what evidence would change it.

$@
