import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import { loadTs } from "../support/load-ts.mjs";

const { createResultWatcher } = await loadTs("../../src/runs/background/result-watcher.ts");
const {
	SUBAGENT_ASYNC_COMPLETE_EVENT,
	SUBAGENT_RESULT_INTERCOM_DELIVERY_EVENT,
	SUBAGENT_RESULT_INTERCOM_EVENT,
} = await loadTs("../../src/shared/types.ts");

const RESULTS_DIR = "/tmp/pi-subagents-result-watcher-test";
const NOW = Date.parse("2026-06-11T12:00:00.000Z");

function wait(ms = 25) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate, timeoutMs = 250) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (predicate()) return;
		await wait(5);
	}
	assert.equal(predicate(), true);
}

function makeState() {
	return {
		baseCwd: "/repo",
		currentSessionId: "session-1",
		asyncJobs: new Map(),
		foregroundRuns: new Map(),
		foregroundControls: new Map(),
		cleanupTimers: new Map(),
		completionSeen: new Map(),
		lastUiContext: null,
		poller: null,
		watcher: null,
		watcherRestartTimer: null,
		watcherScanTimer: null,
	};
}

function makeEvents() {
	const emitted = [];
	const listeners = new Map();
	return {
		emitted,
		emit(type, payload) {
			emitted.push({ type, payload });
			for (const listener of listeners.get(type) ?? []) listener(payload);
			if (type === SUBAGENT_RESULT_INTERCOM_EVENT && payload?.requestId) {
				this.emit(SUBAGENT_RESULT_INTERCOM_DELIVERY_EVENT, {
					requestId: payload.requestId,
					delivered: true,
				});
			}
		},
		on(type, listener) {
			const set = listeners.get(type) ?? new Set();
			set.add(listener);
			listeners.set(type, set);
			return () => set.delete(listener);
		},
	};
}

function enoent(filePath) {
	const error = new Error(`ENOENT: no such file or directory, ${filePath}`);
	error.code = "ENOENT";
	return error;
}

function eexist(filePath) {
	const error = new Error(`EEXIST: file already exists, ${filePath}`);
	error.code = "EEXIST";
	return error;
}

function makeSharedFs(initialFiles = {}) {
	const files = new Map(
		Object.entries(initialFiles).map(([filePath, entry]) => [
			filePath,
			{
				content: entry.content ?? "",
				mtimeMs: entry.mtimeMs ?? NOW,
			},
		]),
	);
	let nextFd = 10;
	const fdPaths = new Map();
	return {
		existsSync(filePath) {
			return files.has(filePath);
		},
		readFileSync(filePath) {
			const entry = files.get(filePath);
			if (!entry) throw enoent(filePath);
			return entry.content;
		},
		writeFileSync(filePath, content) {
			files.set(filePath, { content: String(content), mtimeMs: NOW });
		},
		unlinkSync(filePath) {
			if (!files.delete(filePath)) throw enoent(filePath);
		},
		rmSync(filePath) {
			files.delete(filePath);
		},
		readdirSync(dirPath) {
			return [...files.keys()]
				.filter((filePath) => path.dirname(filePath) === dirPath)
				.map((filePath) => path.basename(filePath));
		},
		mkdirSync() {},
		watch() {
			return { on() {}, close() {}, unref() {} };
		},
		openSync(filePath, flags) {
			if (flags !== "wx") throw new Error(`unexpected open flags: ${flags}`);
			if (files.has(filePath)) throw eexist(filePath);
			files.set(filePath, { content: "", mtimeMs: NOW });
			const fd = nextFd++;
			fdPaths.set(fd, filePath);
			return fd;
		},
		closeSync(fd) {
			fdPaths.delete(fd);
		},
		renameSync(oldPath, newPath) {
			const entry = files.get(oldPath);
			if (!entry) throw enoent(oldPath);
			if (files.has(newPath)) throw eexist(newPath);
			files.set(newPath, entry);
			files.delete(oldPath);
		},
		statSync(filePath) {
			const entry = files.get(filePath);
			if (!entry) throw enoent(filePath);
			return { mtimeMs: entry.mtimeMs };
		},
		_files: files,
	};
}

function writeResult(id, overrides = {}) {
	return JSON.stringify({
		id,
		runId: id,
		agent: "reviewer",
		success: true,
		state: "complete",
		summary: "done",
		sessionId: "session-1",
		...overrides,
	});
}

test("only one watcher claims and delivers a result observed by duplicate Pi processes", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-1.json");
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-1", { intercomTarget: "parent" }) },
	});
	const events = makeEvents();
	const watcherA = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => NOW,
	});
	const watcherB = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => NOW,
	});

	watcherA.primeExistingResults();
	watcherB.primeExistingResults();
	await waitUntil(() => !fsApi.existsSync(resultPath));

	assert.equal(
		events.emitted.filter((event) => event.type === SUBAGENT_RESULT_INTERCOM_EVENT).length,
		1,
	);
	assert.equal(fsApi.existsSync(`${resultPath}.claim`), false);
	watcherA.stopResultWatcher();
	watcherB.stopResultWatcher();
});

