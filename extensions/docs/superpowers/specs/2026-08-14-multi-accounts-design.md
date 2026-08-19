# Multi-Accounts Extension Design

## Goal

Provide a maintained, public Pi extension package for multiple subscription accounts without storing credentials, personal account labels, or machine-specific paths in Git.

## Supported account model

- Anthropic accounts are represented by distinct local subscription entries and authenticated through Pi's current Anthropic OAuth flow.
- ChatGPT Codex accounts are represented by distinct local subscription entries and authenticated through Pi's current OpenAI Codex OAuth flow, including browser and device-code login where Pi supports it.
- xAI/Grok remains a native Pi provider. A single Grok account is configured with Pi's normal `/login` flow and is not cloned into a pool because this package is focused on duplicate subscription accounts.
- GitHub Copilot, Gemini CLI, and Antigravity remain available when the installed Pi runtime exposes their provider OAuth flows, matching the upstream extension behavior.

## Runtime architecture

The `multi-accounts/index.ts` extension is based on the upstream `pi-multi-pass` feature set and is maintained in this repository. It registers cloned providers and models, `/subs` account management, `/pool` routing and failover, `/mp-preset`, quota/limit reporting, project restrictions, and project-aware pool selection.

The extension has two compatibility layers:

1. `lib/auth-compat.ts` adapts Pi 0.84.2+'s `ModelRegistry` and credential store to the small `hasAuth/get/logout` interface used by the pool/account logic. Logout preserves the existing `auth.json` file mode and never logs credential values.
2. `lib/oauth-compat.mts` adapts the current `pi-ai` provider OAuth interface to the legacy extension callback shape, including Codex OAuth where the compatibility export is type-only.

## Configuration and privacy

- Global account metadata and pool definitions live in `~/.pi/agent/multi-pass.json`.
- Project-specific pool overrides live in `.pi/multi-pass.json`.
- `multi-pass.json` is local-only and must not be symlinked into the public config repository.
- `multi-pass.example.json` contains generic labels only.
- `auth.json`, model stores, runtime state, and generated dependencies are never tracked.

## Verification contract

- Pure compatibility and routing tests run without network calls or real credentials.
- A source check rejects obsolete `@mariozechner` imports, direct `authStorage` access, and direct Codex OAuth calls.
- The installed extension is loaded through Pi and `pi --list-models` completes without startup extension errors.
- The public repositories contain no credential-shaped data or personal labels.
