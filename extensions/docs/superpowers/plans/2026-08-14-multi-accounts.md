# Multi-Accounts Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `tthuwng/pi-extensions` a working Pi 0.84.2-compatible multi-account package for Codex and Anthropic, while keeping xAI/Grok native and all credentials local.

**Architecture:** Vendor the upstream multi-pass account/pool behavior into `multi-accounts/index.ts`, combine the upstream auth-storage compatibility fix with the current Pi provider registry, and use the Codex OAuth compatibility bridge required by Pi 0.84.2. Keep pure adapters and regression checks separate from the large extension entrypoint so future provider changes can be tested without starting Pi.

**Tech Stack:** TypeScript extension loaded by Pi/jiti, Node.js test scripts, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, Pi local JSON auth/config stores.

**Spec:** `docs/superpowers/specs/2026-08-14-multi-accounts-design.md`

## Global Constraints

- Public repositories contain no credentials, credential-shaped values, personal account labels, or machine-specific paths.
- Runtime compatibility target is Pi `0.84.2` and the `@earendil-works/*` package namespace.
- `multi-pass.json` remains local-only; only the generic example is tracked.
- xAI/Grok uses Pi's native provider login and is not cloned into a multi-account pool.
- No zsh wrappers or edits to installed global packages.

---

### Task 1: Establish failing compatibility checks

**Files:**
- Create: `multi-accounts/tests/auth-compat-check.mjs`
- Create: `multi-accounts/tests/source-compat-check.mjs`
- Modify: `package.json` to add `test`

**Interfaces:**
- Tests consume `multi-accounts/lib/auth-compat.mjs` with injected `readStoredCredential` and file operations.
- Tests require `multi-accounts/index.ts` to use current namespaces and the adapter rather than obsolete APIs.

- [ ] **Step 1: Write the failing tests**

  Assert that the auth adapter reports `getProviderAuthStatus(provider).configured`, reads a credential through the current Pi helper, deletes only the requested provider on logout, and preserves mode `0600`. Assert that the extension source has no old namespace, direct `authStorage`, or direct `loginOpenAICodex` reference.

- [ ] **Step 2: Run the checks and verify the expected failure**

  Run `node multi-accounts/tests/auth-compat-check.mjs && node multi-accounts/tests/source-compat-check.mjs`.

  Expected: module/source assertions fail because the adapter and production implementation are not present yet.

### Task 2: Add current Pi auth and OAuth compatibility

**Files:**
- Create: `multi-accounts/lib/auth-compat.mjs`
- Create: `multi-accounts/lib/oauth-compat.mts`
- Create: `multi-accounts/tests/oauth-compat-check.mjs`

**Interfaces:**
- Produces `createAuthStorage(ctx, deps?)` with `{ hasAuth(provider), get(provider), logout(provider) }`.
- Produces `createOAuthInteraction(callbacks)` and `toOAuthCredential(credentials)` for the extension's provider templates.
- Consumes Pi 0.84.2 provider auth status, stored credential helper, and built-in OpenAI Codex OAuth provider.

- [ ] **Step 1: Implement the minimum auth adapter**

  Use `ctx.modelRegistry.getProviderAuthStatus(provider).configured` for auth status, `readStoredCredential(provider)` for reads, and an atomic temporary-file replacement for logout while retaining `auth.json` mode `0600`.

- [ ] **Step 2: Run the auth test and make it pass**

  Run `node multi-accounts/tests/auth-compat-check.mjs` and require exit code 0 with no credential values printed.

- [ ] **Step 3: Implement the OAuth callback bridge**

  Adapt Pi's current interaction callbacks to the extension OAuth callback shape and obtain Codex login/refresh functions from `builtinProviders().find(({ id }) => id === "openai-codex").auth.oauth`; do not import removed runtime symbols from `@earendil-works/pi-ai/oauth`.

- [ ] **Step 4: Run OAuth regression checks**

  Run `node multi-accounts/tests/oauth-compat-check.mjs` and require exit code 0.

### Task 3: Integrate account, pool, failover, and limits behavior

**Files:**
- Replace: `multi-accounts/index.ts`
- Create: `multi-accounts/NOTICE.md`
- Copy/update: `multi-accounts/tests/pool-edit-check.mjs`, `project-aware-limits-check.mjs`, `project-restriction-check.mjs`, `runtime-failover-check.mjs`, `subs-switch-check.mjs`, `subscription-limits-check.mjs`

**Interfaces:**
- Extension registers `/subs`, `/pool`, and `/mp-preset` and all upstream account/pool behaviors.
- Extension calls `createAuthStorage(ctx)` wherever account state is needed.
- Extension keeps provider templates for Anthropic, Codex, Copilot, Gemini CLI, and Antigravity; native xAI remains Pi-owned.

- [ ] **Step 1: Import the maintained upstream implementation with attribution**

  Use the upstream MIT implementation as the behavioral baseline, update imports to `@earendil-works/*`, add the two compatibility modules, and retain attribution in `NOTICE.md`.

- [ ] **Step 2: Replace every old auth-storage access**

  Route all account/pool/limit status, login, logout, and failover checks through the adapter. There must be no `ctx.modelRegistry.authStorage` expression in the entrypoint.

- [ ] **Step 3: Run the pure regression suite**

  Run `npm test` and require all routing, limits, project restriction, switching, and failover checks to pass.

### Task 4: Document generic setup and native Grok

**Files:**
- Modify: `README.md`
- Modify: `multi-accounts/README.md`
- Create: `multi-accounts/multi-pass.example.json`
- Modify: `.gitignore` if required

**Interfaces:**
- Documentation gives exact `/subs` commands for adding Codex and Anthropic accounts, `/pool` commands for routing, and Pi's native `/login` path for xAI.
- Examples use generic names such as `codex-1`, `codex-2`, `claude-1`, and never include local labels.

- [ ] **Step 1: Add the generic example and docs**

  Explain that authentication is interactive and credentials stay in Pi's local `auth.json`; show how to add three Codex slots and two Anthropic slots without putting secrets in Git.

- [ ] **Step 2: Verify the repository privacy contract**

  Run `rg -n -i 'hung2-vals|/Users/|Bearer |access_token|refresh_token|api[_-]?key|secret' . --glob '!node_modules/**' --glob '!.git/**'` and require no personal labels or credential values in tracked files.

### Task 5: Load the package through Pi and publish it

**Files:**
- Modify: package version and lock metadata only if Pi generates them

**Interfaces:**
- Public package source remains installable using `git:github.com/tthuwng/pi-extensions`.
- Local settings continue to reference the public package, while local auth/config stores remain untouched.

- [ ] **Step 1: Run static and package checks**

  Run `git diff --check`, `npm test`, and the privacy scan.

- [ ] **Step 2: Reinstall the public package into Pi's local package cache**

  Run `pi install git:github.com/tthuwng/pi-extensions` and then `pi --list-models`; startup must not emit `command:subs`, `hasAuth`, or missing OAuth export errors.

- [ ] **Step 3: Check the working tree and publish**

  Run `git status --short`, commit with `feat: make multi-accounts compatible with current pi`, push `main`, and re-run `pi --list-models` against the pushed package.
