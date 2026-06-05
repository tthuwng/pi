---
description: Quick adversarial check of an assumption, plan, or claim
---

Run a quick adversarial check before committing to an assumption, answer, plan, fix, or recommendation.

Target assumption, claim, plan, or focus:

$@

Use this when a full debate is too heavy but single-context self-review is not enough. This is designed to be cheap in wall-clock time but still adversarial. Before launching children, hydrate the target: read/fetch the referenced file, diff, URL, issue, PR, plan, log, screenshot, or quoted claim enough to name the concrete scope. Include that concrete target and any relevant paths/links in every child task. Use the `subagent` tool with fresh-context reviewers unless I explicitly ask for forked context. Do not ask children to edit files. Do not satisfy this prompt with inline self-critique only unless subagents are unavailable; if unavailable, say so explicitly.

Default shape: two or three reviewers, each with a different attack angle.

Required runtime shape when subagents are available:

```typescript
subagent({
  tasks: [
    {
      agent: "reviewer",
      task: "Quick adversarial check: attack this assumption/plan/claim for correctness and missing evidence: <target>. Return only concrete risks, disconfirming evidence, and what would change the answer. Do not edit.",
      output: false,
      progress: false,
    },
    {
      agent: "reviewer",
      task: "Quick adversarial check: find a simpler or safer alternative to this assumption/plan/claim: <target>. If no credible alternative exists, say why. Do not edit.",
      output: false,
      progress: false,
    },
    {
      agent: "reviewer",
      task: "Quick adversarial check: look for user-decision, scope, security, ops, or validation risks in this assumption/plan/claim: <target>. Do not edit.",
      output: false,
      progress: false,
    },
  ],
  concurrency: 3,
  context: "fresh",
});
```

For very small checks, use only the first two reviewers. For high-risk checks, run the quality-gate or adversarial-debate pattern instead.

Parent synthesis must be short:

- confirmed, weakened, or rejected;
- strongest objection;
- whether more investigation is needed;
- next action or user decision.

Do not bury the contradiction. If the check undermines your plan, say so and change course or ask the user.