test("fresh claim held by another process leaves result untouched for later retry", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-2.json");
	const claimPath = `${resultPath}.claim`;
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-2") },
		[claimPath]: { content: JSON.stringify({ pid: 12345, createdAt: NOW }), mtimeMs: NOW },
	});
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => NOW,
	});

	watcher.primeExistingResults();
	await wait();

	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 0);
	assert.equal(fsApi.existsSync(resultPath), true);
	assert.equal(fsApi.existsSync(claimPath), true);
	watcher.stopResultWatcher();
});

test("stale claim is reclaimed and cleaned after result delivery", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-3.json");
	const claimPath = `${resultPath}.claim`;
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-3") },
		[claimPath]: {
			content: JSON.stringify({ pid: 12345, createdAt: NOW - 60 * 60 * 1000 }),
			mtimeMs: NOW - 60 * 60 * 1000,
		},
	});
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => NOW,
	});

	watcher.primeExistingResults();
	await waitUntil(() => !fsApi.existsSync(resultPath));

	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 1);
	assert.equal(fsApi.existsSync(resultPath), false);
	assert.equal(fsApi.existsSync(claimPath), false);
	watcher.stopResultWatcher();
});

test("fresh claim is rechecked and reclaimed after it becomes stale without watcher restart", async () => {
	let currentNow = NOW;
	const resultPath = path.join(RESULTS_DIR, "run-4.json");
	const claimPath = `${resultPath}.claim`;
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-4") },
		[claimPath]: { content: JSON.stringify({ pid: 12345, createdAt: NOW }), mtimeMs: NOW },
	});
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => currentNow,
		claimStaleMs: 10,
	});

	watcher.primeExistingResults();
	await wait(5);
	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 0);
	assert.equal(fsApi.existsSync(resultPath), true);

	currentNow = NOW + 20;
	await waitUntil(() => !fsApi.existsSync(resultPath));

	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 1);
	assert.equal(fsApi.existsSync(claimPath), false);
	watcher.stopResultWatcher();
});

test("aged fresh claim recheck waits only until remaining stale time", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-5.json");
	const claimPath = `${resultPath}.claim`;
	const scheduled = [];
	const timers = {
		setTimeout(handler, delayMs) {
			const timer = { handler, delayMs };
			scheduled.push(timer);
			return timer;
		},
		clearTimeout(timer) {
			const index = scheduled.indexOf(timer);
			if (index >= 0) scheduled.splice(index, 1);
		},
		setInterval(handler, delayMs) {
			return this.setTimeout(handler, delayMs);
		},
		clearInterval(timer) {
			this.clearTimeout(timer);
		},
	};
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-5") },
		[claimPath]: {
			content: JSON.stringify({ pid: 12345, createdAt: NOW - 80 }),
			mtimeMs: NOW - 80,
		},
	});
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		timers,
		now: () => NOW,
		claimStaleMs: 100,
	});

	watcher.primeExistingResults();
	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 0);
	assert.equal(scheduled[0].delayMs, 20);
	watcher.stopResultWatcher();
});

test("exact stale-boundary claim is reclaimed instead of spinning", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-5a.json");
	const claimPath = `${resultPath}.claim`;
	const scheduled = [];
	const timers = {
		setTimeout(handler, delayMs) {
			const timer = { handler, delayMs };
			scheduled.push(timer);
			return timer;
		},
		clearTimeout(timer) {
			const index = scheduled.indexOf(timer);
			if (index >= 0) scheduled.splice(index, 1);
		},
		setInterval(handler, delayMs) {
			return this.setTimeout(handler, delayMs);
		},
		clearInterval(timer) {
			this.clearTimeout(timer);
		},
	};
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-5a") },
		[claimPath]: {
			content: JSON.stringify({ pid: 12345, createdAt: NOW - 100 }),
			mtimeMs: NOW - 100,
		},
	});
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		timers,
		now: () => NOW,
		claimStaleMs: 100,
	});

	watcher.primeExistingResults();
	assert.equal(scheduled[0].delayMs, 0);
	scheduled.shift().handler();
	await wait(0);

	assert.equal(fsApi.existsSync(resultPath), false);
	assert.equal(fsApi.existsSync(claimPath), false);
	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 1);
	watcher.stopResultWatcher();
});

