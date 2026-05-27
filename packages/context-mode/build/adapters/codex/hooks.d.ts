/**
 * adapters/codex/hooks — Codex CLI hook definitions.
 *
 * Codex CLI hooks are stable (codex_hooks Stage::Stable, default_enabled: true).
 * 5 hook events: PreToolUse, PostToolUse, SessionStart, UserPromptSubmit, Stop.
 * Same JSON stdin/stdout wire protocol as Claude Code.
 *
 * Config: ~/.codex/hooks.json (JSON format, same schema as Claude Code)
 * MCP: full support via [mcp_servers] in ~/.codex/config.toml
 *
 * Known limitations:
 *   - PreToolUse: deny works, updatedInput not yet supported (openai/codex#18491)
 *   - PostToolUse: updatedMCPToolOutput parsed but logged as unsupported
 *   - PostToolUse does not fire on failing Bash calls (upstream bug)
 */
/** Codex CLI hook types — mirrors Claude Code's 5-event model. */
export declare const HOOK_TYPES: {
    readonly PRE_TOOL_USE: "PreToolUse";
    readonly POST_TOOL_USE: "PostToolUse";
    readonly SESSION_START: "SessionStart";
    readonly USER_PROMPT_SUBMIT: "UserPromptSubmit";
    readonly STOP: "Stop";
};
/**
 * Path to the routing instructions file for Codex CLI.
 * Used as fallback routing awareness alongside hook-based enforcement.
 */
export declare const ROUTING_INSTRUCTIONS_PATH = "configs/codex/AGENTS.md";
