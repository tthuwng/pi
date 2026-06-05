---
description: Adversarial debate workflow with proposals, attacks, and parent synthesis
---

Run an adversarial debate on a decision, design, plan, claim, implementation direction, or ambiguous problem.

Debate target:

$@

This workflow exists to make agents fight the framing instead of converging politely. Use it when the problem is ambiguous, high-impact, architecture/product/security-relevant, or when the parent agent may be anchoring on its own plan.

Use the `subagent` tool with fresh context unless I explicitly ask for forked context. Before launching children, hydrate the target: read/fetch the referenced file, diff, URL, issue, PR, plan, log, screenshot, or quoted claim enough to name the concrete scope. Include that concrete target and any relevant paths/links in every child task. Do not ask children to edit files. The parent owns final synthesis and user-facing decisions. Do not satisfy this prompt with a single inline pro/con list when subagents are available; the value comes from independent proposals and adversarial attacks. Use `output: false` for concise advisory passes. If output artifacts are useful, set an explicit output path and `outputMode: "file-only"`; use an absolute path when the artifact must land in a specific repo `.scratch/` directory. For foreground tool-call chain steps, relative outputs are chain-artifact-local; for top-level `tasks`, relative outputs resolve against `cwd`; slash-command background `/chain` relative outputs resolve against cwd or the step cwd.

Protocol:

1. Independent proposals or positions.
   Launch two to four children with different assumptions. At least one should propose the obvious path, one should propose a simpler/smaller path, and one should propose a materially different alternative when such an alternative exists.

2. Adversarial attacks.
   Launch skeptical reviewers to attack the strongest proposals, the parent's framing, and any hidden requirements. If proposal artifacts exist, pass them explicitly to attackers.

3. Optional rebuttal/repair.
   If disagreement is sharp and useful, ask a child or the parent to repair the best proposal against the strongest objections.

4. Parent synthesis.
   Compare conflicts by rubric, surface the strongest counterargument to the chosen or preferred path, reject weak claims, ask the user when the decision changes product, architecture, security, data, or scope.

Required quick runtime shape when subagents are available: use runtime chain fan-out/fan-in so the attack pass sees concrete proposal output. Saved `.chain.md` files are sequential-only today, so use the `chain` array directly:

```typescript
subagent({
  chain: [
    {
      parallel: [
        { agent: "delegate", task: "Proposal A for <target>", output: "adversarial-debate-proposal-a.md", outputMode: "file-only", progress: false },
        { agent: "delegate", task: "Proposal B for <target>", output: "adversarial-debate-proposal-b.md", outputMode: "file-only", progress: false },
        { agent: "delegate", task: "Proposal C for <target>", output: "adversarial-debate-proposal-c.md", outputMode: "file-only", progress: false },
      ],
      concurrency: 3,
    },
    {
      parallel: [
        { agent: "reviewer", task: "Read the proposal artifact paths referenced in {previous}, then attack those proposals. Focus on correctness, hidden requirements, and evidence gaps.", output: "adversarial-debate-attack-correctness.md", outputMode: "file-only", progress: false },
        { agent: "reviewer", task: "Read the proposal artifact paths referenced in {previous}, then attack those proposals. Focus on simplicity, implementation risk, and validation.", output: "adversarial-debate-attack-simplicity.md", outputMode: "file-only", progress: false },
      ],
      concurrency: 2,
    },
  ],
  context: "fresh",
});
```

Before parent synthesis, read every saved file-only artifact referenced by the subagent results, including attack outputs from chain fan-in steps. Parent synthesis rubric:

- Which proposal best satisfies the explicit goal?
- Which proposal is simplest without losing required behavior?
- Which risks are proven versus speculative?
- What is the strongest counterargument to the preferred path?
- What evidence is missing?
- Which choice requires user approval?
- What is the next bounded action?

Do not declare consensus just because children overlap. Preserve real disagreement and state why you choose, defer, or ask.
