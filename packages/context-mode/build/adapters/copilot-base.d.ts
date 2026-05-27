/**
 * CopilotBaseAdapter — shared implementation for VS Code Copilot and JetBrains Copilot.
 *
 * Both platforms share the SAME Copilot agent runtime:
 *   - hookSpecificOutput wrapper with hookEventName
 *   - Same hook events (PreToolUse, PostToolUse, PreCompact, SessionStart)
 *   - Same .github/hooks/ config location
 *   - Same configureHooks logic
 *   - Same generateHookConfig format
 *   - Same parse/format methods
 *
 * Platform-specific differences handled by subclasses:
 *   - extractSessionId() — different env var fallbacks
 *   - getProjectDir() — different env vars for project root
 *   - getSessionDir() — different default session directories
 *   - checkPluginRegistration() — VS Code reads .vscode/mcp.json, JetBrains uses IDE UI
 *   - getInstalledVersion() — VS Code checks extensions dir, JetBrains checks hook config
 *   - validateHooks() — different warning messages
 */
import { BaseAdapter } from "./base.js";
import type { HookAdapter, HookParadigm, PlatformCapabilities, DiagnosticResult, PreToolUseEvent, PostToolUseEvent, PreCompactEvent, SessionStartEvent, PreToolUseResponse, PostToolUseResponse, PreCompactResponse, SessionStartResponse, HookRegistration } from "./types.js";
export interface CopilotHookInput {
    tool_name?: string;
    tool_input?: Record<string, unknown>;
    tool_output?: string;
    is_error?: boolean;
    /** Copilot uses camelCase sessionId (NOT session_id). */
    sessionId?: string;
    source?: string;
}
export interface CopilotHookModule {
    HOOK_TYPES: {
        readonly PRE_TOOL_USE: string;
        readonly POST_TOOL_USE: string;
        readonly PRE_COMPACT: string;
        readonly SESSION_START: string;
        readonly STOP?: string;
        readonly SUBAGENT_START?: string;
        readonly SUBAGENT_STOP?: string;
    };
    HOOK_SCRIPTS: Record<string, string>;
    buildHookCommand: (hookType: any, pluginRoot?: string) => string;
}
export declare abstract class CopilotBaseAdapter extends BaseAdapter implements HookAdapter {
    readonly paradigm: HookParadigm;
    readonly capabilities: PlatformCapabilities;
    /** Subclasses must provide their platform name. */
    abstract readonly name: string;
    /** Subclasses must provide their hook module (HOOK_TYPES, HOOK_SCRIPTS, buildHookCommand). */
    protected abstract readonly hookModule: CopilotHookModule;
    /** Subclasses must provide the hook scripts subdirectory name (e.g., "vscode-copilot"). */
    protected abstract readonly hookSubdir: string;
    /** Extract session ID from Copilot hook input — env var fallbacks differ per platform. */
    protected abstract extractSessionId(input: CopilotHookInput): string;
    /** Get the project directory — env vars differ per platform. */
    protected abstract getProjectDir(): string;
    /** Validate that hooks are properly configured for this platform. */
    abstract validateHooks(pluginRoot: string): DiagnosticResult[];
    /** Check if the plugin is registered/enabled on this platform. */
    abstract checkPluginRegistration(): DiagnosticResult;
    /** Get the installed version from this platform's registry/marketplace. */
    abstract getInstalledVersion(): string;
    parsePreToolUseInput(raw: unknown): PreToolUseEvent;
    parsePostToolUseInput(raw: unknown): PostToolUseEvent;
    parsePreCompactInput(raw: unknown): PreCompactEvent;
    parseSessionStartInput(raw: unknown): SessionStartEvent;
    formatPreToolUseResponse(response: PreToolUseResponse): unknown;
    formatPostToolUseResponse(response: PostToolUseResponse): unknown;
    formatPreCompactResponse(response: PreCompactResponse): unknown;
    formatSessionStartResponse(response: SessionStartResponse): unknown;
    getSettingsPath(): string;
    generateHookConfig(pluginRoot: string): HookRegistration;
    readSettings(): Record<string, unknown> | null;
    writeSettings(settings: Record<string, unknown>): void;
    configureAllHooks(pluginRoot: string): string[];
    setHookPermissions(pluginRoot: string): string[];
    updatePluginRegistry(_pluginRoot: string, _version: string): void;
}
