import assert from "node:assert/strict";
import { test } from "node:test";
import { handleCommand, parseGoalCommand } from "../src/commands.ts";
import { createInitialState } from "../src/state.ts";

test("parses status, implicit start, explicit start, and reserved commands", () => {
	assert.deepEqual(parseGoalCommand(""), { action: "status" });
	assert.deepEqual(parseGoalCommand("status"), { action: "status" });
	assert.deepEqual(parseGoalCommand("start ship it"), {
		action: "start",
		objective: "ship it",
	});
	assert.deepEqual(parseGoalCommand("ship it"), {
		action: "start",
		objective: "ship it",
	});
	assert.deepEqual(parseGoalCommand("pause waiting"), {
		action: "pause",
		reason: "waiting",
	});
	assert.deepEqual(parseGoalCommand("done tests passed"), {
		action: "done",
		evidence: "tests passed",
	});
});

test("rejects empty objective for explicit start", () => {
	assert.throws(() => parseGoalCommand("start"), /objective/i);
});

test("status with no active goal does not create placeholder state", () => {
	const result = handleCommand(undefined, "status", {
		cwd: "/tmp/project",
		sessionId: "s",
		now: "2026-06-03T00:00:00.000Z",
	});

	assert.equal(result.state, undefined);
	assert.equal(result.shouldQueueContinuation, false);
	assert.match(result.message, /no active goal/i);
});

test("command handler starts pauses resumes and stops", () => {
	const now = "2026-06-03T00:00:00.000Z";
	const start = handleCommand(undefined, "build package", {
		cwd: "/tmp/project",
		sessionId: "s",
		now,
	});
	const paused = handleCommand(start.state, "pause manual", {
		cwd: "/tmp/project",
		sessionId: "s",
		now,
	});
	const resumed = handleCommand(paused.state, "resume", {
		cwd: "/tmp/project",
		sessionId: "s",
		now,
	});
	const stopped = handleCommand(resumed.state, "stop done", {
		cwd: "/tmp/project",
		sessionId: "s",
		now,
	});

	assert.ok(start.state);
	assert.ok(paused.state);
	assert.ok(resumed.state);
	assert.ok(stopped.state);
	const status = handleCommand(start.state, "status", {
		cwd: "/tmp/project",
		sessionId: "s",
		now,
	});

	assert.equal(start.state.status, "running");
	assert.equal(paused.state.status, "paused");
	assert.equal(resumed.state.status, "running");
	assert.equal(stopped.state.status, "stopped");
	assert.equal(start.continuationReason, "start");
	assert.equal(resumed.continuationReason, "resume");
	assert.match(start.message, /started/i);
	assert.match(status.message, /\(0 turns\)/);
	assert.doesNotMatch(status.message, /\d+\/\d+/);
});

test("manual done records evidence and enters judging state", () => {
	const state = createInitialState({
		objective: "finish",
		cwd: "/tmp/project",
		sessionId: "s",
		now: "2026-06-03T00:00:00.000Z",
	});

	const result = handleCommand(state, "done tests passed", {
		cwd: "/tmp/project",
		sessionId: "s",
		now: "2026-06-03T00:01:00.000Z",
	});

	assert.ok(result.state);
	assert.equal(result.state.status, "judging");
	assert.equal(result.state.lastDoneClaim?.evidence, "tests passed");
});
