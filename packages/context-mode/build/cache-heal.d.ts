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
export interface HealResult {
    healed: boolean;
    action?: "symlink" | "global-hook" | "none";
    from?: string;
    to?: string;
}
/**
 * Core heal: if installed_plugins.json points to a non-existent directory,
 * create a symlink from that path to our actual directory.
 *
 * @param currentDir - The directory we're actually running from
 * @param installedPluginsPath - Path to installed_plugins.json (injectable for testing)
 */
export declare function healRegistryMismatch(currentDir: string, installedPluginsPath?: string): HealResult;
/**
 * Deploy a global SessionStart hook that heals plugin cache mismatches.
 * This hook lives outside the plugin directory, so it survives cache breakage.
 *
 * Written to ~/.claude/hooks/context-mode-cache-heal.sh
 */
export declare function deployGlobalHealHook(): HealResult;
/**
 * Backward symlink: during postinstall, if the registry points to a
 * non-existent OLD path, create a symlink from old → new (our directory).
 * Same as healRegistryMismatch but called from postinstall context.
 */
export { healRegistryMismatch as healBackwardCompat };
/**
 * Mid-session heal — call on first MCP tool invocation.
 * Checks if registry path differs from our running directory.
 * Creates symlink if needed. Runs only once per process.
 */
export declare function healMidSession(currentDir: string): HealResult;
/** Reset mid-session flag (for testing only) */
export declare function _resetMidSession(): void;