test("delivered claim reschedules earlier than pending stale retry", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-5b.json");
	const claimPath = `${resultPath}.claim`;
	const scheduled = [];
	const timers = {
		setTimeout(handler, delayMs) {
			const timer = { handler, delayMs };
			scheduled.push(timer);
			return timer;
		},
		clearTimeout(timer) {
			const index = scheduled.indexOf(timer);
			if (index >= 0) scheduled.splice(index, 1);
		},
		setInterval(handler, delayMs) {
			return this.setTimeout(handler, delayMs);
		},
		clearInterval(timer) {
			this.clearTimeout(timer);
		},
	};
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-5b") },
		[claimPath]: {
			content: JSON.stringify({ pid: 12345, createdAt: NOW }),
			mtimeMs: NOW,
		},
	});
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		timers,
		now: () => NOW,
		claimCleanupRetryMs: 5,
		claimStaleMs: 100,
	});

	watcher.primeExistingResults();
	assert.equal(scheduled.length, 1);
	assert.equal(scheduled[0].delayMs, 100);
	fsApi.writeFileSync(claimPath, JSON.stringify({ pid: 12345, createdAt: NOW, token: "done", delivered: true }));
	watcher.primeExistingResults();
	assert.equal(scheduled.length, 1);
	assert.equal(scheduled[0].delayMs, 5);
	scheduled.shift().handler();
	await wait(0);

	assert.equal(fsApi.existsSync(resultPath), false);
	assert.equal(fsApi.existsSync(claimPath), false);
	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 0);
	watcher.stopResultWatcher();
});

test("delivered cleanup rename loss retries orphan temp recovery", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-5c.json");
	const claimPath = `${resultPath}.claim`;
	const otherCleanupPath = `${claimPath}.cleanup-other`;
	const scheduled = [];
	const timers = {
		setTimeout(handler, delayMs) {
			const timer = { handler, delayMs };
			scheduled.push(timer);
			return timer;
		},
		clearTimeout(timer) {
			const index = scheduled.indexOf(timer);
			if (index >= 0) scheduled.splice(index, 1);
		},
		setInterval(handler, delayMs) {
			return this.setTimeout(handler, delayMs);
		},
		clearInterval(timer) {
			this.clearTimeout(timer);
		},
	};
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-5c") },
		[claimPath]: {
			content: JSON.stringify({ pid: 12345, createdAt: NOW, token: "done", delivered: true }),
			mtimeMs: NOW,
		},
	});
	const originalRenameSync = fsApi.renameSync.bind(fsApi);
	let loseRename = true;
	fsApi.renameSync = (oldPath, newPath) => {
		if (oldPath === claimPath && newPath.startsWith(`${claimPath}.cleanup-`) && loseRename) {
			loseRename = false;
			originalRenameSync(claimPath, otherCleanupPath);
			throw enoent(claimPath);
		}
		return originalRenameSync(oldPath, newPath);
	};
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		timers,
		now: () => NOW,
		claimCleanupRetryMs: 5,
	});

	watcher.primeExistingResults();
	assert.equal(scheduled[0].delayMs, 5);
	scheduled.shift().handler();
	await wait(0);
	assert.equal(fsApi.existsSync(resultPath), true);
	assert.equal(fsApi.existsSync(otherCleanupPath), true);
	assert.equal(scheduled.length, 1);
	assert.equal(scheduled[0].delayMs, 5);
	scheduled.shift().handler();
	await wait(0);

	assert.equal(fsApi.existsSync(resultPath), false);
	assert.equal(fsApi.existsSync(otherCleanupPath), false);
	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 0);
	watcher.stopResultWatcher();
});

test("stale reclaim rename loss retries orphan temp recovery", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-5d.json");
	const claimPath = `${resultPath}.claim`;
	const otherReclaimPath = `${claimPath}.reclaim-other`;
	const scheduled = [];
	const timers = {
		setTimeout(handler, delayMs) {
			const timer = { handler, delayMs };
			scheduled.push(timer);
			return timer;
		},
		clearTimeout(timer) {
			const index = scheduled.indexOf(timer);
			if (index >= 0) scheduled.splice(index, 1);
		},
		setInterval(handler, delayMs) {
			return this.setTimeout(handler, delayMs);
		},
		clearInterval(timer) {
			this.clearTimeout(timer);
		},
	};
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-5d") },
		[claimPath]: {
			content: JSON.stringify({ pid: 12345, createdAt: NOW - 60 * 60 * 1000, token: "old" }),
			mtimeMs: NOW - 60 * 60 * 1000,
		},
	});
	const originalRenameSync = fsApi.renameSync.bind(fsApi);
	let loseRename = true;
	fsApi.renameSync = (oldPath, newPath) => {
		if (oldPath === claimPath && newPath.startsWith(`${claimPath}.reclaim-`) && loseRename) {
			loseRename = false;
			originalRenameSync(claimPath, otherReclaimPath);
			throw enoent(claimPath);
		}
		return originalRenameSync(oldPath, newPath);
	};
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		timers,
		now: () => NOW,
		claimCleanupRetryMs: 5,
	});

	watcher.primeExistingResults();
	assert.equal(scheduled[0].delayMs, 0);
	scheduled.shift().handler();
	await wait(0);
	assert.equal(fsApi.existsSync(resultPath), true);
	assert.equal(fsApi.existsSync(otherReclaimPath), true);
	assert.equal(scheduled.length, 1);
	assert.equal(scheduled[0].delayMs, 5);
	scheduled.shift().handler();
	await wait(0);
	assert.equal(fsApi.existsSync(resultPath), true);
	assert.equal(fsApi.existsSync(claimPath), true);
	assert.equal(scheduled.length, 1);
	assert.equal(scheduled[0].delayMs, 0);
	scheduled.shift().handler();
	await wait(0);

	assert.equal(fsApi.existsSync(resultPath), false);
	assert.equal(fsApi.existsSync(claimPath), false);
	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 1);
	watcher.stopResultWatcher();
});

