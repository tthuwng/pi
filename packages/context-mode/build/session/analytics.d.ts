/**
 * AnalyticsEngine — Runtime savings + session continuity reporting.
 *
 * Computes context-window savings from runtime stats and queries
 * session continuity data from SessionDB.
 *
 * Usage:
 *   const engine = new AnalyticsEngine(sessionDb);
 *   const report = engine.queryAll(runtimeStats);
 */
/** Database adapter — anything with a prepare() method (better-sqlite3, bun:sqlite, etc.) */
export interface DatabaseAdapter {
    prepare(sql: string): {
        run(...params: unknown[]): unknown;
        get(...params: unknown[]): unknown;
        all(...params: unknown[]): unknown[];
    };
}
/** Context savings result (#1) */
export interface ContextSavings {
    rawBytes: number;
    contextBytes: number;
    savedBytes: number;
    savedPercent: number;
}
/** Think in code comparison result (#2) */
export interface ThinkInCodeComparison {
    fileBytes: number;
    outputBytes: number;
    ratio: number;
}
/** Tool-level savings result (#3) */
export interface ToolSavingsRow {
    tool: string;
    rawBytes: number;
    contextBytes: number;
    savedBytes: number;
}
/** Sandbox I/O result (#19) */
export interface SandboxIO {
    inputBytes: number;
    outputBytes: number;
}
/** MCP tool usage row — concurrency stats for batch-style tools. */
export interface McpToolUsageRow {
    tool_name: string;
    calls: number;
    median_concurrency: number | null;
    max_concurrency: number | null;
}
/** Runtime stats tracked by server.ts during a live session. */
export interface RuntimeStats {
    bytesReturned: Record<string, number>;
    bytesIndexed: number;
    bytesSandboxed: number;
    calls: Record<string, number>;
    sessionStart: number;
    cacheHits: number;
    cacheBytesSaved: number;
}
/** Unified report combining runtime stats, DB analytics, and continuity data. */
export interface FullReport {
    /** Runtime context savings (passed in, not from DB) */
    savings: {
        processed_kb: number;
        entered_kb: number;
        saved_kb: number;
        pct: number;
        savings_ratio: number;
        by_tool: Array<{
            tool: string;
            calls: number;
            context_kb: number;
            tokens: number;
        }>;
        total_calls: number;
        total_bytes_returned: number;
        kept_out: number;
        total_processed: number;
    };
    cache?: {
        hits: number;
        bytes_saved: number;
        ttl_hours_left: number;
        total_with_cache: number;
        total_savings_ratio: number;
    };
    /** Session metadata from SessionDB */
    session: {
        id: string;
        uptime_min: string;
    };
    /** Session continuity data */
    continuity: {
        total_events: number;
        by_category: Array<{
            category: string;
            count: number;
            label: string;
            preview: string;
            why: string;
        }>;
        compact_count: number;
        resume_ready: boolean;
    };
    /** Persistent project memory — all events across all sessions */
    projectMemory: {
        total_events: number;
        session_count: number;
        by_category: Array<{
            category: string;
            count: number;
            label: string;
        }>;
    };
}
/** Human-readable labels for event categories. */
export declare const categoryLabels: Record<string, string>;
/** Explains why each category matters for continuity. */
export declare const categoryHints: Record<string, string>;
export declare class AnalyticsEngine {
    private readonly db;
    /**
     * Create an AnalyticsEngine.
     *
     * Accepts either a SessionDB instance (extracts internal db via
     * the protected getter — use the static fromDB helper for raw adapters)
     * or any object with a prepare() method for direct usage.
     */
    constructor(db: DatabaseAdapter);
    /**
     * #1 Context Savings Total — bytes kept out of context window.
     *
     * Stub: requires server.ts to accumulate rawBytes and contextBytes
     * during a live session. Call with tracked values.
     */
    static contextSavingsTotal(rawBytes: number, contextBytes: number): ContextSavings;
    /**
     * #2 Think in Code Comparison — ratio of file size to sandbox output size.
     *
     * Stub: requires server.ts tracking of execute/execute_file calls.
     */
    static thinkInCodeComparison(fileBytes: number, outputBytes: number): ThinkInCodeComparison;
    /**
     * #3 Tool Savings — per-tool breakdown of context savings.
     *
     * Stub: requires per-tool accumulators in server.ts.
     */
    static toolSavings(tools: Array<{
        tool: string;
        rawBytes: number;
        contextBytes: number;
    }>): ToolSavingsRow[];
    /**
     * #19 Sandbox I/O — total input/output bytes processed by the sandbox.
     *
     * Stub: requires PolyglotExecutor byte counters.
     */
    static sandboxIO(inputBytes: number, outputBytes: number): SandboxIO;
    /**
     * MCP tool usage — call counts and concurrency stats per MCP tool.
     *
     * Reads `mcp_tool_call` events, parses the JSON payload, and aggregates:
     *  - call count per tool_name
     *  - median + max of `params.concurrency` (only for tools that take it,
     *    e.g. ctx_batch_execute, ctx_fetch_and_index). Returns null when the
     *    tool doesn't carry a concurrency param so callers can render N/A.
     *
     * Best-effort: malformed rows or truncated payloads are skipped silently.
     */
    getMcpToolUsage(): McpToolUsageRow[];
    /**
     * Build a FullReport by merging runtime stats (passed in)
     * with continuity data from the DB.
     *
     * This is the ONE call that ctx_stats should use.
     */
    queryAll(runtimeStats: RuntimeStats): FullReport;
}
/** Aggregated stats spanning every SessionDB + auto-memory under the user's profile. */
export interface LifetimeStats {
    totalEvents: number;
    totalSessions: number;
    autoMemoryCount: number;
    autoMemoryProjects: number;
    /** Per-prefix breakdown of auto-memory files (user/feedback/project/...). */
    autoMemoryByPrefix: Record<string, number>;
    /**
     * Per-category event counts aggregated across every SessionDB on disk.
     * Keys are the raw category strings (file/cwd/rule/...) — the renderer
     * looks them up against `categoryLabels` for display. Empty `{}` when no
     * sidecar has any events. Optional for back-compat with older fixtures.
     */
    categoryCounts: Record<string, number>;
}
/**
 * Aggregate lifetime stats from all SessionDB files in `sessionsDir` and
 * all auto-memory markdown files under `memoryRoot/<project>/memory/`.
 *
 * Best-effort: silently ignores missing/unreadable files so ctx_stats
 * can never be broken by a corrupt sidecar.
 */
export declare function getLifetimeStats(opts?: {
    sessionsDir?: string;
    memoryRoot?: string;
    /** Override for tests — defaults to db-base loadDatabase(). */
    loadDatabase?: () => unknown;
}): LifetimeStats;
/** Opus 4 input price: $15 per 1M tokens. */
export declare const OPUS_INPUT_PRICE_PER_TOKEN: number;
/** Convert a token count to a USD string at the Opus input rate. */
export declare function tokensToUsd(tokens: number): string;
/**
 * Render a FullReport as a visual savings dashboard designed for screenshotting.
 *
 * Design principles:
 * - Before/After comparison bar is the HERO — one glance = "wow"
 * - "tokens saved" is the number people share
 * - Per-tool breakdown shows what each tool SAVED, sorted by impact
 * - Project memory: category bars showing persistent data across sessions
 * - No: Pct column, category tables, tips, jargon
 */
export declare function formatReport(report: FullReport, version?: string, latestVersion?: string | null, opts?: {
    lifetime?: LifetimeStats;
    mcpUsage?: McpToolUsageRow[];
}): string;
