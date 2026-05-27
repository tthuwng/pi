/**
 * lifecycle — Process lifecycle guard for MCP server.
 *
 * Detects parent process death (ppid polling) and OS signals to prevent
 * orphaned MCP server processes consuming 100% CPU (issue #103).
 *
 * Stdin close is NOT used as a *standalone* shutdown signal — the MCP stdio
 * transport owns stdin and transient pipe events cause spurious -32000
 * errors (#236). We do, however, treat stdin EOF as a hint to re-run the
 * parent-liveness probe immediately (instead of waiting up to 30 s for the
 * next poll tick), which closes the multi-day CPU-spin window seen in
 * #311/#388 without reintroducing the false-positive shutdowns of #236.
 *
 * Cross-platform: macOS, Linux, Windows.
 */
export interface LifecycleGuardOptions {
    /** Interval in ms to check parent liveness. Default: 30_000 */
    checkIntervalMs?: number;
    /** Called when parent death or OS signal is detected. */
    onShutdown: () => void;
    /** Injectable parent-alive check (for testing). Default: ppid-based check. */
    isParentAlive?: () => boolean;
}
/** Injectable dependencies for {@link makeDefaultIsParentAlive}. */
export interface IsParentAliveDeps {
    /** Read the current ppid. Default: `() => process.ppid`. */
    getPpid?: () => number;
    /** Read the grandparent ppid. Default: ps-based POSIX probe, NaN on Windows. */
    readGrandparentPpid?: () => number;
}
/**
 * Build a parent-liveness check that handles the npm-exec wrapper case (#311).
 *
 * A plain ppid comparison misses Claude Code sessions launched via
 * `start.mjs → npm exec → context-mode server`: when Claude Code dies,
 * `start.mjs` reparents to init but `npm exec` stays alive, so the server's
 * direct ppid never changes. We additionally check whether the grandparent
 * process has been reparented to init (PID 1). When the original grandparent
 * was already 1 (daemonized startup) the check is skipped, and on Windows
 * where there's no cheap `ps` equivalent we also skip — so this change is
 * strictly additive to the previous behavior.
 *
 * Exported for unit-testing with injected readers. Production code uses
 * {@link defaultIsParentAlive} (captured once at module load).
 */
export declare function makeDefaultIsParentAlive(deps?: IsParentAliveDeps): () => boolean;
/**
 * Start the lifecycle guard. Returns a cleanup function.
 * Skipped automatically when stdin is a TTY (e.g. OpenCode ts-plugin).
 */
export declare function startLifecycleGuard(opts: LifecycleGuardOptions): () => void;
