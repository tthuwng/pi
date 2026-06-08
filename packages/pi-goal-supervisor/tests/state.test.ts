import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createInitialState,
	parseState,
	reduceState,
	restoreStateFromEntries,
	serializeState,
} from "../src/state.ts";
import { STATE_CUSTOM_TYPE, type CustomSessionEntry } from "../src/types.ts";

test("creates running state without budget limits", () => {
	const state = createInitialState({
		objective: "ship the feature",
		cwd: "/tmp/project",
		sessionId: "session-1",
		now: "2026-06-03T00:00:00.000Z",
	});

	assert.equal(state.status, "running");
	assert.equal(state.objective, "ship the feature");
	assert.equal(state.iteration, 0);
	assert.equal("budget" in state, false);
	assert.equal(state.pendingContinuation, undefined);
});

test("parses legacy budget-limited state as stopped", () => {
	const legacy = serializeState(
		createInitialState({
			objective: "legacy budget stop",
			cwd: "/tmp/project",
			sessionId: "session-1",
			now: "2026-06-03T00:00:00.000Z",
		}),
	) as Record<string, unknown>;
	legacy.status = "budget_limited";
	legacy.budget = {
		maxIterations: 50,
		maxNoProgressTurns: 5,
		maxWallClockMs: 21_600_000,
	};
	legacy.lastBlocker = {
		reason: "iteration budget exceeded (51/50)",
		at: "2026-06-03T00:51:00.000Z",
		source: "budget",
	};

	const parsed = parseState(legacy);

	assert.equal(parsed?.status, "stopped");
	assert.equal(parsed?.objective, "legacy budget stop");
	assert.equal(parsed?.lastBlocker, undefined);
});

test("restores latest valid custom entry from active branch", () => {
	const first = createInitialState({
		objective: "old",
		cwd: "/tmp/project",
		sessionId: "session-1",
		now: "2026-06-03T00:00:00.000Z",
	});
	const second = reduceState(first, {
		type: "started",
		objective: "new",
		now: "2026-06-03T00:01:00.000Z",
	});
	const entries: CustomSessionEntry[] = [
		{
			type: "custom",
			customType: STATE_CUSTOM_TYPE,
			data: serializeState(first),
		},
		{ type: "custom", customType: STATE_CUSTOM_TYPE, data: { nope: true } },
		{ type: "custom", customType: "other", data: serializeState(first) },
		{
			type: "custom",
			customType: STATE_CUSTOM_TYPE,
			data: serializeState(second),
		},
	];

	const restored = restoreStateFromEntries(entries);

	assert.equal(restored?.objective, "new");
	assert.equal(restored?.updatedAt, "2026-06-03T00:01:00.000Z");
});

test("pause resume stop and blocked transitions control liveness state", () => {
	const initial = createInitialState({
		objective: "finish",
		cwd: "/tmp/project",
		sessionId: "session-1",
		now: "2026-06-03T00:00:00.000Z",
	});
	const paused = reduceState(initial, {
		type: "paused",
		reason: "manual",
		now: "2026-06-03T00:01:00.000Z",
	});
	const resumed = reduceState(paused, {
		type: "resumed",
		now: "2026-06-03T00:02:00.000Z",
	});
	const blocked = reduceState(resumed, {
		type: "blocked",
		reason: "needs credentials",
		now: "2026-06-03T00:03:00.000Z",
	});
	const stopped = reduceState(blocked, {
		type: "stopped",
		reason: "manual",
		now: "2026-06-03T00:04:00.000Z",
	});

	assert.equal(paused.status, "paused");
	assert.equal(resumed.status, "running");
	assert.equal(blocked.status, "blocked");
	assert.equal(blocked.lastBlocker?.reason, "needs credentials");
	assert.equal(stopped.status, "stopped");
	assert.equal(stopped.pendingContinuation, undefined);
});

test("turn accounting does not stop for long-running or repeated turns", () => {
	const initial = createInitialState({
		objective: "finish",
		cwd: "/tmp/project",
		sessionId: "session-1",
		now: "2026-06-03T00:00:00.000Z",
	});
	const once = reduceState(initial, {
		type: "turn_recorded",
		assistantText: "same",
		fingerprint: "abc",
		now: "2026-06-03T00:01:00.000Z",
	});
	const twice = reduceState(once, {
		type: "turn_recorded",
		assistantText: "same",
		fingerprint: "abc",
		now: "2026-06-03T08:02:00.000Z",
	});
	const later = reduceState(twice, {
		type: "turn_recorded",
		assistantText: "same",
		fingerprint: "abc",
		now: "2026-06-04T00:03:00.000Z",
	});

	assert.equal(once.iteration, 1);
	assert.equal(twice.noProgressTurns, 1);
	assert.equal(later.iteration, 3);
	assert.equal(later.noProgressTurns, 2);
	assert.equal(later.status, "running");
	assert.equal(later.lastBlocker, undefined);
});
