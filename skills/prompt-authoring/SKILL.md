---
name: prompt-authoring
description: Write or revise system prompts, agent prompts, tool prompts, skills, and workflow instructions. Use when changing prompt wording, adding a skill, designing tool guidance, or reviewing prompt quality.
---

# Prompt Authoring

Prompts are executable policy. Write them as operational instructions, not prose essays.

## Start With Placement

Before editing prompt text, identify the narrowest owner:

| Need | Preferred location |
|---|---|
| Always-on safety or workflow policy | `AGENTS.md` |
| Task-specific workflow | `skills/<name>/SKILL.md` |
| Child-agent behavior | `agents/<name>.md` |
| Reusable multi-agent sequence | `chains/<name>.chain.md` |
| Tool-specific usage or failure handling | tool `description`, `promptSnippet`, or `promptGuidelines` |
| One-off instruction | user prompt or plan file |

Do not duplicate broad policy across many prompts. Point to the canonical owner when possible.

## Structure

Use skimmable sections:

1. **Trigger:** when to use this instruction.
2. **Goal:** what good output achieves.
3. **Procedure:** ordered actions or decision table.
4. **Constraints:** explicit must/must-not rules.
5. **Evidence:** what to verify before claiming success.
6. **Anti-patterns:** common wrong behavior to avoid.

Prefer tables for routing choices and short checklists for completion gates.

## Language Rules

- Use direct normative verbs: `must`, `do`, `do not`, `ask`, `verify`, `stop`.
- Avoid vague preference words: `ideally`, `try to`, `where possible`, `consider` unless optionality is intentional.
- Use observable conditions instead of intent: “when changing public behavior” beats “for important changes.”
- Put the decision rule before examples.
- Keep examples concrete and local to the repo/tool.
- Remove motivational filler and generic best-practice language.

## Density Rules

Keep:

- safety gates,
- exact commands or file locations,
- failure modes,
- required evidence,
- user-facing output contracts,
- examples that prevent likely mistakes.

Delete:

- restatements of obvious tool behavior,
- version history,
- implementation internals the agent cannot act on,
- broad philosophy not used in a decision,
- duplicate rules already owned by `AGENTS.md`.

## Tool Prompt Guidance

Tool prompts should teach:

- when to use the tool,
- required and optional inputs,
- safe defaults,
- bounded output behavior,
- examples of valid calls,
- what failure means and the next safe step,
- anti-patterns that cause harm.

Tool prompts should not include:

- private implementation details,
- telemetry/logging details irrelevant to use,
- outdated compatibility paths,
- generic “be careful” wording without a concrete gate.

For custom tools, name the tool in every prompt guideline because Pi appends guidelines flat into the global prompt.

## Review Checklist

Before calling prompt work ready:

- The trigger is specific enough for skill/resource selection.
- Required user approvals and safety gates are explicit.
- The prompt tells the agent how to verify the result.
- There is no silent behavior, architecture, data, security, or workflow decision.
- It matches local style: concise, direct, and evidence-first.
- It does not weaken existing project instructions.
