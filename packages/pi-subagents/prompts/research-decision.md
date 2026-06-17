---
description: Research a decision with parallel evidence and adversarial tradeoff review
---

Use parallel subagents to research a decision and produce a grounded recommendation.

Decision, question, target, or focus:

$@

This workflow is quality-first. Use enough independent evidence to avoid single-context bias. Use fresh context unless I explicitly ask for forked context. Treat URLs, issue links, PRs, screenshots, local files, plans, logs, or quoted claims as primary scope; read or fetch them before launching children and include them explicitly in each child task.

Runtime policy:

- Use the `subagent` tool with a mix of `researcher`, `scout`, and `reviewer` depending on the question.
- Prefer three or four strong children when the decision involves external evidence plus local implementation consequences.
- Set `async: false` because the parent recommendation depends on child outputs.
- Do not ask children to edit files.
- Use `output: false` and `progress: false` only for concise advisory passes whose returned inline text the parent will inspect before recommending.
- If the user says `no repo artifacts`, `no project artifacts`, or `don't write .scratch files`, also set top-level `artifacts: false`.
- If the user says strict `do not write artifacts`, `no files`, or `inline only`, do not launch subagents; research parent-only or ask to relax that constraint.
- If findings may be large, need persistence, or may be needed across turns and artifacts are allowed, set an explicit output path and `outputMode: "file-only"`.
- For this top-level `tasks` shape, relative output paths resolve against `cwd`, not a temporary chain artifact directory; use absolute `.scratch/...` paths when the artifact must land in a specific repo.
- For foreground tool-call chain steps, relative outputs are temp/chain-artifact-local; slash-command background `/chain` relative outputs resolve against cwd or the step cwd.

Before parent synthesis:

- Never synthesize a recommendation from compact receipts, child session directories, or file-only pointers alone.
- Inspect actual inline child text or read each referenced saved artifact first.
- If repo-scoped no-artifact constraints leave only insufficient inline summaries, return `INCONCLUSIVE` or ask to relax the constraint.

Default angles:

1. External evidence researcher
   Find current primary sources, official docs, release notes, standards, source repos, benchmark data, issue threads, or credible explanations. For library/framework documentation, use parent-provided context7 evidence when available; otherwise use local source, official docs, source repos, `code_search`, or web search.

2. Local code/context scout
   Inspect repository files, existing patterns, constraints, tests, configuration, likely integration points, and local risks.

3. Practical tradeoff reviewer
   Compare options, attack hidden costs, migration/rollback risk, validation difficulty, maintainability, and second-order effects.

4. User-preference or ops-risk critic, when the decision has meaningful workflow, deployment, observability, supportability, or user-preference risk
   Check alignment with known user preferences, workflow friction, tmp/log/session pressure, deployment risk, observability, or supportability.

Recommended runtime shape:

```typescript
subagent({
  tasks: [
    {
      agent: "researcher",
      task: "Research external/current evidence for this decision: <decision>. Use primary sources where possible. Return source links, confidence, gaps, and decision implications. Do not edit.",
      output: false,
      progress: false,
    },
    {
      agent: "scout",
      task: "Inspect local repository context for this decision: <decision>. Return relevant files/line ranges, constraints, tests, likely affected areas, and local risks. Do not edit.",
      output: false,
      progress: false,
    },
    {
      agent: "reviewer",
      task: "Adversarially review tradeoffs for this decision: <decision>. Attack assumptions, hidden costs, validation difficulty, and safer alternatives. Do not edit.",
      output: false,
      progress: false,
    },
  ],
  concurrency: 3,
  context: "fresh",
  async: false,
});
```

After children return, read every saved file-only artifact referenced by the subagent results before synthesizing. Then synthesize:

- recommendation;
- strongest counterargument;
- local codebase implications;
- evidence quality and confidence;
- risks and unknowns;
- what would change the recommendation;
- whether the user must decide before implementation.

Do not smooth over disagreements. If child findings conflict, state the conflict and decide whether to investigate further, ask the user, or choose a bounded next step.
