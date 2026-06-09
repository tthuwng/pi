# How to Use Pi

This is the human quick guide. Agent policy starts in `AGENTS.md`, with subagent roles in `agents/` and runtime behavior in `settings.json` / `mcp.json`.

## Start

```bash
cd ~/your-project
pi
```

First time in a repo: say `learn the codebase`.

## Work sizes

| Work           | What to say                              | What should happen                                                      |
| -------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| Small fix      | “Fix the type error in auth.py line 45.” | Pi edits directly, then verifies                                        |
| Feature/change | “Add a rate limit endpoint.”             | Pi discusses approach and waits for approval                            |
| Broad redesign | “Redesign the queue system.”             | Pi writes a plan first, waits for approval, then implements and reviews |

If Pi moves too fast, say `wait`, `hold on`, or `let's talk`.

## Useful commands

| Command               | Purpose                                                                         |
| --------------------- | ------------------------------------------------------------------------------- |
| `/answer`             | Extract questions from the last assistant message and answer them interactively |
| `/cc`, `/copy-code`   | Copy a fenced command/code block from recent assistant messages                 |
| `/context`            | Show current context/token usage details                                        |
| `/continue [slug]`    | Write a continuation note under `.scratch/sessions/` and start a fresh session  |
| `/files`              | Browse git/session-referenced files with reveal, open, edit, and diff actions   |
| `/goal`               | Run or manage a session-scoped continuation goal                                |
| `/slipstream`         | Inspect or run Slipstream compaction controls                                   |
| `/skill:self-improve` | End-of-session retrospective and config improvement suggestions                 |
| `/todos`              | Open the interactive todo manager                                               |

## Useful shortcuts

| Shortcut       | Purpose                                      |
| -------------- | -------------------------------------------- |
| `ctrl+.`       | Run the `/answer` question-answering flow    |
| `ctrl+shift+o` | Open the `/files` browser                    |
| `ctrl+shift+f` | Reveal the latest session file reference     |
| `ctrl+shift+r` | Quick Look the latest session file reference |

## Ask for these workflows

- `learn the codebase` — first-session orientation
- `debug this systematically` — root-cause debugging
- `write a plan first` — implementation plan in `.scratch/plans/`
- `review the changes` — reviewer pass
- `quality gate this` — adversarial review with a pass/fail/inconclusive synthesis
- `give me options` — generate/filter candidates
- `ask me what you need first` — gather context and clarify

## Editor MCP

If the editor MCP is available, Pi can inspect open buffers, cursor position, selections, and diagnostics. Useful prompts:

- “What file do I have open?”
- “Check editor diagnostics.”
- “Read my current selection.”

## Context management

- Automatic compaction is enabled; Slipstream auto-compaction writes artifacts under `.scratch/compactions`
- After qualifying threshold auto-compaction, `extensions/compact-advisor.ts` may queue an `auto-compaction-continue` follow-up turn when safe so the active task resumes without manual prompting
- Use `/continue` when context gets large or a clean handoff would help; this local extension writes a continuation file under `.scratch/sessions/` and opens a fresh session
- Research, plans, reviews, and continuation notes go in `.scratch/`
- Quick facts can stay in the conversation; durable runbooks should go to memory

## Git

Pi is instructed to read git state but not mutate it. Because this config uses `permissions.json` `yolo`, that is a prompt-policy rule backed by guardrails for many mutations, not a universal runtime confirmation gate. You stage, commit, push, branch, rebase, and merge.

When ready to commit, ask for a commit message; Pi will use the commit skill.

## Local customization

Change `APPEND_SYSTEM.md` for machine-specific facts: OS, editor, terminal, package manager, clipboard, database, version-control workflow, cloud tooling, and language-tool conventions.
