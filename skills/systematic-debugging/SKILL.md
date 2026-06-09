---
name: systematic-debugging
description: Structured debugging workflow — root-cause investigation before fixes. Use for bugs, test failures, crashes, flaky behavior, build failures, or unexpected output before proposing or implementing changes.
---

# Systematic Debugging

No fixes without root-cause evidence.

Random changes waste time and create new bugs. Follow the phases in order.

## Phase 1: Observe

Read the actual failure completely.

- Read the full error, stack trace, command output, or symptom report.
- Identify exact file, line, function, test, request, or data path involved.
- Reproduce with the narrowest safe command unless reproduction is impossible, unsafe, or already captured in reliable evidence.
- Check current diff and recent read-only history if relevant.
- Use tree-sitter/LSP to inspect failing symbols before broad reads.

Do not propose a fix in this phase.

## Phase 2: Trace Root Cause

Find where the bad value, state, or behavior originates.

- Trace inputs and outputs across each boundary.
- Compare expected vs actual values.
- Inspect callers and callees when necessary.
- Check configuration, environment, mocks, fixtures, and test setup.
- Find similar working code in the same project.

Fix at the source, not at the symptom.

## Phase 3: Form One Hypothesis

State exactly:

```text
I believe the failure occurs because <specific cause>, based on <evidence>.
Confidence: <low|moderate|high>.
```

Mark uncertain claims as `**[ASSUMPTION: ...]**`.

Do not hold multiple vague hypotheses and edit for all of them.

## Phase 4: Test the Hypothesis

Before implementing the fix:

- Use the smallest read, probe, command, or temporary inspection that can validate the hypothesis.
- Change only one variable if a code change is needed to test.
- If wrong, return to observation with the new evidence.

Do not stack fixes on an unverified guess.

## Phase 5: Fix

Once root cause is supported:

1. Select the TDD scenario.
2. Add or identify a regression test when behavior changed or bug risk is meaningful.
3. Make the minimal root-cause fix.
4. Run the narrow reproduction/test.
5. Run broader relevant checks.

No “while here” refactors unless the fix requires them.

## When 2 Fix Attempts Fail

If two attempted fixes fail or each fix reveals a new symptom:

- stop,
- summarize attempts and evidence,
- question the architecture or original plan,
- ask the user before continuing.

This is usually a design/model problem, not a need for one more patch.

## Red Flags

Stop if you catch yourself thinking:

- “It is probably X; I'll just change it.”
- “Quick fix first, investigate later.”
- “Try several things and see.”
- “The stack trace is long; skip to the bottom.”
- “Tests are annoying; manually verify.”
- “One more fix attempt” after repeated failures.
- “This reference is long; skim and adapt.”

## Reporting

A debugging report should include:

- observed symptom and reproduction,
- root-cause evidence,
- hypothesis and confidence,
- fix made,
- regression test or reason none was added,
- verification commands/results,
- remaining risks.
