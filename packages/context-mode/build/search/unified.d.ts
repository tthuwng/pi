/**
 * Unified multi-source search — merges ContentStore, SessionDB, and
 * auto-memory results into a single ranked or chronological result set.
 *
 * Used by ctx_search when sort="timeline" to search across all sources,
 * or sort="relevance" (default) for ContentStore-only BM25 search.
 */
import type { ContentStore } from "../store.js";
import type { SessionDB } from "../session/db.js";
import { type AutoMemoryAdapter } from "./auto-memory.js";
export interface UnifiedSearchResult {
    title: string;
    content: string;
    source: string;
    origin: "current-session" | "prior-session" | "auto-memory";
    timestamp?: string;
    rank?: number;
    matchLayer?: string;
    highlighted?: string;
    contentType?: "code" | "prose";
}
export interface SearchAllSourcesOpts {
    query: string;
    limit: number;
    store: ContentStore;
    sort?: "relevance" | "timeline";
    source?: string;
    contentType?: "code" | "prose";
    sessionDB?: SessionDB | null;
    projectDir?: string;
    configDir?: string;
    /** Detected platform adapter — used for adapter-aware auto-memory. */
    adapter?: AutoMemoryAdapter;
}
/**
 * Search across all available sources.
 *
 * - sort="relevance" (default): BM25-ranked results from ContentStore only.
 * - sort="timeline": chronological merge of ContentStore + SessionDB + auto-memory.
 *
 * Errors in any single source are caught and logged — partial results
 * are always returned.
 */
export declare function searchAllSources(opts: SearchAllSourcesOpts): UnifiedSearchResult[];
