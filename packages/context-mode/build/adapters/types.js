/**
 * adapters/types — Platform adapter interface for multi-platform hook support.
 *
 * Defines the contract that each platform adapter must implement.
 * Three paradigms exist across supported platforms:
 *   A) JSON stdin/stdout — Claude Code, Gemini CLI, VS Code Copilot, Copilot CLI, Cursor
 *   B) TS Plugin Functions — OpenCode
 *   C) MCP-only (no hooks) — Codex CLI
 *
 * The MCP server layer is 100% portable and needs no adapter.
 * Only the hook layer requires platform-specific adapters.
 */
// ─────────────────────────────────────────────────────────
// Platform detection
// ─────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────
// Cross-platform command helpers (#369, #372)
// ─────────────────────────────────────────────────────────
/**
 * Build a cross-platform `node <script>` command string.
 *
 * Fixes two Windows bugs:
 *   #369 — Bare `node` fails on Windows Git Bash (MSYS) because PATH
 *          resolution is unreliable. Uses `process.execPath` instead.
 *   #372 — MSYS rewrites absolute paths on non-C: drives (e.g.
 *          `C:\Users\...` → `D:\c\Users\...`). Forward slashes +
 *          double-quoting prevents the translation.
 *
 * Safe on macOS/Linux — quoting and forward slashes are no-ops there.
 */
export function buildNodeCommand(scriptPath) {
    const nodePath = process.execPath.replace(/\\/g, "/");
    const safePath = scriptPath.replace(/\\/g, "/");
    return `"${nodePath}" "${safePath}"`;
}
