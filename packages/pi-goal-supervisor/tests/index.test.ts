import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import piGoalSupervisor, { registerGoalSupervisor } from "../src/index.ts";
import { STATE_CUSTOM_TYPE, type GoalSupervisorState } from "../src/types.ts";

test("default export registers goal command and lifecycle hooks", async () => {
	const hooks: string[] = [];
	const commands: string[] = [];
	const api = {
		on(event: string) {
			hooks.push(event);
		},
		registerCommand(name: string) {
			commands.push(name);
		},
	};

	await piGoalSupervisor(api);

	assert.deepEqual(commands, ["goal"]);
	assert.ok(hooks.includes("session_start"));
	assert.ok(hooks.includes("before_agent_start"));
	assert.ok(hooks.includes("turn_end"));
	assert.ok(hooks.includes("session_compact"));
});

test("pause and stop commands abort an active turn when context supports abort", async () => {
	let handler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
	const entries: Array<{ type: "custom"; customType: string; data: unknown }> =
		[];
	const api = {
		on() {},
		registerCommand(
			_name: string,
			options: { handler: (args: string, ctx: unknown) => Promise<void> },
		) {
			handler = options.handler;
		},
		appendEntry(customType: string, data: unknown) {
			entries.push({ type: "custom", customType, data });
		},
		sendMessage() {},
	};
	await piGoalSupervisor(api);
	assert.ok(handler);
	let aborts = 0;
	const ctx = {
		sessionManager: {
			getCwd: () => "/tmp/project",
			getSessionId: () => "session-1",
			getBranch: () => entries,
		},
		isIdle: () => true,
		hasPendingMessages: () => false,
		abort: () => {
			aborts += 1;
		},
		ui: { notify() {}, setWidget() {} },
	};

	await handler("live smoke", ctx);
	await handler("pause manual", ctx);
	await handler("resume", ctx);
	await handler("stop manual", ctx);

	assert.equal(aborts, 2);
});

test("widget and supervisor prompt show unbounded turn count", async () => {
	const entries: Array<{ type: "custom"; customType: string; data: unknown }> =
		[];
	const hooks = new Map<
		string,
		(event: unknown, ctx: unknown) => Promise<void> | void | unknown
	>();
	let handler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
	let widgetContent: string[] | undefined;
	const api = {
		on(
			event: string,
			hook: (event: unknown, ctx: unknown) => Promise<void> | void | unknown,
		) {
			hooks.set(event, hook);
		},
		registerCommand(
			_name: string,
			options: { handler: (args: string, ctx: unknown) => Promise<void> },
		) {
			handler = options.handler;
		},
		appendEntry(customType: string, data: unknown) {
			entries.push({ type: "custom", customType, data });
		},
		sendMessage() {},
	};
	registerGoalSupervisor(api);
	assert.ok(handler);
	const ctx = {
		sessionManager: {
			getCwd: () => "/tmp/project",
			getSessionId: () => "session-1",
			getBranch: () => entries,
		},
		isIdle: () => true,
		hasPendingMessages: () => false,
		ui: {
			notify() {},
			setWidget(_key: string, content: string[] | undefined) {
				widgetContent = content;
			},
		},
	};

	await handler("finish objective", ctx);
	const promptResult = hooks.get("before_agent_start")?.(
		{ systemPrompt: "base", prompt: "continue" },
		ctx,
	) as { systemPrompt: string } | undefined;

	assert.equal(widgetContent?.[0], "goal: running 0 turns");
	assert.doesNotMatch(widgetContent?.[0] ?? "", /\d+\/\d+/);
	assert.match(promptResult?.systemPrompt ?? "", /turns: 0/i);
	assert.doesNotMatch(promptResult?.systemPrompt ?? "", /\d+\/\d+/);
	assert.doesNotMatch(promptResult?.systemPrompt ?? "", /completed turns/i);
});

