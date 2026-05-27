/**
 * Plugin cache self-heal — fixes broken CLAUDE_PLUGIN_ROOT references.
 *
 * Claude Code's plugin auto-update can leave installed_plugins.json pointing
 * to a non-existent directory (anthropics/claude-code#46915). This module
 * detects and repairs the mismatch by creating symlinks.
 *
 * 4-layer defense:
 *   1. start.mjs startup — reverse heal (registry → symlink to us)
 *   2. server.ts first tool call — mid-session heal
 *   3. postinstall.mjs — backward symlink on new install
 *   4. global hook auto-deploy — survives total plugin cache breakage
 */
import { existsSync, readFileSync, symlinkSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
/**
 * Core heal: if installed_plugins.json points to a non-existent directory,
 * create a symlink from that path to our actual directory.
 *
 * @param currentDir - The directory we're actually running from
 * @param installedPluginsPath - Path to installed_plugins.json (injectable for testing)
 */
export function healRegistryMismatch(currentDir, installedPluginsPath) {
    const ipPath = installedPluginsPath ?? resolve(homedir(), ".claude", "plugins", "installed_plugins.json");
    if (!existsSync(ipPath))
        return { healed: false, action: "none" };
    if (!existsSync(currentDir))
        return { healed: false, action: "none" };
    let ip;
    try {
        ip = JSON.parse(readFileSync(ipPath, "utf-8"));
    }
    catch {
        return { healed: false, action: "none" };
    }
    for (const [key, entries] of Object.entries(ip.plugins ?? {})) {
        if (!key.toLowerCase().includes("context-mode"))
            continue;
        for (const entry of entries) {
            const registryPath = entry.installPath;
            if (!registryPath)
                continue;
            // Registry path exists — no healing needed
            if (existsSync(registryPath))
                continue;
            // Registry path doesn't exist — create symlink to our directory
            try {
                const parent = dirname(registryPath);
                if (!existsSync(parent))
                    mkdirSync(parent, { recursive: true });
                if (process.platform === "win32") {
                    // Windows: use junction (no admin required)
                    symlinkSync(currentDir, registryPath, "junction");
                }
                else {
                    symlinkSync(currentDir, registryPath);
                }
                return { healed: true, action: "symlink", from: registryPath, to: currentDir };
            }
            catch {
                return { healed: false, action: "none" };
            }
        }
    }
    return { healed: false, action: "none" };
}
/**
 * Deploy a global SessionStart hook that heals plugin cache mismatches.
 * This hook lives outside the plugin directory, so it survives cache breakage.
 *
 * Written to ~/.claude/hooks/context-mode-cache-heal.sh
 */
export function deployGlobalHealHook() {
    const hooksDir = resolve(homedir(), ".claude", "hooks");
    const hookPath = resolve(hooksDir, "context-mode-cache-heal.sh");
    // Already deployed
    if (existsSync(hookPath))
        return { healed: false, action: "none" };
    try {
        if (!existsSync(hooksDir))
            mkdirSync(hooksDir, { recursive: true });
        const script = `#!/usr/bin/env bash
# context-mode plugin cache self-heal — auto-deployed by context-mode MCP server
# Fixes anthropics/claude-code#46915: auto-update breaks CLAUDE_PLUGIN_ROOT
# This hook runs at SessionStart (global, not plugin-level) so it works even
# when the plugin cache is broken.

set -euo pipefail

PLUGINS_FILE="$HOME/.claude/plugins/installed_plugins.json"
[[ -f "$PLUGINS_FILE" ]] || exit 0

# Find context-mode entries and heal missing directories
node -e '
const fs = require("fs");
const path = require("path");
try {
  const ip = JSON.parse(fs.readFileSync(process.argv[1], "utf-8"));
  for (const [key, entries] of Object.entries(ip.plugins || {})) {
    if (!key.toLowerCase().includes("context-mode")) continue;
    for (const entry of entries) {
      const p = entry.installPath;
      if (!p || fs.existsSync(p)) continue;
      const parent = path.dirname(p);
      if (!fs.existsSync(parent)) continue;
      const dirs = fs.readdirSync(parent).filter(d => /^\\d+\\.\\d+/.test(d) && fs.statSync(path.join(parent, d)).isDirectory());
      if (dirs.length === 0) continue;
      dirs.sort((a, b) => {
        const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
        for (let i = 0; i < 3; i++) { if ((pa[i]||0) !== (pb[i]||0)) return (pa[i]||0) - (pb[i]||0); }
        return 0;
      });
      const target = path.join(parent, dirs[dirs.length - 1]);
      try { fs.symlinkSync(target, p); } catch {}
    }
  }
} catch {}
' "$PLUGINS_FILE" 2>/dev/null || true
`;
        writeFileSync(hookPath, script, { mode: 0o755 });
        return { healed: true, action: "global-hook", from: hookPath };
    }
    catch {
        return { healed: false, action: "none" };
    }
}
/**
 * Backward symlink: during postinstall, if the registry points to a
 * non-existent OLD path, create a symlink from old → new (our directory).
 * Same as healRegistryMismatch but called from postinstall context.
 */
export { healRegistryMismatch as healBackwardCompat };
/** One-shot flag for mid-session heal in server.ts */
let _midSessionHealed = false;
/**
 * Mid-session heal — call on first MCP tool invocation.
 * Checks if registry path differs from our running directory.
 * Creates symlink if needed. Runs only once per process.
 */
export function healMidSession(currentDir) {
    if (_midSessionHealed)
        return { healed: false, action: "none" };
    _midSessionHealed = true;
    return healRegistryMismatch(currentDir);
}
/** Reset mid-session flag (for testing only) */
export function _resetMidSession() {
    _midSessionHealed = false;
}
