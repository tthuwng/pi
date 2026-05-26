import * as fs from "node:fs";
import * as path from "node:path";
import { ASYNC_DIR } from "./types.ts";

const DEFAULT_ASYNC_RUN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const RETAINED_STATES = new Set(["queued", "running", "paused"]);

export interface AsyncRunCleanupOptions {
	now?: () => number;
	maxAgeMs?: number;
}

export interface AsyncRunCleanupResult {
	removed: number;
}

function shouldRetainAsyncRun(dirPath: string): boolean {
	try {
		const status = JSON.parse(
			fs.readFileSync(path.join(dirPath, "status.json"), "utf-8"),
		) as { state?: unknown };
		return (
			typeof status.state === "string" && RETAINED_STATES.has(status.state)
		);
	} catch {
		return false;
	}
}

export function cleanupOldAsyncRunDirs(
	asyncDirRoot = ASYNC_DIR,
	options: AsyncRunCleanupOptions = {},
): AsyncRunCleanupResult {
	if (!fs.existsSync(asyncDirRoot)) return { removed: 0 };
	const now = options.now?.() ?? Date.now();
	const maxAgeMs = options.maxAgeMs ?? DEFAULT_ASYNC_RUN_MAX_AGE_MS;
	let entries: string[];
	try {
		entries = fs.readdirSync(asyncDirRoot);
	} catch {
		return { removed: 0 };
	}

	let removed = 0;
	for (const entry of entries) {
		const dirPath = path.join(asyncDirRoot, entry);
		try {
			const stat = fs.statSync(dirPath);
			if (
				!stat.isDirectory() ||
				now - stat.mtimeMs <= maxAgeMs ||
				shouldRetainAsyncRun(dirPath)
			)
				continue;
			fs.rmSync(dirPath, { recursive: true, force: true });
			removed += 1;
		} catch {
			// Async run cleanup is best-effort. Keep startup resilient if a run
			// disappears or becomes unreadable while cleanup is scanning.
		}
	}

	return { removed };
}
