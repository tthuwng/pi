import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import {
	createAgentViewTeam,
	readAgentViewState,
} from "../src/agent-view-store.js";
import {
	cancelAgentTeamTask,
	runAgentTeamTask,
} from "../src/agent-team-runner.js";

interface MockContext {
	cwd: string;
	hasUI: boolean;
	ui: {
		notify(message: string, type?: string): void;
		setStatus(key: string, value: string | undefined): void;
	};
}

function tempStorePath(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-team-runner-"));
	return path.join(root, "state.json");
}

function setupBridge() {
	const events = new Map<string, Array<(payload: unknown) => void>>();
	const messages: unknown[] = [];
	const notifications: Array<{ message: string; type?: string }> = [];
	const eventBus = {
		on(event: string, handler: (payload: unknown) => void) {
			const handlers = events.get(event) ?? [];
			handlers.push(handler);
			events.set(event, handlers);
			return () =>
				events.set(
					event,
					(events.get(event) ?? []).filter(
						(candidate) => candidate !== handler,
					),
				);
		},
		emit(event: string, payload: unknown) {
			for (const handler of events.get(event) ?? []) handler(payload);
		},
	};
	const pi = {
		sendMessage(message: unknown) {
			messages.push(message);
		},
		events: eventBus,
	};
	const ctx: MockContext = {
		cwd: fs.mkdtempSync(path.join(os.tmpdir(), "agent-team-runner-cwd-")),
		hasUI: true,
		ui: {
			notify(message: string, type?: string) {
				notifications.push({ message, type });
			},
			setStatus() {},
		},
	};
	return { pi, ctx, events: eventBus, messages, notifications };
}

test("agent team runner dispatches each team member through pi-subagents", async () => {
	const storePath = tempStorePath();
	const team = createAgentViewTeam(storePath, {
		name: "Auth Team",
		members: [
			{ id: "review", agent: "reviewer", label: "Review" },
			{ id: "tests", agent: "scout" },
		],
	});
	const { pi, ctx, events } = setupBridge();
	let request:
		| {
				requestId?: string;
				params?: { tasks?: Array<{ agent?: string; task?: string }> };
		  }
		| undefined;
	events.on("subagent:slash:request", (payload) => {
		request = payload as typeof request;
		events.emit("subagent:slash:started", { requestId: request?.requestId });
		events.emit("subagent:slash:update", {
			requestId: request?.requestId,
			toolCount: 2,
			currentTool: "read",
		});
		events.emit("subagent:slash:response", {
			requestId: request?.requestId,
			isError: false,
			result: { content: [{ type: "text", text: "team done" }] },
		});
	});

	const task = await runAgentTeamTask(
		storePath,
		pi,
		ctx,
		team.id,
		"audit auth handlers",
	);

	assert.equal(request?.params?.tasks?.length, 2);
	assert.deepEqual(
		request?.params?.tasks?.map((candidate) => candidate.agent),
		["reviewer", "scout"],
	);
	assert.match(request?.params?.tasks?.[0]?.task ?? "", /audit auth handlers/);
	assert.equal(task.status, "completed");
	assert.equal(task.resultText, "team done");
	const stored = readAgentViewState(storePath).teams[0]?.tasks[0];
	assert.equal(stored?.requestId, request?.requestId);
	assert.equal(stored?.events?.at(-1)?.type, "tool");
});

test("agent team runner records bridge failures", async () => {
	const storePath = tempStorePath();
	const team = createAgentViewTeam(storePath, {
		name: "Failing Team",
		members: [{ id: "review", agent: "reviewer" }],
	});
	const { pi, ctx, events } = setupBridge();
	events.on("subagent:slash:request", (payload) => {
		const request = payload as { requestId?: string };
		events.emit("subagent:slash:started", { requestId: request.requestId });
		events.emit("subagent:slash:response", {
			requestId: request.requestId,
			isError: true,
			errorText: "team failed",
		});
	});

	const task = await runAgentTeamTask(storePath, pi, ctx, team.id, "break it");

	assert.equal(task.status, "failed");
	assert.equal(task.errorText, "team failed");
});

test("agent team runner cancels active team tasks", async () => {
	const storePath = tempStorePath();
	const team = createAgentViewTeam(storePath, {
		name: "Cancel Team",
		members: [{ id: "review", agent: "reviewer" }],
	});
	const { pi, ctx, events } = setupBridge();
	let taskId = "";
	let cancelled: unknown;
	events.on("subagent:slash:request", (payload) => {
		const request = payload as { requestId?: string };
		events.emit("subagent:slash:started", { requestId: request.requestId });
	});
	events.on("subagent:slash:cancel", (payload) => {
		cancelled = payload;
		events.emit("subagent:slash:response", {
			requestId: (payload as { requestId?: string }).requestId,
			isError: true,
			errorText: "cancelled",
		});
	});

	const running = runAgentTeamTask(storePath, pi, ctx, team.id, "long review", {
		timeoutMs: 30_000,
	});
	await new Promise((resolve) => setImmediate(resolve));
	taskId = readAgentViewState(storePath).teams[0]?.tasks[0]?.id ?? "";
	const cancelledTask = cancelAgentTeamTask(storePath, pi, team.id, taskId);
	const finished = await running;

	assert.deepEqual(cancelled, { requestId: cancelledTask.requestId });
	assert.equal(cancelledTask.status, "cancelled");
	assert.equal(finished.status, "cancelled");
});

test("agent team runner refuses to cancel completed team tasks", async () => {
	const storePath = tempStorePath();
	const team = createAgentViewTeam(storePath, {
		name: "Done Team",
		members: [{ id: "review", agent: "reviewer" }],
	});
	const { pi, ctx, events } = setupBridge();
	let cancelled = false;
	events.on("subagent:slash:request", (payload) => {
		const request = payload as { requestId?: string };
		events.emit("subagent:slash:started", { requestId: request.requestId });
		events.emit("subagent:slash:response", {
			requestId: request.requestId,
			isError: false,
			result: { content: [{ type: "text", text: "done" }] },
		});
	});
	events.on("subagent:slash:cancel", () => {
		cancelled = true;
	});

	const task = await runAgentTeamTask(
		storePath,
		pi,
		ctx,
		team.id,
		"quick review",
	);

	assert.throws(
		() => cancelAgentTeamTask(storePath, pi, team.id, task.id),
		/Agent team task is not running/,
	);
	assert.equal(cancelled, false);
	assert.equal(
		readAgentViewState(storePath).teams[0]?.tasks[0]?.status,
		"completed",
	);
});
