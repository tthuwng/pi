import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildCompletionKey, markSeenWithTtl } from "./completion-dedupe.ts";
import { createFileCoalescer } from "../../shared/file-coalescer.ts";
import {
	SUBAGENT_ASYNC_COMPLETE_EVENT,
	type IntercomEventBus,
	type SubagentState,
} from "../../shared/types.ts";
import {
	buildSubagentResultIntercomPayload,
	deliverSubagentResultIntercomEvent,
	resolveSubagentResultStatus,
} from "../../intercom/result-intercom.ts";

const WATCHER_RESTART_DELAY_MS = 3000;
const POLL_INTERVAL_MS = 3000;
const RESULT_CLAIM_STALE_MS = 10 * 60 * 1000;
const RESULT_CLAIM_CLEANUP_RETRY_MS = 1000;

type ResultWatcherFs = Pick<
	typeof fs,
	| "existsSync"
	| "readFileSync"
	| "writeFileSync"
	| "unlinkSync"
	| "readdirSync"
	| "mkdirSync"
	| "watch"
	| "openSync"
	| "closeSync"
	| "statSync"
	| "renameSync"
>;

type ResultWatcherTimers = {
	setTimeout: typeof setTimeout;
	clearTimeout: typeof clearTimeout;
	setInterval: typeof setInterval;
	clearInterval: typeof clearInterval;
};

type ResultWatcherDeps = {
	fs?: ResultWatcherFs;
	timers?: ResultWatcherTimers;
	now?: () => number;
	claimStaleMs?: number;
	claimCleanupRetryMs?: number;
};

function getErrorCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error
		? (error as NodeJS.ErrnoException).code
		: undefined;
}

function isNotFoundError(error: unknown): boolean {
	return getErrorCode(error) === "ENOENT";
}

function shouldFallBackToPolling(error: unknown): boolean {
	const code = getErrorCode(error);
	return code === "EMFILE" || code === "ENOSPC";
}

function isAlreadyExistsError(error: unknown): boolean {
	return getErrorCode(error) === "EEXIST";
}

