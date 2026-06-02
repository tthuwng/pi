# How to Use Pi

## Starting a session

```bash
cd ~/your-project
pi
```

First time in a project: say "learn the codebase" — scans conventions, structure, instruction files.

## The 3 tiers

**Small fix** — just say it. "Fix the type error in auth.py line 45." Pi does it directly.

**Feature work** — describe what you want. "Add a rate limit endpoint." Pi discusses the approach, you approve, it delegates to worker agents.

**Big changes** — "Redesign the queue system." Pi writes a plan to `.scratch/plans/`, marks assumptions as `[ASSUMPTION: ...]`. You review, challenge, approve. Workers implement. Reviewer checks.

You don't pick the tier — pi decides. Say "wait" or "let's talk" to slow it down.

## Slash commands

| Command               | What it does                                                                |
| --------------------- | --------------------------------------------------------------------------- |
| `/todos`              | Visual todo manager — see, create, filter, close todos                      |
| `/answer`             | When pi asks multiple questions, answer them one by one in a TUI            |
| `/files` or `/diff`   | Fuzzy file browser — pick to open, reveal, or diff                          |
| `/continue`           | Context getting large — distill conversation, start fresh session           |
| `/skill:self-improve` | End-of-session retrospective — analyze what went well/poorly, update config |

## While coding with an editor MCP

If an editor MCP is configured, Pi can inspect open buffers, cursor position, selections, and diagnostics. Ask it:

- "What file do I have open?"
- "Check the diagnostics in my editor"
- "Read the selection in my buffer"

You don't need to describe what you're looking at.

## Context management

- Core pi auto-compaction stays enabled
- compact-advisor queues a follow-up continuation after threshold compaction
- Use `/continue` manually to start fresh with context preserved in `.scratch/sessions/`
- Research and plans go to `.scratch/` files, not into conversation context
- Quick lookups stay in context, deeper research goes to files

## Debugging

When something breaks, pi should: read error → hypothesize → verify → fix. If it starts guessing or flailing, say "debug this systematically" to trigger the debugging skill.

## Code review

After implementation, say "review the changes." Pi dispatches a reviewer agent that writes findings to `.scratch/reviews/` categorized as must-fix / should-fix / nit.

## End of session

Run `/skill:self-improve` to do a retrospective. Pi analyzes what went well/poorly, suggests config improvements, you approve which to apply. This is how the config improves over time.

## Git

Pi never touches git. It reads diffs, logs, blame, status — but all staging, committing, pushing is you. When ready to commit, pi advises on the commit message via the commit skill. You run the git commands.

Use the git workflow configured for your repository. Host- or team-specific git tooling belongs in `APPEND_SYSTEM.md`.

## Tool priority

Pi uses tools in this order:

1. **tree-sitter** — symbol_definition, search_symbols, document_symbols, pattern_search (always first for code)
2. **context7** — library/framework docs (never guesses)
3. **Project-specific analysis tools** — call chains, blast radius, or semantic impact tools when configured
4. **Preferred CLIs** — use the tools configured for the current host and project
5. **Grep/Glob/Read** — when tree-sitter doesn't apply

## Local host customization

Machine-, editor-, package-manager-, clipboard-, database-, git-workflow-, and cloud-specific details belong in `APPEND_SYSTEM.md`. Replace that file with your own local environment before reusing this config.

## Agent roles

| Role                 | What it does                                         | When                 |
| -------------------- | ---------------------------------------------------- | -------------------- |
| main (gpt-5.5)       | Plans, coordinates, talks with you, does small edits | Always               |
| scout (gpt-5.4-mini) | Fast read-only recon, writes to .scratch/research/   | Research phase       |
| worker (gpt-5.4)     | Implements from exact instructions, runs checks      | Implementation phase |
| reviewer (gpt-5.4)   | Reviews against plan, writes to .scratch/reviews/    | After implementation |
