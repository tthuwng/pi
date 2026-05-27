/**
 * db-base — Reusable SQLite infrastructure for context-mode packages.
 *
 * Provides lazy-loading of better-sqlite3, WAL pragma setup, prepared
 * statement caching interface, and DB file cleanup helpers. Both
 * ContentStore and SessionDB build on top of these primitives.
 */
import { createRequire } from "node:module";
import { existsSync, unlinkSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// ─────────────────────────────────────────────────────────
// bun:sqlite adapter (#45)
// ─────────────────────────────────────────────────────────
/**
 * Wraps a bun:sqlite Database to provide better-sqlite3-compatible API.
 * Bridges: .pragma(), multi-statement .exec(), .get() null→undefined.
 */
export class BunSQLiteAdapter {
    #raw;
    constructor(rawDb) {
        this.#raw = rawDb;
    }
    pragma(source) {
        const stmt = this.#raw.prepare(`PRAGMA ${source}`);
        const rows = stmt.all();
        if (!rows || rows.length === 0)
            return undefined;
        // Multi-row pragmas (table_xinfo, etc.) → return array
        if (rows.length > 1)
            return rows;
        // Single-row: extract scalar value (e.g. journal_mode = "wal")
        const values = Object.values(rows[0]);
        return values.length === 1 ? values[0] : rows[0];
    }
    exec(sql) {
        // bun:sqlite .exec() is single-statement only.
        // Split multi-statement SQL respecting string literals (don't split on ; inside quotes).
        let current = "";
        let inString = null;
        for (let i = 0; i < sql.length; i++) {
            const ch = sql[i];
            if (inString) {
                current += ch;
                if (ch === inString)
                    inString = null;
            }
            else if (ch === "'" || ch === '"') {
                current += ch;
                inString = ch;
            }
            else if (ch === ";") {
                const trimmed = current.trim();
                if (trimmed)
                    this.#raw.prepare(trimmed).run();
                current = "";
            }
            else {
                current += ch;
            }
        }
        const trimmed = current.trim();
        if (trimmed)
            this.#raw.prepare(trimmed).run();
        return this;
    }
    prepare(sql) {
        const stmt = this.#raw.prepare(sql);
        return {
            run: (...args) => stmt.run(...args),
            get: (...args) => {
                const r = stmt.get(...args);
                return r === null ? undefined : r;
            },
            all: (...args) => stmt.all(...args),
            iterate: (...args) => stmt.iterate(...args),
        };
    }
    transaction(fn) {
        return this.#raw.transaction(fn);
    }
    close() {
        this.#raw.close();
    }
}
// ─────────────────────────────────────────────────────────
// node:sqlite adapter (#228)
// ─────────────────────────────────────────────────────────
/**
 * Wraps node:sqlite's DatabaseSync to provide better-sqlite3-compatible API.
 * Bridges: .pragma(), .transaction(). Everything else is passthrough.
 * Eliminates native addon SIGSEGV on Linux (nodejs/node#62515).
 */
export class NodeSQLiteAdapter {
    #raw; // DatabaseSync instance
    constructor(rawDb) {
        this.#raw = rawDb;
    }
    pragma(source) {
        // "journal_mode = WAL" → PRAGMA journal_mode = WAL
        // "table_xinfo(session_events)" → PRAGMA table_xinfo(session_events)
        // "wal_checkpoint(TRUNCATE)" → PRAGMA wal_checkpoint(TRUNCATE)
        const stmt = this.#raw.prepare(`PRAGMA ${source}`);
        const rows = stmt.all();
        if (!rows || rows.length === 0)
            return undefined;
        if (rows.length > 1)
            return rows;
        const values = Object.values(rows[0]);
        return values.length === 1 ? values[0] : rows[0];
    }
    exec(sql) {
        // node:sqlite's exec() supports multi-statement natively
        this.#raw.exec(sql);
        return this;
    }
    prepare(sql) {
        const stmt = this.#raw.prepare(sql);
        return {
            run: (...args) => stmt.run(...args),
            get: (...args) => stmt.get(...args),
            all: (...args) => stmt.all(...args),
            iterate: (...args) => {
                // node:sqlite uses Symbol.iterator on StatementSync, not .iterate()
                // Check if iterate exists, otherwise use Symbol.iterator
                if (typeof stmt.iterate === 'function') {
                    return stmt.iterate(...args);
                }
                // Fallback: use all() to create an iterator
                const rows = stmt.all(...args);
                return rows[Symbol.iterator]();
            },
        };
    }
    transaction(fn) {
        // node:sqlite has no transaction() method — manual BEGIN/COMMIT/ROLLBACK
        return (...args) => {
            this.#raw.exec("BEGIN");
            try {
                const result = fn(...args);
                this.#raw.exec("COMMIT");
                return result;
            }
            catch (err) {
                this.#raw.exec("ROLLBACK");
                throw err;
            }
        };
    }
    close() {
        this.#raw.close();
    }
}
// ─────────────────────────────────────────────────────────
// Lazy loader
// ─────────────────────────────────────────────────────────
let _Database = null;
/**
 * Lazy-load the SQLite driver for the current runtime.
 * Bun → bun:sqlite via BunSQLiteAdapter (issue #45).
 * Linux Node → node:sqlite via NodeSQLiteAdapter (issue #228).
 * Other Node → better-sqlite3 (native addon).
 */
export function loadDatabase() {
    if (!_Database) {
        const require = createRequire(import.meta.url);
        if (globalThis.Bun) {
            // Bun runtime — use bun:sqlite directly.
            // Array.join() prevents esbuild from resolving the specifier at bundle time.
            const BunDB = require(["bun", "sqlite"].join(":")).Database;
            _Database = function BunDatabaseFactory(path, opts) {
                const raw = new BunDB(path, {
                    readonly: opts?.readonly,
                    create: true,
                });
                const adapter = new BunSQLiteAdapter(raw);
                // Propagate busy_timeout — better-sqlite3 does this via constructor
                // option but bun:sqlite does not, so we set it via pragma (#243)
                if (opts?.timeout) {
                    adapter.pragma(`busy_timeout = ${opts.timeout}`);
                }
                return adapter;
            };
        }
        else if (process.platform === "linux") {
            // Linux — try node:sqlite to avoid native addon SIGSEGV (nodejs/node#62515).
            // node:sqlite is built into Node >= 22.5, no flag needed since 22.13.
            try {
                const { DatabaseSync } = require(["node", "sqlite"].join(":"));
                _Database = function NodeDatabaseFactory(path, opts) {
                    const raw = new DatabaseSync(path, {
                        readOnly: opts?.readonly ?? false,
                    });
                    return new NodeSQLiteAdapter(raw);
                };
            }
            catch {
                // node:sqlite not available — fall through to better-sqlite3
                _Database = require("better-sqlite3");
            }
        }
        else {
            // Non-Linux Node.js — use better-sqlite3.
            _Database = require("better-sqlite3");
        }
    }
    return _Database;
}
// ─────────────────────────────────────────────────────────
// WAL setup
// ─────────────────────────────────────────────────────────
/**
 * Apply WAL mode and NORMAL synchronous pragma to a database instance.
 * Should be called immediately after opening a new database connection.
 *
 * WAL mode provides:
 * - Concurrent readers while a write is in progress
 * - Dramatically faster writes (no full-page sync on each commit)
 * NORMAL synchronous is safe under WAL and avoids an extra fsync per
 * transaction.
 */
export function applyWALPragmas(db) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    // Memory-map the DB file for read-heavy FTS5 search workloads.
    // Eliminates read() syscalls — the kernel serves pages directly from
    // the page cache. 256MB is a safe upper bound (SQLite only maps up to
    // the actual file size). Falls back gracefully on platforms where mmap
    // is unavailable or restricted.
    try {
        db.pragma("mmap_size = 268435456");
    }
    catch { /* unsupported runtime */ }
}
// ─────────────────────────────────────────────────────────
// DB file helpers
// ─────────────────────────────────────────────────────────
/**
 * Remove orphaned WAL/SHM files when the main DB file doesn't exist.
 * On Windows, stale -wal/-shm files from crashed processes cause
 * "file is not a database" errors when creating a fresh DB.
 */