export function createResultWatcher(
	pi: { events: IntercomEventBus },
	state: SubagentState,
	resultsDir: string,
	completionTtlMs: number,
	deps: ResultWatcherDeps = {},
): {
	startResultWatcher: () => void;
	primeExistingResults: () => void;
	stopResultWatcher: () => void;
} {
	const fsApi = deps.fs ?? fs;
	const timers = deps.timers ?? { setTimeout, clearTimeout, setInterval, clearInterval };
	const nowMs = deps.now ?? Date.now;
	const claimStaleMs = deps.claimStaleMs ?? RESULT_CLAIM_STALE_MS;
	const claimCleanupRetryMs = deps.claimCleanupRetryMs ?? RESULT_CLAIM_CLEANUP_RETRY_MS;

	const readClaimSnapshot = (claimPath: string) => {
		const content = fsApi.readFileSync(claimPath, "utf-8");
		const stat = fsApi.statSync(claimPath);
		return {
			content,
			mtimeMs: stat.mtimeMs,
			ageMs: Math.max(0, nowMs() - stat.mtimeMs),
		};
	};

	const parseClaimContent = (content: string) => {
		try {
			return JSON.parse(content) as { token?: unknown; delivered?: unknown };
		} catch {
			return {};
		}
	};

	const isDeliveredClaim = (content: string) => parseClaimContent(content).delivered === true;

	const claimRecheckDelay = (claimPath: string) => {
		try {
			const snapshot = readClaimSnapshot(claimPath);
			if (isDeliveredClaim(snapshot.content)) return claimCleanupRetryMs;
			return Math.max(0, claimStaleMs - snapshot.ageMs);
		} catch (error) {
			if (isNotFoundError(error)) return 0;
			throw error;
		}
	};

	const isStaleClaim = (snapshot: { ageMs: number }) => snapshot.ageMs >= claimStaleMs;

	type ResultClaim = { path: string; token: string };
	const retainedClaims = new Map<string, ResultClaim>();

	const writeClaimMetadata = (claimPath: string, token: string) => {
		fsApi.writeFileSync(
			claimPath,
			JSON.stringify({ pid: process.pid, createdAt: nowMs(), token }, null, 2),
			"utf-8",
		);
	};

	const claimMatchesToken = (claim: ResultClaim) => {
		try {
			return parseClaimContent(fsApi.readFileSync(claim.path, "utf-8")).token === claim.token;
		} catch (error) {
			if (isNotFoundError(error)) return false;
			return false;
		}
	};

	const markClaimDelivered = (claim: ResultClaim) => {
		const content = fsApi.readFileSync(claim.path, "utf-8");
		const parsed = parseClaimContent(content);
		if (parsed.token !== claim.token) return false;
		fsApi.writeFileSync(
			claim.path,
			JSON.stringify({ ...parsed, token: claim.token, delivered: true, deliveredAt: nowMs() }, null, 2),
			"utf-8",
		);
		return true;
	};

	const createClaim = (claimPath: string): ResultClaim => {
		const token = randomUUID();
		const fd = fsApi.openSync(claimPath, "wx");
		try {
			writeClaimMetadata(claimPath, token);
			return { path: claimPath, token };
		} catch (error) {
			try {
				fsApi.unlinkSync(claimPath);
			} catch (cleanupError) {
				if (!isNotFoundError(cleanupError)) throw cleanupError;
			}
			throw error;
		} finally {
			fsApi.closeSync(fd);
		}
	};

	const tryRestoreTempClaim = (tempPath: string, claimPath: string) => {
		try {
			fsApi.renameSync(tempPath, claimPath);
			return true;
		} catch (error) {
			if (isAlreadyExistsError(error) || isNotFoundError(error)) return false;
			throw error;
		}
	};

	const findOrphanedTempClaims = (claimPath: string) => {
		const dir = path.dirname(claimPath);
		const base = path.basename(claimPath);
		try {
			return fsApi.readdirSync(dir)
				.filter((file) => file.startsWith(`${base}.cleanup-`) || file.startsWith(`${base}.reclaim-`))
				.map((file) => path.join(dir, file));
		} catch (error) {
			if (isNotFoundError(error)) return [];
			throw error;
		}
	};

	const recoverOrphanedTempClaim = (resultPath: string, claimPath: string) => {
		const tempPaths = findOrphanedTempClaims(claimPath);
		if (tempPaths.length === 0) return false;
		const tempContents = tempPaths.map((tempPath) => {
			try {
				return { tempPath, content: fsApi.readFileSync(tempPath, "utf-8") };
			} catch (error) {
				if (isNotFoundError(error)) return null;
				throw error;
			}
		}).filter((entry): entry is { tempPath: string; content: string } => entry !== null);
		if (tempContents.length === 0) return false;
		const delivered = tempContents.find((entry) => isDeliveredClaim(entry.content));
		if (delivered) {
			try {
				fsApi.unlinkSync(resultPath);
			} catch (error) {
				if (!isNotFoundError(error)) {
					if (!tryRestoreTempClaim(delivered.tempPath, claimPath) && !fsApi.existsSync(claimPath)) {
						fsApi.writeFileSync(claimPath, delivered.content);
					}
					return true;
				}
			}
			for (const { tempPath } of tempContents) {
				try {
					fsApi.unlinkSync(tempPath);
				} catch (error) {
					if (!isNotFoundError(error)) throw error;
				}
			}
			return true;
		}
		return tryRestoreTempClaim(tempContents[0].tempPath, claimPath);
	};

	const cleanupDeliveredResult = (resultPath: string, claimPath: string, snapshot: ReturnType<typeof readClaimSnapshot>) => {
		const cleanupPath = `${claimPath}.cleanup-${randomUUID()}`;
		try {
			fsApi.renameSync(claimPath, cleanupPath);
		} catch (error) {
			if (isNotFoundError(error)) return false;
			throw error;
		}
		const restoreCleanupClaim = (content: string) => {
			try {
				fsApi.renameSync(cleanupPath, claimPath);
			} catch (restoreError) {
				if (!isAlreadyExistsError(restoreError) && !isNotFoundError(restoreError)) throw restoreError;
				if (isNotFoundError(restoreError) && !fsApi.existsSync(claimPath)) fsApi.writeFileSync(claimPath, content);
			}
		};
		try {
			const cleanupContent = fsApi.readFileSync(cleanupPath, "utf-8");
			if (cleanupContent !== snapshot.content) {
				restoreCleanupClaim(cleanupContent);
				return false;
			}
			try {
				fsApi.unlinkSync(resultPath);
			} catch (error) {
				if (isNotFoundError(error)) return true;
				restoreCleanupClaim(cleanupContent);
				return false;
			}
			return true;
		} finally {
			try {
				fsApi.unlinkSync(cleanupPath);
			} catch (error) {
				if (!isNotFoundError(error)) throw error;
			}
		}
	};

	const tryClaimResult = (resultPath: string) => {
		const claimPath = `${resultPath}.claim`;
		if (!fsApi.existsSync(resultPath)) return null;
		const retainedClaim = retainedClaims.get(resultPath);
		if (retainedClaim && claimMatchesToken(retainedClaim)) return retainedClaim;
		if (retainedClaim) retainedClaims.delete(resultPath);
		if (!fsApi.existsSync(claimPath) && recoverOrphanedTempClaim(resultPath, claimPath)) return null;
		try {
			return createClaim(claimPath);
		} catch (error) {
			if (!isAlreadyExistsError(error)) throw error;
		}

		let snapshot: ReturnType<typeof readClaimSnapshot>;
		try {
			snapshot = readClaimSnapshot(claimPath);
		} catch (error) {
			if (isNotFoundError(error)) return null;
			throw error;
		}
		if (isDeliveredClaim(snapshot.content)) {
			cleanupDeliveredResult(resultPath, claimPath, snapshot);
			return null;
		}
		if (!isStaleClaim(snapshot)) return null;

		const reclaimPath = `${claimPath}.reclaim-${randomUUID()}`;
		try {
			fsApi.renameSync(claimPath, reclaimPath);
		} catch (error) {
			if (isNotFoundError(error)) return null;
			throw error;
		}
		try {
			const reclaimedContent = fsApi.readFileSync(reclaimPath, "utf-8");
			if (reclaimedContent !== snapshot.content) {
				try {
					fsApi.renameSync(reclaimPath, claimPath);
				} catch (restoreError) {
					if (!isAlreadyExistsError(restoreError) && !isNotFoundError(restoreError)) throw restoreError;
				}
				return null;
			}
			if (!fsApi.existsSync(resultPath)) return null;
			try {
				return createClaim(claimPath);
			} catch (error) {
				if (isAlreadyExistsError(error)) return null;
				throw error;
			}
		} finally {
			try {
				fsApi.unlinkSync(reclaimPath);
			} catch (error) {
				if (!isNotFoundError(error)) throw error;
			}
		}
	};

	const retainClaim = (resultPath: string, claim: ResultClaim) => {
		if (claimMatchesToken(claim)) retainedClaims.set(resultPath, claim);
	};

	const releaseClaim = (claim: ResultClaim | null) => {
		if (!claim || !claimMatchesToken(claim)) return;
		try {
			fsApi.unlinkSync(claim.path);
		} catch (error) {
			if (!isNotFoundError(error)) throw error;
		}
		retainedClaims.delete(claim.path.slice(0, -".claim".length));
	};

	const resultFileForClaimArtifact = (file: string) => {
		const markerIndex = file.indexOf(".json.claim");
		if (markerIndex === -1) return undefined;
		return file.slice(0, markerIndex + ".json".length);
	};

	const cleanupOrphanedClaimArtifacts = (files: string[]) => {
		for (const file of files) {
			const resultFile = resultFileForClaimArtifact(file);
			if (!resultFile) continue;
			if (fsApi.existsSync(path.join(resultsDir, resultFile))) continue;
			try {
				fsApi.unlinkSync(path.join(resultsDir, file));
			} catch (error) {
				if (!isNotFoundError(error)) throw error;
			}
		}
	};

	const handleResult = async (file: string) => {
		const resultPath = path.join(resultsDir, file);
		if (!fsApi.existsSync(resultPath)) return;
		try {
			const data = JSON.parse(fsApi.readFileSync(resultPath, "utf-8")) as {
				id?: string;
				runId?: string;
				agent?: string;
				success?: boolean;
				state?: string;
				mode?: string;
				summary?: string;
				results?: Array<{
					agent?: string;
					output?: string;
					error?: string;
					success?: boolean;
					sessionFile?: string;
					artifactPaths?: { outputPath?: string };
					intercomTarget?: string;
				}>;
				sessionId?: string;
				cwd?: string;
				sessionFile?: string;
				asyncDir?: string;
				intercomTarget?: string;
			};
			if (data.sessionId && data.sessionId !== state.currentSessionId) return;
			if (!data.sessionId && data.cwd && data.cwd !== state.baseCwd) return;

			let claim: ReturnType<typeof tryClaimResult>;
			try {
				claim = tryClaimResult(resultPath);
			} catch (error) {
				if (fsApi.existsSync(resultPath)) state.resultFileCoalescer.schedule(file, claimCleanupRetryMs);
				throw error;
			}
			if (!claim) {
				const claimPath = `${resultPath}.claim`;
				if (fsApi.existsSync(resultPath)) {
					state.resultFileCoalescer.schedule(
						file,
						fsApi.existsSync(claimPath) ? claimRecheckDelay(claimPath) : claimCleanupRetryMs,
					);
				}
				return;
			}
			let releaseClaimAfterProcessing = true;
			try {
				const now = nowMs();
				const completionKey = buildCompletionKey(data, `result:${file}`);
				if (markSeenWithTtl(state.completionSeen, completionKey, now, completionTtlMs)) {
					try {
						if (!markClaimDelivered(claim)) {
							releaseClaimAfterProcessing = false;
							retainClaim(resultPath, claim);
							state.resultFileCoalescer.schedule(file, claimCleanupRetryMs);
							return;
						}
					} catch (error) {
						releaseClaimAfterProcessing = false;
						retainClaim(resultPath, claim);
						state.resultFileCoalescer.schedule(file, claimCleanupRetryMs);
						throw error;
					}
					try {
						fsApi.unlinkSync(resultPath);
					} catch (error) {
						if (isNotFoundError(error)) return;
						releaseClaimAfterProcessing = false;
						retainClaim(resultPath, claim);
						state.resultFileCoalescer.schedule(file, claimCleanupRetryMs);
						throw error;
					}
					return;
				}

				const intercomTarget = data.intercomTarget?.trim();
				if (intercomTarget) {
					const childResults = Array.isArray(data.results) && data.results.length > 0
						? data.results
						: [{
							agent: data.agent,
							output: data.summary,
							success: data.success,
						}];
					const runId = data.runId ?? data.id ?? file.replace(/\.json$/i, "");
					const mode = data.mode === "single" || data.mode === "parallel" || data.mode === "chain"
						? data.mode
						: childResults.length > 1 ? "chain" : "single";
					const payload = buildSubagentResultIntercomPayload({
						to: intercomTarget,
						runId,
						mode,
						source: "async",
						children: childResults.map((result = {}, index) => {
							const baseOutput = result.output ?? data.summary;
							const hasRealOutput = typeof baseOutput === "string" && baseOutput.trim().length > 0;
							const output = hasRealOutput ? baseOutput : "(no output)";
							const summary = result.success === false && result.error
								? `${result.error}${hasRealOutput ? `\n\nOutput:\n${baseOutput}` : ""}`
								: output;
							const sessionPath = result.sessionFile ?? (childResults.length === 1 ? data.sessionFile : undefined);
							return {
								agent: result.agent ?? data.agent ?? `step-${index + 1}`,
								status: resolveSubagentResultStatus({
									success: result.success,
									state: data.state === "paused" || typeof result.success !== "boolean" ? data.state : undefined,
								}),
								summary,
								index,
								artifactPath: result.artifactPaths?.outputPath,
								...(typeof sessionPath === "string" && fsApi.existsSync(sessionPath) ? { sessionPath } : {}),
								intercomTarget: result.intercomTarget,
							};
						}),
						asyncId: data.id,
						asyncDir: data.asyncDir,
					});
					const delivered = await deliverSubagentResultIntercomEvent(pi.events, payload);
					if (!delivered) {
						console.error(`Subagent async grouped result intercom delivery was not acknowledged for '${resultPath}'.`);
					}
				}

				pi.events.emit(SUBAGENT_ASYNC_COMPLETE_EVENT, data);
				try {
					if (!markClaimDelivered(claim)) {
						releaseClaimAfterProcessing = false;
						retainClaim(resultPath, claim);
						state.resultFileCoalescer.schedule(file, claimCleanupRetryMs);
						return;
					}
				} catch (error) {
					releaseClaimAfterProcessing = false;
					retainClaim(resultPath, claim);
					state.resultFileCoalescer.schedule(file, claimCleanupRetryMs);
					throw error;
				}
				try {
					fsApi.unlinkSync(resultPath);
				} catch (error) {
					if (isNotFoundError(error)) return;
					releaseClaimAfterProcessing = false;
					retainClaim(resultPath, claim);
					state.resultFileCoalescer.schedule(file, claimCleanupRetryMs);
					throw error;
				}
			} finally {
				if (releaseClaimAfterProcessing) releaseClaim(claim);
			}
		} catch (error) {
			if (isNotFoundError(error)) return;
			console.error(`Failed to process subagent result file '${resultPath}':`, error);
		}
	};

	state.resultFileCoalescer = createFileCoalescer((file) => {
		void handleResult(file);
	}, 50, timers);

	const primeExistingResults = () => {
		try {
			const files = fsApi.readdirSync(resultsDir);
			cleanupOrphanedClaimArtifacts(files);
			files
				.filter((f) => f.endsWith(".json"))
				.forEach((file) => {
					const claimPath = path.join(resultsDir, `${file}.claim`);
					state.resultFileCoalescer.schedule(file, fsApi.existsSync(claimPath) ? claimRecheckDelay(claimPath) : 0);
				});
		} catch (error) {
			if (isNotFoundError(error)) return;
			console.error(`Failed to scan subagent result directory '${resultsDir}':`, error);
		}
	};

	const clearWatcherScanTimer = () => {
		if (state.watcherScanTimer) timers.clearInterval(state.watcherScanTimer);
		state.watcherScanTimer = null;
	};

	const startPollingFallback = (reason: unknown) => {
		state.watcher?.close();
		state.watcher = null;
		clearWatcherScanTimer();
		if (state.watcherRestartTimer) return;

		console.error(
			`Subagent result watcher for '${resultsDir}' fell back to polling because native fs.watch is unavailable (${getErrorCode(reason) ?? "unknown error"}).`,
		);
		primeExistingResults();
		state.watcherRestartTimer = timers.setInterval(primeExistingResults, POLL_INTERVAL_MS);
		state.watcherRestartTimer.unref?.();
	};

	const scheduleRestart = () => {
		if (state.watcherRestartTimer) return;
		state.watcherRestartTimer = timers.setTimeout(() => {
			state.watcherRestartTimer = null;
			try {
				fsApi.mkdirSync(resultsDir, { recursive: true });
				startResultWatcher();
			} catch (error) {
				if (shouldFallBackToPolling(error)) {
					startPollingFallback(error);
					return;
				}
				console.error(`Failed to restart subagent result watcher for '${resultsDir}':`, error);
				scheduleRestart();
			}
		}, WATCHER_RESTART_DELAY_MS);
		state.watcherRestartTimer.unref?.();
	};

	const startResultWatcher = () => {
		if (state.watcher) return;
		if (state.watcherRestartTimer) {
			timers.clearTimeout(state.watcherRestartTimer);
			timers.clearInterval(state.watcherRestartTimer);
			state.watcherRestartTimer = null;
		}
		try {
			clearWatcherScanTimer();
			state.watcher = fsApi.watch(resultsDir, (ev, file) => {
				if (ev !== "rename" || !file) return;
				const fileName = file.toString();
				if (!fileName.endsWith(".json")) return;
				state.resultFileCoalescer.schedule(fileName);
			});
			state.watcher.on("error", (error) => {
				if (shouldFallBackToPolling(error)) {
					startPollingFallback(error);
					return;
				}
				console.error(`Subagent result watcher failed for '${resultsDir}':`, error);
				state.watcher?.close();
				state.watcher = null;
				clearWatcherScanTimer();
				scheduleRestart();
			});
			state.watcher.unref?.();
			primeExistingResults();
			state.watcherScanTimer = timers.setInterval(primeExistingResults, POLL_INTERVAL_MS);
			state.watcherScanTimer.unref?.();
		} catch (error) {
			if (shouldFallBackToPolling(error)) {
				startPollingFallback(error);
				return;
			}
			console.error(`Failed to start subagent result watcher for '${resultsDir}':`, error);
			state.watcher = null;
			scheduleRestart();
		}
	};

	const stopResultWatcher = () => {
		state.watcher?.close();
		state.watcher = null;
		clearWatcherScanTimer();
		if (state.watcherRestartTimer) {
			timers.clearTimeout(state.watcherRestartTimer);
			timers.clearInterval(state.watcherRestartTimer);
		}
		state.watcherRestartTimer = null;
		state.resultFileCoalescer.clear();
	};

	return { startResultWatcher, primeExistingResults, stopResultWatcher };
}