test("stale snapshot does not combine old mtime with newer claim content", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-6.json");
	const claimPath = `${resultPath}.claim`;
	const oldClaim = JSON.stringify({ pid: 111, createdAt: NOW - 60 * 60 * 1000, token: "old-token" });
	const newClaim = JSON.stringify({ pid: 222, createdAt: NOW, token: "new-token" });
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-6") },
		[claimPath]: { content: oldClaim, mtimeMs: NOW - 60 * 60 * 1000 },
	});
	const originalStatSync = fsApi.statSync.bind(fsApi);
	let replacedAfterStat = false;
	fsApi.statSync = (filePath) => {
		const stat = originalStatSync(filePath);
		if (filePath === claimPath && !replacedAfterStat) {
			replacedAfterStat = true;
			fsApi.writeFileSync(claimPath, newClaim);
		}
		return stat;
	};
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => NOW,
	});

	watcher.primeExistingResults();
	await wait(25);

	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 0);
	assert.equal(fsApi.existsSync(resultPath), true);
	assert.equal(fsApi.readFileSync(claimPath), newClaim);
	watcher.stopResultWatcher();
});

test("stale reclaim does not delete a newer claim that appears during reclaim", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-6.json");
	const claimPath = `${resultPath}.claim`;
	const oldClaim = JSON.stringify({ pid: 111, createdAt: NOW - 60 * 60 * 1000, token: "old-token" });
	const newClaim = JSON.stringify({ pid: 222, createdAt: NOW, token: "new-token" });
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-6") },
		[claimPath]: { content: oldClaim, mtimeMs: NOW - 60 * 60 * 1000 },
	});
	const originalRenameSync = fsApi.renameSync.bind(fsApi);
	fsApi.renameSync = (oldPath, newPath) => {
		originalRenameSync(oldPath, newPath);
		if (oldPath === claimPath && newPath.startsWith(`${claimPath}.reclaim-`)) {
			fsApi.writeFileSync(claimPath, newClaim);
		}
	};
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => NOW,
	});

	watcher.primeExistingResults();
	await wait(25);

	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 0);
	assert.equal(fsApi.existsSync(resultPath), true);
	assert.equal(fsApi.readFileSync(claimPath), newClaim);
	watcher.stopResultWatcher();
});

test("session context rescan delivers results skipped before session id is known", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-6c.json");
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-6c") },
	});
	const state = makeState();
	state.currentSessionId = null;
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, state, RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => NOW,
	});

	watcher.primeExistingResults();
	await wait(10);
	assert.equal(fsApi.existsSync(resultPath), true);
	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 0);

	state.currentSessionId = "session-1";
	watcher.primeExistingResults();
	await waitUntil(() => !fsApi.existsSync(resultPath));

	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 1);
	watcher.stopResultWatcher();
});

test("healthy watcher periodic scan preserves fresh claim backoff", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-6e.json");
	const claimPath = `${resultPath}.claim`;
	const scheduled = [];
	const timers = {
		setTimeout(handler, delayMs) {
			const timer = { handler, delayMs, interval: false };
			scheduled.push(timer);
			return timer;
		},
		clearTimeout(timer) {
			const index = scheduled.indexOf(timer);
			if (index >= 0) scheduled.splice(index, 1);
		},
		setInterval(handler, delayMs) {
			const timer = { handler, delayMs, interval: true, unref() {} };
			scheduled.push(timer);
			return timer;
		},
		clearInterval(timer) {
			this.clearTimeout(timer);
		},
	};
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-6e") },
		[claimPath]: { content: JSON.stringify({ pid: 12345, createdAt: NOW }), mtimeMs: NOW },
	});
	fsApi.watch = () => ({ on() { return this; }, close() {}, unref() {} });
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		timers,
		now: () => NOW,
		claimStaleMs: 100,
	});

	watcher.startResultWatcher();
	assert.equal(scheduled.some((timer) => !timer.interval && timer.delayMs === 100), true);
	const scanTimer = scheduled.find((timer) => timer.interval && timer.delayMs === 3000);
	assert.ok(scanTimer);
	scanTimer.handler();
	const immediate = scheduled.find((timer) => !timer.interval && timer.delayMs === 0);
	assert.equal(immediate, undefined);
	assert.equal(scheduled.some((timer) => !timer.interval && timer.delayMs === 100), true);
	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 0);
	watcher.stopResultWatcher();
});

