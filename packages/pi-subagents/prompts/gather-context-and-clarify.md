---
description: Use subagents to gather context, then ask clarifying questions
---

Clarify the user's request before planning or implementation. Launch focused context-gathering subagents first when local or external context is needed to ask good questions.

Primary request, uncertainty, or decision to clarify:

$@

Use `scout` to inspect the relevant local files, existing patterns, constraints, tests, and likely integration points. Use `researcher` when external docs, recent sources, ecosystem context, or primary evidence would improve the answer. For library/framework documentation, use parent-provided context7 evidence when available; otherwise use local source, official docs, source repos, `code_search`, or web search.

Give each subagent a specific meta prompt. Ask them to return concise findings plus the remaining clarification questions that matter for implementation confidence.

After they return, synthesize what we know and use the structured question tool available in this environment to ask me the unresolved questions needed to reach a shared understanding. Prefer `ask_user`; use `interview` only if it is installed. Ask exactly the questions that materially affect scope, acceptance criteria, constraints, or non-goals.
