/**
 * adapters/detect — Auto-detect which platform is running.
 *
 * Detection priority:
 *   1. Environment variables (high confidence)
 *   2. Config directory existence (medium confidence)
 *   3. Fallback to Claude Code (low confidence — most common)
 *
 * Verified env vars per platform (from source code audit):
 *   - Claude Code:    CLAUDE_PROJECT_DIR, CLAUDE_SESSION_ID | ~/.claude/
 *   - Gemini CLI:     GEMINI_PROJECT_DIR (hooks), GEMINI_CLI (MCP) | ~/.gemini/
 *   - KiloCode:       KILO, KILO_PID | ~/.config/kilo/
 *   - OpenCode:       OPENCODE, OPENCODE_PID | ~/.config/opencode/
 *   - OpenClaw:       OPENCLAW_HOME, OPENCLAW_CLI | ~/.openclaw/
 *   - Codex CLI:      CODEX_CI, CODEX_THREAD_ID | ~/.codex/
 *   - Cursor:         CURSOR_TRACE_ID (MCP), CURSOR_CLI (terminal) | ~/.cursor/
 *   - VS Code Copilot: VSCODE_PID, VSCODE_CWD | ~/.vscode/
 *   - JetBrains Copilot: IDEA_INITIAL_DIRECTORY, IDEA_HOME, JETBRAINS_CLIENT_ID | ~/.config/JetBrains/
 */
import type { PlatformId, DetectionSignal, HookAdapter } from "./types.js";
/**
 * High-confidence env vars per platform, checked in priority order.
 * Single source of truth — consumed by detectPlatform() below and by
 * tests that need to clear platform-related env vars deterministically.
 */
export declare const PLATFORM_ENV_VARS: readonly [readonly ["claude-code", readonly ["CLAUDE_PROJECT_DIR", "CLAUDE_SESSION_ID"]], readonly ["antigravity", readonly ["ANTIGRAVITY_CLI_ALIAS"]], readonly ["cursor", readonly ["CURSOR_TRACE_ID", "CURSOR_CLI"]], readonly ["kilo", readonly ["KILO_PID"]], readonly ["opencode", readonly ["OPENCODE", "OPENCODE_PID"]], readonly ["zed", readonly ["ZED_SESSION_ID", "ZED_TERM"]], readonly ["codex", readonly ["CODEX_THREAD_ID", "CODEX_CI"]], readonly ["gemini-cli", readonly ["GEMINI_PROJECT_DIR", "GEMINI_CLI"]], readonly ["vscode-copilot", readonly ["VSCODE_PID", "VSCODE_CWD"]], readonly ["jetbrains-copilot", readonly ["IDEA_INITIAL_DIRECTORY"]], readonly ["qwen-code", readonly ["QWEN_PROJECT_DIR"]], readonly ["pi", readonly ["PI_PROJECT_DIR"]]];
/**
 * Sync map from platform identifier → home-relative path segments where that
 * platform stores its config. Mirrors the `super([...])` argument passed by
 * each adapter — kept in sync as the single source of truth used when we need
 * a session dir BEFORE an adapter has been instantiated (race window between
 * MCP server start and `initialize` handshake completion).
 *
 * Returns `null` for "unknown" or any string outside the supported set so the
 * caller can decide on a safe fallback.
 */
export declare function getSessionDirSegments(platform: string): string[] | null;
/**
 * Detect the current platform by checking env vars and config dirs.
 *
 * @param clientInfo - Optional MCP clientInfo from initialize handshake.
 *   When provided, takes highest priority (zero-config detection).
 */
export declare function detectPlatform(clientInfo?: {
    name: string;
    version?: string;
}): DetectionSignal;
/**
 * Get the adapter instance for a given platform.
 * Lazily imports platform-specific adapter modules.
 */
export declare function getAdapter(platform?: PlatformId): Promise<HookAdapter>;
