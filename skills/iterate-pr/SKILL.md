---
name: iterate-pr
description: Automated PR iteration loop — fix CI failures or review feedback, present changes, let the user push, then monitor and repeat. Use when asked to "iterate on PR", "fix CI", "PR is failing", "address review comments", or continuously iterate on fixes until checks pass.
---

# Iterate PR

Automate the fix -> present -> user pushes -> monitor -> check -> fix cycle for PRs. The agent never pushes.

## Workflow

1. **Check current state**: use `gh pr checks --json name,bucket,state,workflow,link` as the source of truth for PR-attached checks; use `gh pr view --json number,url,headRefName,baseRefName,state` for PR metadata.
2. **Identify failures**: read CI logs, PR review comments, and issue discussion comments. Extract the first actionable error before fixing.
3. **Fix issues**: use worker subagents for focused implementation when edits are needed.
4. **Verify locally**: run the same focused check or nearest local equivalent that CI runs.
5. **Present changes**: show the diff and validation evidence to the user for approval.
6. **User pushes**: user runs the appropriate version-control command; the agent never pushes or mutates git state.
7. **Monitor after user push**: use `gh pr checks --watch --fail-fast` when checks are pending, then re-run `gh pr checks --json name,bucket,state,workflow,link` to inspect the full check set.
8. **Repeat** if new failures appear.

## Rules

- Never push code — present changes and let the user push.
- Use `gh pr checks` rather than GitHub Actions-only commands when judging overall PR readiness; PRs can have non-Actions checks.
- Fix one category of failure at a time (lint, then tests, then type errors).
- If a failure is unclear, investigate before fixing.
- If a failure looks flaky, ask the user to retry or re-run it once when that requires a mutating GitHub action, then report the flake evidence instead of looping indefinitely.
- After 3 iterations without progress, stop and discuss with the user.
