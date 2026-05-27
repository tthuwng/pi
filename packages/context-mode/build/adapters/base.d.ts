/**
 * BaseAdapter — shared implementation for methods identical across all adapters.
 *
 * Eliminates ~288 lines of duplication across 12 adapters.
 * Each concrete adapter extends this and provides platform-specific logic.
 *
 * Shared methods:
 *   - getSessionDir()       — builds session dir from sessionDirSegments
 *   - getSessionDBPath()    — SHA-256 hash of projectDir → .db file
 *   - getSessionEventsPath()— SHA-256 hash of projectDir → -events.md file
 *   - backupSettings()      — copies settings file to .bak
 *
 * Adapters with custom logic override the relevant method:
 *   - vscode-copilot: overrides getSessionDir (checks .github dir)
 *   - opencode: overrides getSessionDir (XDG_CONFIG_HOME / APPDATA)
 *              and backupSettings (calls checkPluginRegistration first)
 *   - openclaw: overrides backupSettings (searches 3 config paths)
 */
export declare abstract class BaseAdapter {
    protected readonly sessionDirSegments: string[];
    constructor(sessionDirSegments: string[]);
    getSessionDir(): string;
    getSessionDBPath(projectDir: string): string;
    getSessionEventsPath(projectDir: string): string;
    /**
     * Default: build config dir from sessionDirSegments rooted at $HOME.
     *
     * Contract: ALWAYS returns an absolute path. Adapters with project-scoped
     * or non-home-rooted config dirs (cursor, vscode-copilot, jetbrains-copilot,
     * openclaw, opencode) override this and resolve their segments against
     * `projectDir` (or `process.cwd()` when omitted).
     *
     * @param _projectDir Unused by the home-rooted default — accepted so
     *                    project-scoped overrides honor the same signature.
     */
    getConfigDir(_projectDir?: string): string;
    /**
     * Default: Claude Code convention. Most adapters override with their
     * own platform-specific instruction file name (AGENTS.md, GEMINI.md, ...).
     */
    getInstructionFiles(): string[];
    /**
     * Default: <configDir>/memory. Always absolute (configDir is absolute by
     * contract). Adapters with a different memory dir name (e.g., codex uses
     * "memories" plural) override this.
     */
    getMemoryDir(): string;
    backupSettings(): string | null;
    abstract getSettingsPath(): string;
}
