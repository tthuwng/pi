/**
 * SessionDB — Persistent per-project SQLite database for session events.
 *
 * Stores raw events captured by hooks during a Claude Code session,
 * session metadata, and resume snapshots. Extends SQLiteBase from
 * the shared package.
 */
import { SQLiteBase } from "../db-base.js";
import type { SessionEvent } from "../types.js";
import type { ProjectAttribution } from "./project-attribution.js";
export declare function getWorktreeSuffix(): string;
export declare function _resetWorktreeSuffixCacheForTests(): void;
/** A stored event row from the session_events table. */
export interface StoredEvent {
    id: number;
    session_id: string;
    type: string;
    category: string;
    priority: number;
    data: string;
    project_dir: string;
    attribution_source: string;
    attribution_confidence: number;
    source_hook: string;
    created_at: string;
    data_hash: string;
}
/** Session metadata row from the session_meta table. */
export interface SessionMeta {
    session_id: string;
    project_dir: string;
    started_at: string;
    last_event_at: string | null;
    event_count: number;
    compact_count: number;
}
/** Resume snapshot row from the session_resume table. */
export interface ResumeRow {
    snapshot: string;
    event_count: number;
    consumed: number;
}
/** Aggregated tool-call stats for a single session. */
export interface ToolCallStats {
    totalCalls: number;
    totalBytesReturned: number;
    byTool: Record<string, {
        calls: number;
        bytesReturned: number;
    }>;
}
export declare class SessionDB extends SQLiteBase {
    /**
     * Cached prepared statements. Stored in a Map to avoid the JS private-field
     * inheritance issue where `#field` declarations in a subclass are not
     * accessible during base-class constructor calls.
     *
     * `declare` ensures TypeScript does NOT emit a field initializer at runtime.
     * Without `declare`, even `stmts!: Map<...>` emits `this.stmts = undefined`
     * after super() returns, wiping what prepareStatements() stored. The Map
     * is created inside prepareStatements() instead.
     */
    private stmts;
    constructor(opts?: {
        dbPath?: string;
    });
    /** Shorthand to retrieve a cached statement. */
    private stmt;
    protected initSchema(): void;
    protected prepareStatements(): void;
    /**
     * Insert a session event with deduplication and FIFO eviction.
     *
     * Deduplication: skips if the same type + data_hash appears in the
     * last DEDUP_WINDOW events for this session.
     *
     * Eviction: if session exceeds MAX_EVENTS_PER_SESSION, evicts the
     * lowest-priority (then oldest) event.
     */
    insertEvent(sessionId: string, event: Omit<SessionEvent, "data_hash"> & {
        data_hash?: string;
    }, sourceHook?: string, attribution?: Partial<ProjectAttribution>): void;
    /**
     * Bulk-insert N events in a SINGLE transaction.
     *
     * PostToolUse hooks emit 5–15 events per tool call. Calling insertEvent()
     * in a loop runs N transactions = N WAL commits = N fsync candidates,
     * which is painful on Windows NTFS where commit latency dominates.
     * One transaction = one commit, dedup/evict checks reuse cached statements.
     *
     * Cross-platform: uses the same WAL-mode transaction primitive as
     * insertEvent — behavior identical on macOS / Linux / Windows.
     */
    bulkInsertEvents(sessionId: string, events: SessionEvent[], sourceHook?: string, attributions?: Array<Partial<ProjectAttribution> | undefined>): void;
    /**
     * Retrieve events for a session with optional filtering.
     */
    getEvents(sessionId: string, opts?: {
        type?: string;
        minPriority?: number;
        limit?: number;
    }): StoredEvent[];
    /**
     * Get the total event count for a session.
     */
    getEventCount(sessionId: string): number;
    /**
     * Return the most recently attributed project dir for a session.
     */
    getLatestAttributedProjectDir(sessionId: string): string | null;
    /**
     * Search events by text query scoped to a project directory.
     *
     * Performs a case-insensitive LIKE search across the `data` and `category`
     * columns. An optional `source` parameter filters by exact category match.
     * Returns results ordered by monotonic id (chronological).
     *
     * Best-effort: returns empty array on any error.
     */
    searchEvents(query: string, limit: number, projectDir: string, source?: string): Array<{
        id: number;
        session_id: string;
        category: string;
        type: string;
        data: string;
        created_at: string;
    }>;
    /**
     * Ensure a session metadata entry exists. Idempotent (INSERT OR IGNORE).
     * `projectDir` is the session origin directory, not per-event attribution.
     */
    ensureSession(sessionId: string, projectDir: string): void;
    /**
     * Get session statistics/metadata.
     */
    getSessionStats(sessionId: string): SessionMeta | null;
    /**
     * Increment the compact_count for a session (tracks snapshot rebuilds).
     */
    incrementCompactCount(sessionId: string): void;
    /**
     * Upsert a resume snapshot for a session. Resets consumed flag on update.
     */
    upsertResume(sessionId: string, snapshot: string, eventCount?: number): void;
    /**
     * Retrieve the resume snapshot for a session.
     */
    getResume(sessionId: string): ResumeRow | null;
    /**
     * Mark the resume snapshot as consumed (already injected into conversation).
     */
    markResumeConsumed(sessionId: string): void;
    /**
     * Atomically claim the most recent unconsumed resume snapshot in this DB,
     * EXCLUDING any row that belongs to `currentSessionId`.
     *
     * `SessionDB` is sharded per project (see `getSessionDBPath` — SHA-256 of
     * project dir), so "this DB" already implies "this project". The atomic
     * `UPDATE … RETURNING` ensures concurrent processes for the same project
     * cannot both inject the same snapshot (Mickey / PR #376 race).
     *
     * The `currentSessionId` parameter prevents self-injection: when a session
     * compacts mid-flight and produces its own row, that session's next chat
     * turn must NOT claim that row back (wasted tokens AND it would consume
     * the snapshot meant for the next fresh session).
     *
     * Pass an empty string to allow self-claim (legacy behaviour, only useful
     * in tests or one-off harnesses).
     *
     * Returns null when no unconsumed snapshot exists for any other session.
     */
    claimLatestUnconsumedResume(currentSessionId: string): {
        sessionId: string;
        snapshot: string;
    } | null;
    /**
     * Return the most recent session_id from session_meta, or null if none.
     * Used by the runtime to attach persistent counters to the right session
     * after a process restart.
     */
    getLatestSessionId(): string | null;
    /**
     * Increment the persistent tool-call counter for `tool` in `sessionId`.
     * Adds `bytesReturned` to the cumulative total. Idempotent across
     * SessionDB instances — counters survive process restart.
     */
    incrementToolCall(sessionId: string, tool: string, bytesReturned?: number): void;
    /**
     * Get aggregated tool-call stats for `sessionId`. Returns zero-stats
     * when the session has no recorded calls.
     */
    getToolCallStats(sessionId: string): ToolCallStats;
    /**
     * Delete all data for a session (events, meta, resume).
     */
    deleteSession(sessionId: string): void;
    /**
     * Remove sessions older than maxAgeDays. Returns the count of deleted sessions.
     */
    cleanupOldSessions(maxAgeDays?: number): number;
}