test("healthy watcher periodic scan recovers lost rename events", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-6d.json");
	const scheduled = [];
	const timers = {
		setTimeout(handler, delayMs) {
			const timer = { handler, delayMs, interval: false };
			scheduled.push(timer);
			return timer;
		},
		clearTimeout(timer) {
			const index = scheduled.indexOf(timer);
			if (index >= 0) scheduled.splice(index, 1);
		},
		setInterval(handler, delayMs) {
			const timer = { handler, delayMs, interval: true, unref() {} };
			scheduled.push(timer);
			return timer;
		},
		clearInterval(timer) {
			this.clearTimeout(timer);
		},
	};
	const fsApi = makeSharedFs();
	fsApi.watch = () => ({ on() { return this; }, close() {}, unref() {} });
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		timers,
		now: () => NOW,
	});

	watcher.startResultWatcher();
	fsApi.writeFileSync(resultPath, writeResult("run-6d"));
	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 0);
	const scanTimer = scheduled.find((timer) => timer.interval && timer.delayMs === 3000);
	assert.ok(scanTimer);
	scanTimer.handler();
	const immediate = scheduled.find((timer) => !timer.interval && timer.delayMs === 0);
	assert.ok(immediate);
	immediate.handler();
	await wait(0);

	assert.equal(fsApi.existsSync(resultPath), false);
	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 1);
	watcher.stopResultWatcher();
});

test("watcher restart scans results created while watcher was down", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-7.json");
	const scheduled = [];
	const timers = {
		setTimeout(handler, delayMs) {
			const timer = { handler, delayMs };
			scheduled.push(timer);
			return timer;
		},
		clearTimeout(timer) {
			const index = scheduled.indexOf(timer);
			if (index >= 0) scheduled.splice(index, 1);
		},
		setInterval(handler, delayMs) {
			return this.setTimeout(handler, delayMs);
		},
		clearInterval(timer) {
			this.clearTimeout(timer);
		},
	};
	const fsApi = makeSharedFs();
	let watcherError;
	fsApi.watch = () => ({
		on(type, listener) {
			if (type === "error") watcherError = listener;
			return this;
		},
		close() {},
		unref() {},
	});
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		timers,
		now: () => NOW,
	});

	watcher.startResultWatcher();
	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 0);
	const originalConsoleError = console.error;
	console.error = () => {};
	try {
		watcherError(new Error("restartable watcher failure"));
	} finally {
		console.error = originalConsoleError;
	}
	fsApi.writeFileSync(resultPath, writeResult("run-7"));
	assert.equal(scheduled[0].delayMs, 3000);
	scheduled.shift().handler();
	assert.equal(scheduled[0].delayMs, 0);
	scheduled.shift().handler();
	await wait(0);

	assert.equal(fsApi.existsSync(resultPath), false);
	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 1);
	watcher.stopResultWatcher();
});

test("orphaned claim artifacts without result are swept on startup", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-8.json");
	const claimPath = `${resultPath}.claim`;
	const cleanupPath = `${claimPath}.cleanup-crashed`;
	const reclaimPath = `${claimPath}.reclaim-crashed`;
	const fsApi = makeSharedFs({
		[claimPath]: { content: JSON.stringify({ pid: 12345, createdAt: NOW, token: "done", delivered: true }) },
		[cleanupPath]: { content: JSON.stringify({ pid: 12345, createdAt: NOW, token: "done", delivered: true }) },
		[reclaimPath]: { content: JSON.stringify({ pid: 12345, createdAt: NOW, token: "old" }) },
	});
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => NOW,
	});

	watcher.primeExistingResults();
	await wait(0);

	assert.equal(fsApi.existsSync(claimPath), false);
	assert.equal(fsApi.existsSync(cleanupPath), false);
	assert.equal(fsApi.existsSync(reclaimPath), false);
	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 0);
	watcher.stopResultWatcher();
});

test("vanished orphan temp claim falls back to fresh delivery", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-8-vanished.json");
	const claimPath = `${resultPath}.claim`;
	const phantomTempFile = path.basename(`${claimPath}.reclaim-vanished`);
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-8-vanished") },
	});
	const originalReaddirSync = fsApi.readdirSync.bind(fsApi);
	fsApi.readdirSync = (dirPath) => {
		const entries = originalReaddirSync(dirPath);
		if (dirPath === path.dirname(claimPath)) return [...entries, phantomTempFile];
		return entries;
	};
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => NOW,
	});

	watcher.primeExistingResults();
	await waitUntil(() => !fsApi.existsSync(resultPath));

	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 1);
	assert.equal(fsApi.existsSync(claimPath), false);
	watcher.stopResultWatcher();
});

test("orphaned delivered cleanup temp claim cleans up without re-emitting", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-8.json");
	const claimPath = `${resultPath}.claim`;
	const cleanupPath = `${claimPath}.cleanup-crashed`;
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-8") },
		[cleanupPath]: {
			content: JSON.stringify({ pid: 12345, createdAt: NOW, token: "done", delivered: true }),
			mtimeMs: NOW,
		},
	});
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => NOW,
	});

	watcher.primeExistingResults();
	await waitUntil(() => !fsApi.existsSync(resultPath));

	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 0);
	assert.equal(fsApi.existsSync(cleanupPath), false);
	assert.equal(fsApi.existsSync(claimPath), false);
	watcher.stopResultWatcher();
});

