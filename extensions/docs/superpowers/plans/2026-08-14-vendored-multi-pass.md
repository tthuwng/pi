# Vendored Multi-Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy account extension with a public, Pi 0.84.2-compatible fork of upstream `pi-multi-pass`.

**Architecture:** Vendor upstream source and tests under `multi-pass/`, preserve upstream command/pool behavior, and integrate the auth compatibility adapter inside that package. The root package manifest and the user’s public Pi settings will load only `multi-pass/extensions/multi-sub.ts`; credentials and runtime state remain outside Git.

**Tech Stack:** TypeScript extension source, Node.js ESM regression tests, Pi 0.84.2 extension APIs, GitHub-backed Pi package settings.

**Spec:** `docs/superpowers/specs/2026-08-14-vendored-multi-pass.md`

## Global Constraints

- Keep the public repository credential-free.
- Preserve `~/.pi/agent/auth.json` and `~/.pi/agent/multi-pass.json` in place.
- Keep upstream `pi-multi-pass` MIT attribution visible.
- Load one multi-account implementation only.
- Verify the original `/subs list` and `/reload` failure paths in a fresh Pi process.

---

### Task 1: Establish the fork boundary

**Files:**
- Create: `docs/superpowers/specs/2026-08-14-vendored-multi-pass.md`
- Create: `docs/superpowers/plans/2026-08-14-vendored-multi-pass.md`
- Create: `multi-pass/tests/auth-compat-check.mjs`

**Interfaces:**
- Produces the fork layout and the failing regression test used by later tasks.

- [x] **Step 1: Write the failing auth compatibility test**

  The test must assert that a Pi registry exposing only
  `getProviderAuthStatus()` receives a legacy `authStorage` facade with
  `hasAuth`, `get`, and `logout`, and that logout removes only the selected
  provider from a mode-preserving auth file.

- [x] **Step 2: Run the test to verify the expected failure**

  Run `node multi-pass/tests/auth-compat-check.mjs` from the repository root.
  It should fail because the vendored adapter does not exist yet.

### Task 2: Vendor upstream multi-pass

**Files:**
- Create: `multi-pass/extensions/multi-sub.ts`
- Create: `multi-pass/tests/*.mjs`
- Create: `multi-pass/README.md`
- Create: `multi-pass/NOTICE.md`
- Delete: `multi-accounts/`
- Delete: `multi-pass-compat/`

**Interfaces:**
- Provides the upstream `/subs`, `/pool`, and `/mp-preset` commands from
  `multi-pass/extensions/multi-sub.ts`.
- Provides the upstream test fixtures under `multi-pass/tests/`.

- [x] **Step 1: Copy the upstream source, tests, and documentation**

  Copy the pinned upstream checkout at commit `b9d9d1d` into `multi-pass/`.
  Preserve the upstream README behavior documentation and add a NOTICE file
  naming `hjanuschka/pi-multi-pass` and its MIT license.

- [x] **Step 2: Remove the two superseded implementations**

  Delete the tracked `multi-accounts/` and `multi-pass-compat/` trees after
  the vendored copy exists. No settings entry may reference either path.

- [x] **Step 3: Run the upstream tests**

  Run the vendored test commands from the root package script. The tests must
  pass before compatibility edits are introduced.

### Task 3: Integrate Pi auth compatibility inside the fork

**Files:**
- Create: `multi-pass/lib/auth-compat.mjs`
- Modify: `multi-pass/extensions/multi-sub.ts`
- Test: `multi-pass/tests/auth-compat-check.mjs`

**Interfaces:**
- Produces `createAuthStorage(ctx, options)` returning synchronous
  `hasAuth(provider)`, `get(provider)`, and `logout(provider)` methods.
- `hasAuth` delegates to `ctx.modelRegistry.getProviderAuthStatus(provider)`.
- `get` delegates to Pi’s `readStoredCredential(provider)`.
- `logout` edits only `auth.json`, preserves its existing mode, and never
  prints credential values.

- [x] **Step 1: Run the regression test in red state**

  Run `node multi-pass/tests/auth-compat-check.mjs`; confirm the failure is
  the missing adapter module or missing exported function.

- [x] **Step 2: Implement the minimal adapter**

  Add the adapter and replace direct `ctx.modelRegistry.authStorage` access in
  the vendored extension with one `getAuthStorage(ctx)` helper backed by the
  adapter. Keep command, pool, and retry logic otherwise unchanged.

- [x] **Step 3: Run the regression test in green state**

  Run `node multi-pass/tests/auth-compat-check.mjs`; expect the adapter check
  to pass with no credential values printed.

### Task 4: Repoint package and machine configuration

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `/Users/hungtran/pi/agent/settings.json`

**Interfaces:**
- The root package manifest loads only `./multi-pass/extensions/multi-sub.ts`.
- The Pi config contains one filtered GitHub package entry for that path and
  no npm `pi-multi-pass`, `multi-accounts`, or `multi-pass-compat` entry.

- [x] **Step 1: Update the manifest and docs**

  Replace the compatibility package entry with the vendored extension and
  document the fork/attribution and local-only auth files.

- [x] **Step 2: Update the linked Pi settings**

  Change the package list to the filtered vendored extension entry while
  leaving the MCP, web, lens, ponytail, and simplify packages unchanged.

- [x] **Step 3: Refresh the installed GitHub package**

  Run `pi update --extension git:github.com/tthuwng/pi-extensions` so the local
  cache contains the new fork commit.

### Task 5: Verify and publish

**Files:**
- Modify: `docs/superpowers/plans/2026-08-14-vendored-multi-pass.md`

- [x] **Step 1: Run full repository tests**

  Run `npm test` from `/Users/hungtran/pi-extensions`; expect all upstream and
  compatibility checks to pass.

- [x] **Step 2: Run Pi runtime checks**

  Run `pi --offline --no-session --no-tools -p 'respond with READY'`, then use
  a fresh interactive Pi process to run `/subs list`, `/subs status`, and
  `/reload`; none may emit `hasAuth` errors.

- [x] **Step 3: Audit state and diffs**

  Run `git diff --check`, inspect the package list, and verify no auth or
  multi-pass state file is tracked.

- [x] **Step 4: Commit and push**

  Commit the fork in `tthuwng/pi-extensions`, commit the settings/docs update
  in `tthuwng/pi`, push both `main` branches, and record the resulting hashes.
