/**
 * adapters/claude-code — Claude Code platform adapter.
 *
 * Extends ClaudeCodeBaseAdapter (shared wire-protocol parse/format methods)
 * with Claude Code-specific configuration, diagnostics, and upgrade logic.
 *
 * Claude Code hook specifics:
 *   - Session ID: transcript_path UUID > session_id > CLAUDE_SESSION_ID > ppid
 *   - Config: ~/.claude/settings.json
 *   - Session dir: ~/.claude/context-mode/sessions/
 *   - Plugin registry: ~/.claude/plugins/installed_plugins.json
 */
import { ClaudeCodeBaseAdapter, type ClaudeCodeWireInput } from "../claude-code-base.js";
import type { HookAdapter, HookParadigm, PlatformCapabilities, DiagnosticResult, HookRegistration } from "../types.js";
export declare class ClaudeCodeAdapter extends ClaudeCodeBaseAdapter implements HookAdapter {
    constructor();
    readonly name = "Claude Code";
    readonly paradigm: HookParadigm;
    protected readonly projectDirEnvVar = "CLAUDE_PROJECT_DIR";
    readonly capabilities: PlatformCapabilities;
    getSettingsPath(): string;
    generateHookConfig(pluginRoot: string): HookRegistration;
    readSettings(): Record<string, unknown> | null;
    writeSettings(settings: Record<string, unknown>): void;
    validateHooks(pluginRoot: string): DiagnosticResult[];
    /** Read plugin hooks from hooks/hooks.json or .claude-plugin/hooks/hooks.json */
    private readPluginHooks;
    /** Check if a hook type is configured in either settings.json or plugin hooks */
    private checkHookType;
    checkPluginRegistration(): DiagnosticResult;
    getInstalledVersion(): string;
    configureAllHooks(pluginRoot: string): string[];
    setHookPermissions(pluginRoot: string): string[];
    updatePluginRegistry(pluginRoot: string, version: string): void;
    protected extractSessionId(input: ClaudeCodeWireInput): string;
}