test("orphaned delivered temp unlink failure recreates marker and retries cleanup", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-8d.json");
	const claimPath = `${resultPath}.claim`;
	const cleanupPath = `${claimPath}.cleanup-crashed`;
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-8d") },
		[cleanupPath]: {
			content: JSON.stringify({ pid: 12345, createdAt: NOW, token: "done", delivered: true }),
			mtimeMs: NOW,
		},
	});
	const originalRenameSync = fsApi.renameSync.bind(fsApi);
	const originalUnlinkSync = fsApi.unlinkSync.bind(fsApi);
	let failResultUnlink = true;
	let failTempRestore = true;
	fsApi.unlinkSync = (filePath) => {
		if (filePath === resultPath && failResultUnlink) {
			failResultUnlink = false;
			const error = new Error("simulated result unlink failure");
			error.code = "EACCES";
			throw error;
		}
		return originalUnlinkSync(filePath);
	};
	fsApi.renameSync = (oldPath, newPath) => {
		if (oldPath === cleanupPath && newPath === claimPath && failTempRestore) {
			failTempRestore = false;
			originalUnlinkSync(cleanupPath);
			throw enoent(cleanupPath);
		}
		return originalRenameSync(oldPath, newPath);
	};
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => NOW,
		claimCleanupRetryMs: 10,
	});
	const originalConsoleError = console.error;
	console.error = () => {};
	try {
		watcher.primeExistingResults();
		await waitUntil(() => !fsApi.existsSync(resultPath));
	} finally {
		console.error = originalConsoleError;
	}

	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 0);
	assert.equal(fsApi.existsSync(cleanupPath), false);
	assert.equal(fsApi.existsSync(claimPath), false);
	watcher.stopResultWatcher();
});

test("orphaned delivered cleanup temp wins over stale reclaim temp", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-8c.json");
	const claimPath = `${resultPath}.claim`;
	const cleanupPath = `${claimPath}.cleanup-crashed`;
	const reclaimPath = `${claimPath}.reclaim-crashed`;
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-8c") },
		[reclaimPath]: {
			content: JSON.stringify({ pid: 12345, createdAt: NOW - 60 * 60 * 1000, token: "old" }),
			mtimeMs: NOW - 60 * 60 * 1000,
		},
		[cleanupPath]: {
			content: JSON.stringify({ pid: 12345, createdAt: NOW, token: "done", delivered: true }),
			mtimeMs: NOW,
		},
	});
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => NOW,
	});

	watcher.primeExistingResults();
	await waitUntil(() => !fsApi.existsSync(resultPath));

	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 0);
	assert.equal(fsApi.existsSync(cleanupPath), false);
	assert.equal(fsApi.existsSync(reclaimPath), false);
	assert.equal(fsApi.existsSync(claimPath), false);
	watcher.stopResultWatcher();
});

test("orphaned reclaim temp claim is restored and reclaimed", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-8b.json");
	const claimPath = `${resultPath}.claim`;
	const reclaimPath = `${claimPath}.reclaim-crashed`;
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-8b") },
		[reclaimPath]: {
			content: JSON.stringify({ pid: 12345, createdAt: NOW - 60 * 60 * 1000, token: "old" }),
			mtimeMs: NOW - 60 * 60 * 1000,
		},
	});
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => NOW,
	});

	watcher.primeExistingResults();
	await waitUntil(() => !fsApi.existsSync(resultPath));

	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 1);
	assert.equal(fsApi.existsSync(reclaimPath), false);
	assert.equal(fsApi.existsSync(claimPath), false);
	watcher.stopResultWatcher();
});

test("stale delivered claim cleans up without re-emitting", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-7.json");
	const claimPath = `${resultPath}.claim`;
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-7") },
		[claimPath]: {
			content: JSON.stringify({ pid: 12345, createdAt: NOW - 60 * 60 * 1000, token: "done", delivered: true }),
			mtimeMs: NOW - 60 * 60 * 1000,
		},
	});
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => NOW,
		claimCleanupRetryMs: 5,
	});

	watcher.primeExistingResults();
	await waitUntil(() => !fsApi.existsSync(resultPath));

	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 0);
	assert.equal(fsApi.existsSync(claimPath), false);
	watcher.stopResultWatcher();
});

test("delivered cleanup transient rename failure retries cleanup", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-9a.json");
	const claimPath = `${resultPath}.claim`;
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-9a") },
		[claimPath]: {
			content: JSON.stringify({ pid: 12345, createdAt: NOW, token: "done", delivered: true }),
			mtimeMs: NOW,
		},
	});
	const originalRenameSync = fsApi.renameSync.bind(fsApi);
	let failRename = true;
	fsApi.renameSync = (oldPath, newPath) => {
		if (oldPath === claimPath && newPath.startsWith(`${claimPath}.cleanup-`) && failRename) {
			failRename = false;
			const error = new Error("simulated cleanup rename failure");
			error.code = "EACCES";
			throw error;
		}
		return originalRenameSync(oldPath, newPath);
	};
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => NOW,
		claimCleanupRetryMs: 10,
	});
	const originalConsoleError = console.error;
	console.error = () => {};
	try {
		watcher.primeExistingResults();
		await waitUntil(() => !fsApi.existsSync(resultPath));
	} finally {
		console.error = originalConsoleError;
	}

	assert.equal(fsApi.existsSync(claimPath), false);
	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 0);
	watcher.stopResultWatcher();
});

