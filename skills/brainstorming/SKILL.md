---
name: brainstorming
description: "Use before creative or non-trivial implementation work: new features, behavior changes, UI/API design, architecture choices, or ambiguous requirements. Refines intent into an approved design using code/docs inspection and focused user questions."
---

# Brainstorming

Turn a rough idea into a concrete design before implementation.

This is a discussion and design skill, not an implementation skill.

## Boundaries

Allowed:

- Read code, docs, config, tests, and recent read-only git state.
- Use scouts for read-only reconnaissance.
- Use `ask_user` for one focused decision at a time.
- Write design notes to `.scratch/plans/` for larger work.

Not allowed:

- Editing source, tests, config, docs, or prompts outside `.scratch/`.
- Making architectural/product decisions without user approval.
- Running mutating git commands.

## Process

### 1. Understand the current state

Before asking questions, inspect what can be answered from tools:

- relevant README/docs/instruction files
- nearby code and tests
- existing patterns and similar implementations
- current constraints from `AGENTS.md`

Use `scout` if the area is broad. Keep raw research in `.scratch/research/`.

### 2. Clarify intent

Ask only what tools cannot answer. If evidence does not settle user intent, defer to the user instead of choosing silently.

Rules:

- Ask one focused question per `ask_user` call.
- Do not proceed from clarification to planning or implementation while a material requirement, scope boundary, or design choice remains unresolved.
- Prefer structured options when there are clear choices.
- Include a short context summary in `ask_user` so the user sees why the question matters.
- Do not bundle unrelated questions.

Clarify:

- user goal and non-goals
- success criteria
- constraints and risks
- compatibility expectations
- testability expectations
- human review triggers

### 3. Explore approaches

Present 2–3 viable approaches when meaningful.

Use a table:

| Option | Summary | Pros | Cons | Risk | Recommendation |
| ------ | ------- | ---- | ---- | ---- | -------------- |

Lead with the recommendation and confidence level. If one option is clearly wrong, say so and explain why.

### 4. Validate design

For larger work, present the design in short sections and validate incrementally:

- architecture / placement
- data/control flow
- user-visible behavior
- error handling
- testing strategy
- rollout/cleanup

If the user corrects direction, revise the design before planning implementation.

### 5. Save material designs

For Tier 3 or complex Tier 2 work, write:

`.scratch/plans/YYYY-MM-DD-<topic>-design.md`

Include:

- goal and non-goals
- chosen approach and rejected alternatives
- assumptions marked as `**[ASSUMPTION: ...]**`
- affected files or systems
- risks and human review triggers
- open questions

Do not write to project docs unless the project behavior itself requires documentation updates.

## Handoff

After design approval:

- For multi-step work, use `writing-plans`.
- For tiny approved changes, return to `manager-workflow` Tier 1/2 execution.
- For unresolved design choices, keep asking one focused question at a time.

## Quality Bar

A brainstorm is not done until:

- the user's actual goal is clear,
- at least one simpler alternative was considered,
- risks are explicit,
- test strategy is plausible,
- the next step is either planning or a clearly bounded implementation.
