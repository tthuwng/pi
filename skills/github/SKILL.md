---
name: github
description: GitHub operations via gh CLI — PRs, issues, CI, API queries. Use when working with pull requests, GitHub issues, CI workflows, or any GitHub operations. Never use the GitHub MCP server.
---

# GitHub (gh CLI)

Use the `gh` CLI for all GitHub operations. Never use the GitHub MCP server.

## Common Operations

Read-only PR and CI inspection:

- `gh pr list`, `gh pr view <number>`
- `gh pr view --json number,url,headRefName,baseRefName,state`
- `gh pr view --json number,title,body,files,commits,reviews,comments,checks,url`
- `gh pr checks --json name,bucket,state,workflow,link`
- `gh pr checks --watch --fail-fast` when checks are pending
- `gh run list`, `gh run view <id>`, `gh run view <id> --log-failed`, `gh run watch <id>`
- `gh api repos/{owner}/{repo}/pulls/{number}/comments` for PR review comments
- `gh api repos/{owner}/{repo}/issues/{number}/comments` for PR discussion comments
- `gh issue list`, `gh issue view <number>`
- `gh issue view <number> --json number,title,body,state,labels,comments,url`
- `gh api repos/{owner}/{repo}/...` for other read-only API queries

## Read-Only Workflow

For PR or issue review, gather context without mutating GitHub:

1. Resolve the target with `gh pr view` or `gh issue view` and request explicit fields with `--json`.
2. Fetch comments/review threads only for the named PR or issue.
3. Inspect local diffs or checked-out files separately; do not assume GitHub metadata proves code behavior.
4. Use subagent reviewers only for read-only analysis unless the user explicitly authorizes fixes.
5. Report findings with links/IDs and local file evidence when available.

Do not implement OMP-style `pr://` or `issue://` URI assumptions in prompts. In this repo, GitHub data comes from bounded `gh` commands and explicit API endpoints.

Mutating operations require the user to explicitly ask for that exact action. One requested GitHub mutation does not authorize another. This skill documents command categories; it does not permit any mutation blocked by AGENTS.md or project rules:

- creating a PR with `gh pr create --title "..." --body-file /tmp/pr_body.md`
- editing a PR description/body
- posting a PR comment
- submitting a PR review
- creating an inline PR review comment
- creating an issue
- posting an issue comment

## PR Description Format

Use this format when drafting PR text or when the user explicitly asks to update a PR description/body:

```
## What changed
Concise summary. Key files/areas affected.

## Why
Motivation, context, problem being solved.

## How tested
Tests added/updated, manual checks, commands run.
```

When a PR is large or noisy, add reviewer guidance:

- separate core behavior files from generated, mechanical, or formatting-only files;
- name the best reviewer entry points;
- call out risky behavior changes, migration/order dependencies, rollout notes, and test coverage;
- recommend splitting the PR instead of polishing the description when the diff is too large or mixed to review safely.

## Rules

- Always use `--body-file` for multi-line PR bodies (avoids shell escaping issues).
- You may update a PR description/body, post a PR comment, submit a PR review, or create an inline PR review comment only when the user explicitly asks for that exact action.
- NEVER push, merge, close, reopen, label, assign, request reviewers, change PR bases, or create PRs unless the user explicitly asks for that exact operation.
- Check `gh auth status` if operations fail.