test("delivered cleanup unlink failure recreates marker when restore temp vanished", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-9b.json");
	const claimPath = `${resultPath}.claim`;
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-9b") },
		[claimPath]: {
			content: JSON.stringify({ pid: 12345, createdAt: NOW, token: "done", delivered: true }),
			mtimeMs: NOW,
		},
	});
	const originalRenameSync = fsApi.renameSync.bind(fsApi);
	const originalUnlinkSync = fsApi.unlinkSync.bind(fsApi);
	let failResultUnlink = true;
	let failTempRestore = true;
	fsApi.unlinkSync = (filePath) => {
		if (filePath === resultPath && failResultUnlink) {
			failResultUnlink = false;
			const error = new Error("simulated result unlink failure");
			error.code = "EACCES";
			throw error;
		}
		return originalUnlinkSync(filePath);
	};
	fsApi.renameSync = (oldPath, newPath) => {
		if (oldPath.startsWith(`${claimPath}.cleanup-`) && newPath === claimPath && failTempRestore) {
			failTempRestore = false;
			originalUnlinkSync(oldPath);
			throw enoent(oldPath);
		}
		return originalRenameSync(oldPath, newPath);
	};
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => NOW,
		claimCleanupRetryMs: 10,
	});

	watcher.primeExistingResults();
	await waitUntil(() => !fsApi.existsSync(resultPath));

	assert.equal(fsApi.existsSync(claimPath), false);
	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 0);
	watcher.stopResultWatcher();
});

test("duplicate-result concurrent cleanup releases delivered claim", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-8.json");
	const claimPath = `${resultPath}.claim`;
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-8") },
	});
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => NOW,
	});

	watcher.primeExistingResults();
	await waitUntil(() => !fsApi.existsSync(resultPath));

	fsApi.writeFileSync(resultPath, writeResult("run-8"));
	const originalUnlinkSync = fsApi.unlinkSync.bind(fsApi);
	let deleteBeforeUnlink = true;
	fsApi.unlinkSync = (filePath) => {
		if (filePath === resultPath && deleteBeforeUnlink) {
			deleteBeforeUnlink = false;
			originalUnlinkSync(filePath);
			throw enoent(filePath);
		}
		return originalUnlinkSync(filePath);
	};

	watcher.primeExistingResults();
	await waitUntil(() => deleteBeforeUnlink === false && !fsApi.existsSync(claimPath));

	assert.equal(fsApi.existsSync(resultPath), false);
	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 1);
	watcher.stopResultWatcher();
});

test("duplicate-result deletion failure retries cleanup without re-emitting", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-8.json");
	const claimPath = `${resultPath}.claim`;
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-8") },
	});
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => NOW,
		claimCleanupRetryMs: 10,
	});

	watcher.primeExistingResults();
	await waitUntil(() => !fsApi.existsSync(resultPath));
	assert.equal(fsApi.existsSync(claimPath), false);

	fsApi.writeFileSync(resultPath, writeResult("run-8"));
	const originalUnlinkSync = fsApi.unlinkSync.bind(fsApi);
	let shouldFailUnlink = true;
	fsApi.unlinkSync = (filePath) => {
		if (filePath === resultPath && shouldFailUnlink) {
			shouldFailUnlink = false;
			const error = new Error("simulated duplicate unlink failure");
			error.code = "EACCES";
			throw error;
		}
		return originalUnlinkSync(filePath);
	};
	const originalConsoleError = console.error;
	console.error = () => {};
	try {
		watcher.primeExistingResults();
		await waitUntil(() => !fsApi.existsSync(resultPath));
	} finally {
		console.error = originalConsoleError;
	}

	assert.equal(fsApi.existsSync(claimPath), false);
	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 1);
	watcher.stopResultWatcher();
});

test("post-delivery concurrent cleanup releases delivered claim", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-10.json");
	const claimPath = `${resultPath}.claim`;
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-10") },
	});
	const originalUnlinkSync = fsApi.unlinkSync.bind(fsApi);
	let deleteBeforeUnlink = true;
	fsApi.unlinkSync = (filePath) => {
		if (filePath === resultPath && deleteBeforeUnlink) {
			deleteBeforeUnlink = false;
			originalUnlinkSync(filePath);
			throw enoent(filePath);
		}
		return originalUnlinkSync(filePath);
	};
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => NOW,
	});

	watcher.primeExistingResults();
	await waitUntil(() => deleteBeforeUnlink === false && !fsApi.existsSync(claimPath));

	assert.equal(fsApi.existsSync(resultPath), false);
	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 1);
	watcher.stopResultWatcher();
});

