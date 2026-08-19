# Vendored Multi-Pass Specification

## Goal

Replace the abandoned `multi-accounts` implementation and the separate
compatibility shim with a maintained, public fork of upstream `pi-multi-pass`
inside `tthuwng/pi-extensions`.

## Requirements

1. The public package must load the vendored multi-pass extension directly.
2. The old `multi-accounts/` implementation must no longer exist or load.
3. The standalone `multi-pass-compat/` package must no longer be required or
   loaded.
4. Account, pool, chain, and preset behavior from upstream `pi-multi-pass`
   must remain available.
5. Pi 0.84.2 must support `/subs list`, `/subs status`, pool views, and
   `/reload` without `authStorage.hasAuth` errors.
6. Auth state and subscription metadata must remain in the user’s existing
   local files; no credentials may enter the public repository.
7. Upstream attribution and MIT licensing must remain visible in the fork.
8. The repo-backed Pi settings must load only the vendored fork for
   multi-account behavior.

## Improvement boundary

The first improvement is the Pi 0.84.2 auth API integration: the fork will
use a local adapter around Pi’s current `getProviderAuthStatus()`, stored
credential reader, and logout-safe file handling. Further behavior changes
must be added as focused tests and commits on top of this fork.