export function cleanOrphanedWALFiles(dbPath) {
    if (!existsSync(dbPath)) {
        for (const suffix of ["-wal", "-shm"]) {
            try {
                unlinkSync(dbPath + suffix);
            }
            catch { /* ignore */ }
        }
    }
}
/**
 * Delete all three SQLite files for a given db path (main, WAL, SHM).
 * Silently ignores individual deletion errors so a partial cleanup
 * does not abort the rest.
 */
export function deleteDBFiles(dbPath) {
    for (const suffix of ["", "-wal", "-shm"]) {
        try {
            unlinkSync(dbPath + suffix);
        }
        catch {
            // ignore — file may not exist
        }
    }
}
/**
 * Safely close a database connection. Swallows errors so callers can
 * always call this in a finally/cleanup path without try/catch.
 */
export function closeDB(db) {
    try {
        // Checkpoint WAL before close to prevent contention on restart (#103)
        db.pragma("wal_checkpoint(TRUNCATE)");
    }
    catch { /* WAL may not be active */ }
    try {
        db.close();
    }
    catch {
        // ignore
    }
}
// ─────────────────────────────────────────────────────────
// Default path helper
// ─────────────────────────────────────────────────────────
/**
 * Return the default per-process DB path for context-mode databases.
 * Uses the OS temp directory and embeds the current PID so multiple
 * server instances never share a file.
 */