test("duplicate delivered marker write failure retries cleanup without re-emitting", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-11.json");
	const claimPath = `${resultPath}.claim`;
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-11") },
	});
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => NOW,
		claimCleanupRetryMs: 10,
	});

	watcher.primeExistingResults();
	await waitUntil(() => !fsApi.existsSync(resultPath));
	fsApi.writeFileSync(resultPath, writeResult("run-11"));

	const originalWriteFileSync = fsApi.writeFileSync.bind(fsApi);
	let failDeliveredWrite = true;
	fsApi.writeFileSync = (filePath, content) => {
		if (filePath === claimPath && String(content).includes('"delivered": true') && failDeliveredWrite) {
			failDeliveredWrite = false;
			const error = new Error("simulated duplicate delivered marker write failure");
			error.code = "EACCES";
			throw error;
		}
		return originalWriteFileSync(filePath, content);
	};
	const originalConsoleError = console.error;
	console.error = () => {};
	try {
		watcher.primeExistingResults();
		await waitUntil(() => !fsApi.existsSync(resultPath));
	} finally {
		console.error = originalConsoleError;
	}

	assert.equal(fsApi.existsSync(claimPath), false);
	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 1);
	watcher.stopResultWatcher();
});

test("delivered marker write failure retries before another watcher can stale-reclaim", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-11a.json");
	const claimPath = `${resultPath}.claim`;
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-11a") },
	});
	const originalWriteFileSync = fsApi.writeFileSync.bind(fsApi);
	let failDeliveredWrite = true;
	fsApi.writeFileSync = (filePath, content) => {
		if (filePath === claimPath && String(content).includes('"delivered": true') && failDeliveredWrite) {
			failDeliveredWrite = false;
			const error = new Error("simulated delivered marker write failure");
			error.code = "EACCES";
			throw error;
		}
		return originalWriteFileSync(filePath, content);
	};
	let watcherBNow = NOW;
	const events = makeEvents();
	const watcherA = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => NOW,
		claimCleanupRetryMs: 5,
		claimStaleMs: 30,
	});
	const watcherB = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => watcherBNow,
		claimCleanupRetryMs: 5,
		claimStaleMs: 30,
	});
	const originalConsoleError = console.error;
	console.error = () => {};
	try {
		watcherA.primeExistingResults();
		watcherB.primeExistingResults();
		await wait(0);
		watcherBNow = NOW + 31;
		await waitUntil(() => !fsApi.existsSync(resultPath));
		await wait(40);
	} finally {
		console.error = originalConsoleError;
	}

	assert.equal(fsApi.existsSync(claimPath), false);
	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 1);
	watcherA.stopResultWatcher();
	watcherB.stopResultWatcher();
});

test("post-delivery marker write failure retries cleanup without re-emitting", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-11b.json");
	const claimPath = `${resultPath}.claim`;
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-11b") },
	});
	const originalWriteFileSync = fsApi.writeFileSync.bind(fsApi);
	let failDeliveredWrite = true;
	fsApi.writeFileSync = (filePath, content) => {
		if (filePath === claimPath && String(content).includes('"delivered": true') && failDeliveredWrite) {
			failDeliveredWrite = false;
			const error = new Error("simulated delivered marker write failure");
			error.code = "EACCES";
			throw error;
		}
		return originalWriteFileSync(filePath, content);
	};
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => NOW,
		claimCleanupRetryMs: 10,
	});
	const originalConsoleError = console.error;
	console.error = () => {};
	try {
		watcher.primeExistingResults();
		await waitUntil(() => !fsApi.existsSync(resultPath));
	} finally {
		console.error = originalConsoleError;
	}

	assert.equal(fsApi.existsSync(claimPath), false);
	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 1);
	watcher.stopResultWatcher();
});

test("post-delivery deletion failure retries cleanup without re-emitting", async () => {
	const resultPath = path.join(RESULTS_DIR, "run-9.json");
	const claimPath = `${resultPath}.claim`;
	const fsApi = makeSharedFs({
		[resultPath]: { content: writeResult("run-9") },
	});
	const originalUnlinkSync = fsApi.unlinkSync.bind(fsApi);
	let shouldFailUnlink = true;
	fsApi.unlinkSync = (filePath) => {
		if (filePath === resultPath && shouldFailUnlink) {
			shouldFailUnlink = false;
			const error = new Error("simulated unlink failure");
			error.code = "EACCES";
			throw error;
		}
		return originalUnlinkSync(filePath);
	};
	const events = makeEvents();
	const watcher = createResultWatcher({ events }, makeState(), RESULTS_DIR, 1000, {
		fs: fsApi,
		now: () => NOW,
		claimCleanupRetryMs: 10,
	});
	const originalConsoleError = console.error;
	console.error = () => {};
	try {
		watcher.primeExistingResults();
		await waitUntil(() => !fsApi.existsSync(resultPath));
	} finally {
		console.error = originalConsoleError;
	}

	assert.equal(fsApi.existsSync(claimPath), false);
	assert.equal(events.emitted.filter((event) => event.type === SUBAGENT_ASYNC_COMPLETE_EVENT).length, 1);
	watcher.stopResultWatcher();
});
