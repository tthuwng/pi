---
name: verification-before-completion
description: Use before claiming work is done, fixed, passing, reviewed, or ready. Requires fresh evidence from commands, diffs, or explicit inspection and prevents trusting stale or subagent-only success claims.
---

# Verification Before Completion

Do not claim success without fresh evidence.

## Gate Function

Before saying work is done, fixed, passing, ready, clean, or complete:

- [ ] **Identify** what evidence proves the claim.
- [ ] **Run or inspect** the evidence after the latest relevant edit.
- [ ] **Read** the output/result, including exit code and failures.
- [ ] **Compare** evidence to the actual claim.
- [ ] **Report** the claim with evidence, or state the limitation directly.

If you cannot run a check, say so. Do not convert inability to verify into confidence.

## Claim Verification

When the user asks to verify a specific claim, restate it in falsifiable form before testing it.

Use this loop:

1. State the claim with condition, expected result, metric, or threshold.
2. Pick the smallest local surface that can disprove it.
3. Capture baseline evidence when available without mutating git state. Baseline may be existing failure output, logs, screenshots, a repro before the latest edit, prior artifacts, or a user-run command.
4. Capture treatment evidence after the relevant change using the same command, data, environment, and measurement surface when practical.
5. Compare artifacts directly.
6. Return one verdict: `VERIFIED`, `NOT VERIFIED`, or `INCONCLUSIVE`.

Do not use claim verification for vague claims such as “cleaner” or “better architecture”; ask for a measurable claim or use review mode instead.

## Evidence by Claim

| Claim                   | Required evidence                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| Tests pass              | Fresh test command output after edits                                                         |
| Typecheck/lint clean    | Fresh command output after edits                                                              |
| Bug fixed               | Reproduction or regression test passes                                                        |
| Feature complete        | Requirements/task checklist plus relevant tests                                               |
| CLI/TUI behavior        | Repo-native harness, tmux/PTY transcript, or screen capture showing the expected state change |
| Subagent completed task | Parent inspected subagent summary, diff, and verification                                     |
| Config/skill valid      | Frontmatter/path/reference validation or explicit inspection                                  |
| No behavior change      | Diff inspection showing prompt/docs/config-only change                                        |

For interactive CLI/TUI claims, prefer the repo's own harness first. If none exists, use a bounded tmux or PTY probe: capture the screen before acting, send one action, wait for a concrete prompt or screen pattern, then capture the result. Prefer deterministic waits over sleeps.

## Subagent Verification

Do not trust “worker says done” by itself.

Parent must inspect at least one of:

- changed files/diff,
- test output captured by worker,
- reviewer findings,
- relevant command output rerun by parent.

If parent cannot verify directly, report “worker reported X; I did not independently verify Y.”

## Completion Report Format

Use this shape:

```text
Changed: <files/areas>
Verification: <commands/evidence and results>
Review: <review status or not run>
Risks: <remaining risks or none known>
Next: <user-run git/PR steps if needed>
```

For explicit claim verification, include the verdict:

```text
Verdict: VERIFIED | NOT VERIFIED | INCONCLUSIVE
Claim: <falsifiable claim>
Evidence: <baseline/treatment/comparison>
Confounds: <none or specific limitation>
```

## Red Flags

Stop before claiming success if you are about to say:

- should work
- probably fixed
- seems fine
- all good
- done
- ready
- tests should pass

Replace with evidence or uncertainty.

## Config/Prompt Work

For agent config, skills, and prompts, verification may be inspection-based. Still make it explicit:

- skill directory name matches `name`,
- frontmatter has `name` and `description`,
- referenced skill names/files exist,
- JSON parses,
- package/resource discovery command ran if safe.