export function defaultDBPath(prefix = "context-mode") {
    return join(tmpdir(), `${prefix}-${process.pid}.db`);
}
// ─────────────────────────────────────────────────────────
// Retry helper
// ─────────────────────────────────────────────────────────
/**
 * Retry a DB operation with exponential backoff on SQLITE_BUSY errors.
 * Catches errors containing "SQLITE_BUSY" or "database is locked" and
 * retries up to 3 times with delays: 100ms, 500ms, 2000ms.
 * If all retries fail, throws a descriptive error.
 * Pass custom delays for testing (e.g., [0, 0, 0] to skip waits).
 */
export function withRetry(fn, delays = [100, 500, 2000]) {
    let lastError;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
        try {
            return fn();
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!msg.includes("SQLITE_BUSY") && !msg.includes("database is locked")) {
                throw err;
            }
            lastError = err instanceof Error ? err : new Error(msg);
            if (attempt < delays.length) {
                const delay = delays[attempt];
                const start = Date.now();
                while (Date.now() - start < delay) { /* busy-wait for sync retry */ }
            }
        }
    }
    throw new Error(`SQLITE_BUSY: database is locked after ${delays.length} retries. ` +
        `Original error: ${lastError?.message}`);
}
// ─────────────────────────────────────────────────────────
// Corrupt DB recovery (#244)
// ─────────────────────────────────────────────────────────
/**
 * Detect SQLite corruption errors that warrant a rename-and-recreate.
 * Matches SQLITE_CORRUPT, SQLITE_NOTADB, and their human-readable equivalents.
 */
export function isSQLiteCorruptionError(msg) {
    return (msg.includes("SQLITE_CORRUPT") ||
        msg.includes("SQLITE_NOTADB") ||
        msg.includes("database disk image is malformed") ||
        msg.includes("file is not a database"));
}
/**
 * Rename a corrupt DB and its WAL/SHM files so a fresh DB can be created.
 * Best-effort — individual rename failures are silently ignored.
 */
export function renameCorruptDB(dbPath) {
    const ts = Date.now();
    for (const suffix of ["", "-wal", "-shm"]) {
        try {
            renameSync(dbPath + suffix, `${dbPath}${suffix}.corrupt-${ts}`);
        }
        catch { /* file may not exist */ }
    }
}
// ─────────────────────────────────────────────────────────
// Base class
// ─────────────────────────────────────────────────────────
/**
 * SQLiteBase — minimal base class that handles open/close/cleanup lifecycle.
 *
 * Subclasses call `super(dbPath)` to open the database with WAL pragmas
 * applied, then implement `initSchema()` and `prepareStatements()`.
 *
 * The `db` getter exposes the raw `DatabaseInstance` to subclasses only.
 */
/**
 * Track all live DatabaseInstance objects so we can close them on process exit.
 * Prevents better-sqlite3 segfaults caused by V8 garbage-collecting Database
 * objects after the native addon context is already torn down.
 *
 * Uses a global symbol so the set and exit handler survive vitest's module
 * re-imports within the same fork process (ESM isolate mode clears
 * module-level state but globalThis persists).
 */
const _kLiveDBs = Symbol.for("__context_mode_live_dbs__");
const _liveDBs = (() => {
    const g = globalThis;
    if (!g[_kLiveDBs]) {
        g[_kLiveDBs] = new Set();
        process.on("exit", () => {
            for (const db of g[_kLiveDBs]) {
                closeDB(db);
            }
            g[_kLiveDBs].clear();
        });
    }
    return g[_kLiveDBs];
})();
export class SQLiteBase {
    #dbPath;
    #db;
    constructor(dbPath) {
        const Database = loadDatabase();
        this.#dbPath = dbPath;
        cleanOrphanedWALFiles(dbPath);
        let db;
        try {
            db = new Database(dbPath, { timeout: 30000 });
            applyWALPragmas(db);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (isSQLiteCorruptionError(msg)) {
                renameCorruptDB(dbPath);
                cleanOrphanedWALFiles(dbPath);
                try {
                    db = new Database(dbPath, { timeout: 30000 });
                    applyWALPragmas(db);
                }
                catch (retryErr) {
                    throw new Error(`Failed to create fresh DB after renaming corrupt file: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`);
                }
            }
            else {
                throw err;
            }
        }
        this.#db = db;
        _liveDBs.add(this.#db);
        this.initSchema();
        this.prepareStatements();
    }
    /** Raw database instance — available to subclasses only. */
    get db() {
        return this.#db;
    }
    /** The path this database was opened from. */
    get dbPath() {
        return this.#dbPath;
    }
    /** Close the database connection without deleting files. */
    close() {
        _liveDBs.delete(this.#db);
        closeDB(this.#db);
    }
    withRetry(fn) {
        return withRetry(fn);
    }
    /**
     * Close the connection and delete all associated DB files (main, WAL, SHM).
     * Call on process exit or at end of session lifecycle.
     */
    cleanup() {
        _liveDBs.delete(this.#db);
        closeDB(this.#db);
        deleteDBFiles(this.#dbPath);
    }
}