test("manual /goal done fails closed when no transcript evidence exists", async () => {
	const entries: Array<{ type: "custom"; customType: string; data: unknown }> =
		[];
	let handler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
	let judgeCalls = 0;
	const api = {
		on() {},
		registerCommand(
			_name: string,
			options: { handler: (args: string, ctx: unknown) => Promise<void> },
		) {
			handler = options.handler;
		},
		appendEntry(customType: string, data: unknown) {
			entries.push({ type: "custom", customType, data });
		},
		sendMessage() {},
	};
	registerGoalSupervisor(
		api,
		{},
		{
			judge: () => {
				judgeCalls += 1;
				return {
					verdict: "approved",
					score: 9,
					reason: "should not run",
					missingEvidence: [],
					at: "2026-06-03T00:02:00.000Z",
				};
			},
		},
	);
	assert.ok(handler);
	const ctx = {
		sessionManager: {
			getCwd: () => "/tmp/project",
			getSessionId: () => "session-1",
			getBranch: () => entries,
		},
		isIdle: () => true,
		hasPendingMessages: () => false,
		ui: { notify() {}, setWidget() {} },
	};

	await handler("finish objective", ctx);
	await handler("done tests passed", ctx);

	const lastState = entries
		.filter((entry) => entry.customType === STATE_CUSTOM_TYPE)
		.at(-1)?.data as GoalSupervisorState | undefined;
	assert.equal(judgeCalls, 0);
	assert.equal(lastState?.status, "running");
	assert.equal(
		lastState?.lastJudge?.reason,
		"no transcript evidence available for completion claim",
	);
});

test("manual /goal done judges against actual prior assistant transcript", async () => {
	const entries: Array<{ type: "custom"; customType: string; data: unknown }> =
		[];
	const hooks = new Map<
		string,
		(event: unknown, ctx: unknown) => Promise<void> | void | unknown
	>();
	let handler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
	let judgedTranscript = "";
	const api = {
		on(
			event: string,
			hook: (event: unknown, ctx: unknown) => Promise<void> | void | unknown,
		) {
			hooks.set(event, hook);
		},
		registerCommand(
			_name: string,
			options: { handler: (args: string, ctx: unknown) => Promise<void> },
		) {
			handler = options.handler;
		},
		appendEntry(customType: string, data: unknown) {
			entries.push({ type: "custom", customType, data });
		},
		sendMessage() {},
	};
	registerGoalSupervisor(
		api,
		{},
		{
			judge: (_state, assistantText) => {
				judgedTranscript = assistantText;
				return {
					verdict: "approved",
					score: 9,
					reason: "manual verified",
					missingEvidence: [],
					at: "2026-06-03T00:02:00.000Z",
				};
			},
		},
	);
	assert.ok(handler);
	const ctx = {
		sessionManager: {
			getCwd: () => "/tmp/project",
			getSessionId: () => "session-1",
			getBranch: () => entries,
		},
		isIdle: () => true,
		hasPendingMessages: () => false,
		ui: { notify() {}, setWidget() {} },
	};

	await handler("finish objective", ctx);
	await hooks.get("turn_end")?.(
		{
			message: {
				role: "assistant",
				content: "Tests passed in the transcript.",
			},
		},
		ctx,
	);
	await handler("done tests passed", ctx);

	const lastState = entries
		.filter((entry) => entry.customType === STATE_CUSTOM_TYPE)
		.at(-1)?.data as GoalSupervisorState | undefined;
	assert.equal(judgedTranscript, "Tests passed in the transcript.");
	assert.equal(lastState?.status, "complete");
	assert.equal(lastState?.lastJudge?.reason, "manual verified");
});

test("turn_end GOAL_DONE uses injected judge and can complete the goal", async () => {
	const entries: Array<{ type: "custom"; customType: string; data: unknown }> =
		[];
	const hooks = new Map<
		string,
		(event: unknown, ctx: unknown) => Promise<void> | void | unknown
	>();
	let handler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
	const api = {
		on(
			event: string,
			hook: (event: unknown, ctx: unknown) => Promise<void> | void | unknown,
		) {
			hooks.set(event, hook);
		},
		registerCommand(
			_name: string,
			options: { handler: (args: string, ctx: unknown) => Promise<void> },
		) {
			handler = options.handler;
		},
		appendEntry(customType: string, data: unknown) {
			entries.push({ type: "custom", customType, data });
		},
		sendMessage() {},
	};
	registerGoalSupervisor(
		api,
		{},
		{
			judge: () => ({
				verdict: "approved",
				score: 9,
				reason: "verified",
				missingEvidence: [],
				at: "2026-06-03T00:02:00.000Z",
			}),
		},
	);
	assert.ok(handler);
	const ctx = {
		sessionManager: {
			getCwd: () => "/tmp/project",
			getSessionId: () => "session-1",
			getBranch: () => entries,
		},
		isIdle: () => true,
		hasPendingMessages: () => false,
		ui: { notify() {}, setWidget() {} },
	};

	await handler("finish objective", ctx);
	await hooks.get("turn_end")?.(
		{ message: { role: "assistant", content: "GOAL_DONE: tests passed" } },
		ctx,
	);

	const lastState = entries
		.filter((entry) => entry.customType === STATE_CUSTOM_TYPE)
		.at(-1)?.data as GoalSupervisorState | undefined;
	assert.equal(lastState?.status, "complete");
	assert.equal(lastState?.lastJudge?.reason, "verified");
});

