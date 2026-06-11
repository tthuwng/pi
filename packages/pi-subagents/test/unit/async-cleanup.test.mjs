import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { loadTs } from "../support/load-ts.mjs";

const { cleanupOldAsyncRunDirs } = await loadTs("../../src/shared/async-cleanup.ts");

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-05-26T12:00:00.000Z");

function makeTempRoot() {
	return fs.mkdtempSync(
		path.join(os.tmpdir(), "pi-subagents-async-cleanup-test-"),
	);
}

function writeRun(root, name, state, mtimeMs) {
	const dir = path.join(root, name);
	fs.mkdirSync(dir, { recursive: true });
	if (state !== undefined) {
		fs.writeFileSync(
			path.join(dir, "status.json"),
			JSON.stringify({
				runId: name,
				mode: "single",
				state,
				startedAt: mtimeMs,
				lastUpdate: mtimeMs,
			}),
			"utf-8",
		);
	}
	const when = new Date(mtimeMs);
	fs.utimesSync(dir, when, when);
	return dir;
}

test("cleanupOldAsyncRunDirs removes only stale terminal async run directories", () => {
	const root = makeTempRoot();
	try {
		const oldTime = NOW - ONE_DAY_MS - 1000;
		const recentTime = NOW - ONE_DAY_MS + 1000;
		const oldComplete = writeRun(root, "old-complete", "complete", oldTime);
		const oldFailed = writeRun(root, "old-failed", "failed", oldTime);
		const oldMissingStatus = writeRun(
			root,
			"old-missing-status",
			undefined,
			oldTime,
		);
		const oldRunning = writeRun(root, "old-running", "running", oldTime);
		const oldPaused = writeRun(root, "old-paused", "paused", oldTime);
		const recentComplete = writeRun(
			root,
			"recent-complete",
			"complete",
			recentTime,
		);

		const result = cleanupOldAsyncRunDirs(root, {
			now: () => NOW,
			maxAgeMs: ONE_DAY_MS,
		});

		assert.equal(result.removed, 3);
		assert.equal(fs.existsSync(oldComplete), false);
		assert.equal(fs.existsSync(oldFailed), false);
		assert.equal(fs.existsSync(oldMissingStatus), false);
		assert.equal(fs.existsSync(oldRunning), true);
		assert.equal(fs.existsSync(oldPaused), true);
		assert.equal(fs.existsSync(recentComplete), true);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
