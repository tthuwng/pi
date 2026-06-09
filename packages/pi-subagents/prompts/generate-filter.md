---
description: Generate diverse options, filter by rubric, and return the strongest choices
---

Generate and filter options for a scoped idea, clarified design space, test strategy, naming problem, implementation approach, research direction, or evaluation rubric.

Request:

$@

Use this when the scope and selection rubric are clear enough that many candidate ideas are useful but the final answer must be selective. The goal is not to return everything; it is to create diversity, dedupe, attack weak ideas, and keep the best options.

Entry guard: if the request is still a vague idea, new behavior, design/placement question, or unclear product/workflow decision, route through `brainstorming` first. Return to this recipe only after the target, constraints, and rough selection rubric are clear enough for independent option generation.

Use the `subagent` tool with fresh context unless I explicitly ask for forked context. Before launching children, hydrate the request: read/fetch any referenced file, diff, URL, issue, PR, plan, log, screenshot, or quoted claim enough to name the concrete scope. Include that concrete scope and any relevant paths/links in every child task. Do not ask children to edit files. The parent owns final selection and should preserve real tradeoffs. Once the entry guard is satisfied, do not satisfy this prompt by brainstorming alone when subagents are available; the value comes from independent generators and a filtering pass. Do not run scout-only fanout for this workflow. If local repo constraints matter, add at most one bounded `scout`, but still include option generator children and a reviewer/filter pass. Use `output: false` for concise advisory passes. If output artifacts are useful, set an explicit output path and `outputMode: "file-only"`; use an absolute path when the artifact must land in a specific repo `.scratch/` directory. For foreground tool-call chain steps, relative outputs are chain-artifact-local; for top-level `tasks`, relative outputs resolve against `cwd`; slash-command background `/chain` relative outputs resolve against cwd or the step cwd.

Protocol:

1. Generate diverse candidates.
   Launch parallel `delegate` or `researcher` children with distinct assumptions. Use `delegate` for general option generation and `researcher` for external examples/evidence. Use at most one bounded `scout` only when local repository constraints materially affect the option set. Use `reviewer` for critique/filtering, not as the only generator. Make at least one child optimize for boring/practical, one for ambitious/high-upside, and one for simplicity/minimality when those angles fit.

2. Filter and dedupe.
   Run a reviewer/filter pass over the generated options, not just a generic rubric pass. The filter should remove duplicates, reject low-evidence ideas, rank by rubric, and identify the strongest counterargument. Do not stop after the generator fanout; if the first call only generated options, immediately run the filter pass before answering.

3. Return top choices.
   Return a small set with pros, cons, risks, and next validation step.

After the entry guard is satisfied, required runtime shape when subagents are available: use runtime chain fan-out/fan-in so the filter pass sees concrete generated options. A top-level parallel call with only generator children is incomplete and must not be scored as success; the reviewer/filter pass is mandatory unless the parent explicitly explains why no child filter is possible and performs the filter over concrete child outputs itself.

```typescript
subagent({
  chain: [
    {
      parallel: [
        {
          agent: "delegate",
          task: "Generate practical, low-risk options for <request>. Optimize for ease of implementation and validation. Return ranked candidates with tradeoffs. Do not edit.",
          output: false,
          progress: false,
        },
        {
          agent: "delegate",
          task: "Generate ambitious, high-upside options for <request>. Optimize for quality and leverage, not cost. Return ranked candidates with tradeoffs. Do not edit.",
          output: false,
          progress: false,
        },
        {
          agent: "delegate",
          task: "Generate minimal/simplifying options for <request>. Attack unnecessary process and scope. Return ranked candidates with tradeoffs. Do not edit.",
          output: false,
          progress: false,
        },
      ],
      concurrency: 3,
    },
    {
      agent: "reviewer",
      task: "Filter generated options for <request>. Use the generated options in {previous}; dedupe, reject weak options, rank the strongest choices by rubric, and state the strongest counterargument. Do not edit.",
      output: false,
      progress: false,
    },
  ],
  context: "fresh",
});
```

Adapt agents to the request:

- Use `researcher` when external examples, names, docs, benchmarks, or market/ecosystem context matter.
- Use `scout` when options depend on local repository structure, tests, or implementation constraints.
- Use `reviewer` for critique, rubric building, dedupe, and ranking.

Before parent synthesis, read every saved file-only artifact referenced by the subagent results. Parent synthesis must include:

- rubric used;
- top 3-5 options only unless I ask for more;
- rejected categories or duplicates;
- strongest counterargument to the recommended option;
- recommended next validation step.

Do not pick a winner silently when the decision is taste/product/architecture/security-sensitive. Present a recommendation and ask if user approval is needed.
