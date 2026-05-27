#!/usr/bin/env node
import { ContentStore } from "./store.js";
/**
 * Parse FTS5 highlight markers to find match positions in the
 * original (marker-free) text. Returns character offsets into the
 * stripped content where each matched token begins.
 */
export declare function positionsFromHighlight(highlighted: string): number[];
export declare function extractSnippet(content: string, query: string, maxLen?: number, highlighted?: string): string;
export declare function formatBatchQueryResults(store: ContentStore, queries: string[], source: string, maxOutput?: number): string[];
export interface BatchCommand {
    label: string;
    command: string;
}
export interface BatchRunResult {
    outputs: string[];
    timedOut: boolean;
}
export interface BatchRunOptions {
    /**
     * Total budget (concurrency=1, shared) or per-command (concurrency>1).
     * When `undefined`, no server-side timer fires — the MCP host's RPC
     * timeout governs (Issue #406).
     */
    timeout: number | undefined;
    concurrency: number;
    nodeOptsPrefix: string;
    onFsBytes?: (bytes: number) => void;
}
interface BatchExecutor {
    execute(input: {
        language: "shell";
        code: string;
        timeout: number | undefined;
    }): Promise<{
        stdout: string;
        timedOut?: boolean;
    }>;
}
export declare function buildBatchNodeOptionsPrefix(shellPath: string, preloadPath: string): string;
/**
 * Execute batch commands. concurrency=1 preserves the legacy serial path
 * (shared timeout budget + cascading skip-on-timeout). concurrency>1 runs
 * commands concurrently with at most N in flight; each command receives the
 * full timeout, output is collated by input index, and per-command timeouts
 * record `(timed out)` blocks without skipping siblings.
 */
export declare function runBatchCommands(commands: BatchCommand[], opts: BatchRunOptions, executor: BatchExecutor): Promise<BatchRunResult>;
/**
 * Classify an IP address.
 *   - "block":    always blocked (link-local/IMDS/multicast/reserved/malformed)
 *   - "private":  loopback or RFC1918 — allowed by default, blocked in strict mode
 *   - "public":   safe to fetch
 *
 * Exported (via the function name) so SSRF tests can exercise the matcher directly.
 */
export declare function classifyIp(ip: string): "block" | "private" | "public";
export {};
