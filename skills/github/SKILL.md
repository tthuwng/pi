---
name: github
description: GitHub operations via gh CLI — PRs, issues, CI, API queries. Use when working with pull requests, GitHub issues, CI workflows, or any GitHub operations. Never use the GitHub MCP server.
---

# GitHub (gh CLI)

Use the `gh` CLI for all GitHub operations. Never use the GitHub MCP server.

## Common Operations

- `gh pr create --title "..." --body-file /tmp/pr_body.md`
- `gh pr list`, `gh pr view <number>`, `gh pr checks <number>`
- `gh issue list`, `gh issue create`, `gh issue view <number>`
- `gh run list`, `gh run view <id>`, `gh run watch <id>`
- `gh api repos/{owner}/{repo}/...` for anything else

## PR Description Format

```
## What changed
Concise summary. Key files/areas affected.

## Why
Motivation, context, problem being solved.

## How tested
Tests added/updated, manual checks, commands run.
```

## Rules

- Always use `--body-file` for multi-line PR bodies (avoids shell escaping issues).
- You may update PR descriptions, post PR comments, submit PR reviews, and create inline PR review comments when the user explicitly asks.
- NEVER push, merge, close, reopen, label, assign, request reviewers, change PR bases, or create PRs without explicit user approval for that exact operation.
- Check `gh auth status` if operations fail.