test("branch restore clears stale in-memory goal when active branch has no state", async () => {
	const entries: Array<{ type: "custom"; customType: string; data: unknown }> =
		[];
	const hooks = new Map<
		string,
		(event: unknown, ctx: unknown) => Promise<void> | void | unknown
	>();
	let handler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
	const notifications: string[] = [];
	const api = {
		on(
			event: string,
			hook: (event: unknown, ctx: unknown) => Promise<void> | void | unknown,
		) {
			hooks.set(event, hook);
		},
		registerCommand(
			_name: string,
			options: { handler: (args: string, ctx: unknown) => Promise<void> },
		) {
			handler = options.handler;
		},
		appendEntry(customType: string, data: unknown) {
			entries.push({ type: "custom", customType, data });
		},
		sendMessage() {},
	};
	await piGoalSupervisor(api);
	assert.ok(handler);
	const ctxWithState = {
		sessionManager: {
			getCwd: () => "/tmp/project",
			getSessionId: () => "session-1",
			getBranch: () => entries,
		},
		isIdle: () => true,
		hasPendingMessages: () => false,
		ui: {
			notify(message: string) {
				notifications.push(message);
			},
			setWidget() {},
		},
	};
	await handler("branch-specific objective", ctxWithState);

	const emptyBranchCtx = {
		sessionManager: {
			getCwd: () => "/tmp/project",
			getSessionId: () => "session-2",
			getBranch: () => [],
		},
		isIdle: () => true,
		hasPendingMessages: () => false,
		ui: {
			notify(message: string) {
				notifications.push(message);
			},
			setWidget() {},
		},
	};
	await hooks.get("session_tree")?.({}, emptyBranchCtx);
	await handler("status", emptyBranchCtx);

	assert.equal(notifications.at(-1), "No active goal.");
});

test("session_tree preserves a real pending continuation latch", async () => {
	const entries: Array<{ type: "custom"; customType: string; data: unknown }> =
		[];
	const hooks = new Map<
		string,
		(event: unknown, ctx: unknown) => Promise<void> | void | unknown
	>();
	let handler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
	let sendCount = 0;
	const api = {
		on(
			event: string,
			hook: (event: unknown, ctx: unknown) => Promise<void> | void | unknown,
		) {
			hooks.set(event, hook);
		},
		registerCommand(
			_name: string,
			options: { handler: (args: string, ctx: unknown) => Promise<void> },
		) {
			handler = options.handler;
		},
		appendEntry(customType: string, data: unknown) {
			entries.push({ type: "custom", customType, data });
		},
		sendMessage() {
			sendCount += 1;
		},
	};
	await piGoalSupervisor(api);
	assert.ok(handler);
	const ctx = {
		sessionManager: {
			getCwd: () => "/tmp/project",
			getSessionId: () => "session-1",
			getBranch: () => entries,
		},
		isIdle: () => true,
		hasPendingMessages: () => false,
		ui: { notify() {}, setWidget() {} },
	};

	await handler("pending latch objective", ctx);
	await hooks.get("session_tree")?.({}, ctx);
	await hooks.get("session_start")?.({}, ctx);

	const lastState = entries
		.filter((entry) => entry.customType === STATE_CUSTOM_TYPE)
		.at(-1)?.data as GoalSupervisorState | undefined;
	assert.equal(sendCount, 1);
	assert.ok(lastState?.pendingContinuation);
});

test("source does not use forbidden tool mutation APIs", () => {
	const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
	const forbidden =
		/\b(getActiveTools|setActiveTools|getAllTools|registerTool)\b/;
	const offenders = readdirSync(srcDir)
		.filter((name) => name.endsWith(".ts"))
		.filter((name) => forbidden.test(readFileSync(join(srcDir, name), "utf8")));

	assert.deepEqual(offenders, []);
});
