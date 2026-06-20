import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import type { StartAgentSessionInput } from "../src/agent-session-manager.js";
import {
	createAgentViewTeam,
	readAgentViewState,
	type AgentSessionRecord,
} from "../src/agent-view-store.js";
import {
	cancelAgentTeamTask,
	runAgentTeamTask,
	type AgentTeamSessionRunner,
} from "../src/agent-team-runner.js";

interface MockContext {
	cwd: string;
	hasUI: boolean;
	ui: {
		notify(message: string, type?: string): void;
		setStatus(key: string, value: string | undefined): void;
	};
}

interface StartedSession {
	input: StartAgentSessionInput;
	record: AgentSessionRecord;
}

function tempStorePath(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-team-runner-"));
	return path.join(root, "state.json");
}

function mockContext(): MockContext {
	return {
		cwd: fs.mkdtempSync(path.join(os.tmpdir(), "agent-team-runner-cwd-")),
		hasUI: true,
		ui: {
			notify() {},
			setStatus() {},
		},
	};
}

function completedRecord(
	record: AgentSessionRecord,
	index: number,
): AgentSessionRecord {
	return {
		...record,
		status: "completed",
		updatedAt: new Date(Date.parse(record.createdAt) + 1_000).toISOString(),
		resultText: `member ${index + 1} done`,
	};
}

function createFakeRunner(
	resultForSession: (
		record: AgentSessionRecord,
		index: number,
	) => AgentSessionRecord | Promise<AgentSessionRecord> = completedRecord,
): AgentTeamSessionRunner & {
	started: StartedSession[];
	stopped: string[];
	resolve(sessionId: string, record: AgentSessionRecord): void;
} {
	const started: StartedSession[] = [];
	const stopped: string[] = [];
	const completions = new Map<string, Promise<AgentSessionRecord>>();
	const resolvers = new Map<string, (record: AgentSessionRecord) => void>();
	return {
		started,
		stopped,
		async startAgentSession(input) {
			const now = new Date().toISOString();
			const record: AgentSessionRecord = {
				id: `session-${started.length + 1}`,
				title: input.title,
				cwd: input.cwd,
				status: "running",
				createdAt: now,
				updatedAt: now,
				agentName: input.agentName,
				teamId: input.teamId,
				taskId: input.taskId,
				memberId: input.memberId,
				prompt: input.prompt,
			};
			started.push({ input, record });
			const completion = new Promise<AgentSessionRecord>((resolve) => {
				resolvers.set(record.id, resolve);
			});
			completions.set(record.id, completion);
			void Promise.resolve(resultForSession(record, started.length - 1)).then(
				(result) => resolvers.get(record.id)?.(result),
			);
			return record;
		},
		waitForAgentSession(sessionId) {
			const completion = completions.get(sessionId);
			if (!completion) throw new Error(`unknown session ${sessionId}`);
			return completion;
		},
		async stopAgentSession(sessionId) {
			stopped.push(sessionId);
			const resolver = resolvers.get(sessionId);
			const startedSession = started.find(
				(candidate) => candidate.record.id === sessionId,
			);
			resolver?.({
				...(startedSession?.record ?? {
					id: sessionId,
					title: sessionId,
					cwd: "",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				}),
				status: "cancelled",
				updatedAt: new Date().toISOString(),
			});
		},
		resolve(sessionId, record) {
			resolvers.get(sessionId)?.(record);
		},
	};
}

function createDeferredRunner(): ReturnType<typeof createFakeRunner> {
	return createFakeRunner(() => new Promise<AgentSessionRecord>(() => {}));
}

async function waitFor(assertion: () => void): Promise<void> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 40; attempt += 1) {
		try {
			assertion();
			return;
		} catch (error) {
			lastError = error;
			await delay(5);
		}
	}
	throw lastError;
}

test("agent team runner starts each member as a native session", async () => {
	const storePath = tempStorePath();
	const team = createAgentViewTeam(storePath, {
		name: "Auth Team",
		members: [
			{ id: "review", agent: "reviewer", label: "Review" },
			{ id: "tests", agent: "scout" },
		],
	});
	const runner = createFakeRunner();

	const task = await runAgentTeamTask(
		storePath,
		runner,
		mockContext(),
		team.id,
		"audit auth handlers",
	);

	assert.equal(runner.started.length, 2);
	assert.deepEqual(
		runner.started.map((session) => session.input.agentName),
		["reviewer", "scout"],
	);
	assert.deepEqual(
		runner.started.map((session) => session.input.memberId),
		["review", "tests"],
	);
	assert.match(runner.started[0]?.input.prompt ?? "", /audit auth handlers/);
	assert.match(runner.started[0]?.input.prompt ?? "", /Auth Team/);
	assert.equal(task.status, "completed");
	assert.match(task.resultText ?? "", /### Review \(reviewer\)/);
	assert.match(task.resultText ?? "", /member 1 done/);
	const stored = readAgentViewState(storePath).teams[0]?.tasks[0];
	assert.deepEqual(stored?.memberSessions, [
		{ memberId: "review", sessionId: "session-1" },
		{ memberId: "tests", sessionId: "session-2" },
	]);
});

test("agent team runner records native member failures", async () => {
	const storePath = tempStorePath();
	const team = createAgentViewTeam(storePath, {
		name: "Failing Team",
		members: [{ id: "review", agent: "reviewer" }],
	});
	const runner = createFakeRunner((record) => ({
		...record,
		status: "failed",
		errorText: "member failed",
	}));

	const task = await runAgentTeamTask(
		storePath,
		runner,
		mockContext(),
		team.id,
		"break it",
	);

	assert.equal(task.status, "failed");
	assert.equal(task.errorText, "member failed");
});

test("agent team runner cancels active native member sessions", async () => {
	const storePath = tempStorePath();
	const team = createAgentViewTeam(storePath, {
		name: "Cancel Team",
		members: [{ id: "review", agent: "reviewer" }],
	});
	const runner = createDeferredRunner();
	const running = runAgentTeamTask(
		storePath,
		runner,
		mockContext(),
		team.id,
		"long review",
	);
	await waitFor(() => {
		assert.equal(runner.started.length, 1);
		assert.equal(
			readAgentViewState(storePath).teams[0]?.tasks[0]?.memberSessions?.length,
			1,
		);
	});
	const taskId = readAgentViewState(storePath).teams[0]?.tasks[0]?.id;
	assert.ok(taskId);

	const cancelledTask = await cancelAgentTeamTask(
		storePath,
		runner,
		team.id,
		taskId,
	);
	const finished = await running;

	assert.deepEqual(runner.stopped, ["session-1"]);
	assert.equal(cancelledTask.status, "cancelled");
	assert.equal(finished.status, "cancelled");
});

test("agent team runner treats repeated native task cancellation as a no-op", async () => {
	const storePath = tempStorePath();
	const team = createAgentViewTeam(storePath, {
		name: "Repeat Cancel Team",
		members: [{ id: "review", agent: "reviewer" }],
	});
	const runner = createDeferredRunner();

	const running = runAgentTeamTask(
		storePath,
		runner,
		mockContext(),
		team.id,
		"long review",
	);
	await waitFor(() => {
		const task = readAgentViewState(storePath).teams[0]?.tasks[0];
		assert.equal(runner.started.length, 1);
		assert.equal(task?.memberSessions?.length, 1);
	});
	const taskId = readAgentViewState(storePath).teams[0]?.tasks[0]?.id;
	assert.ok(taskId);

	await cancelAgentTeamTask(storePath, runner, team.id, taskId);
	const repeated = await cancelAgentTeamTask(storePath, runner, team.id, taskId);
	await running;

	assert.deepEqual(runner.stopped, ["session-1"]);
	assert.equal(repeated.status, "cancelled");
});

test("agent team runner refuses to cancel completed native team tasks", async () => {
	const storePath = tempStorePath();
	const team = createAgentViewTeam(storePath, {
		name: "Done Team",
		members: [{ id: "review", agent: "reviewer" }],
	});
	const runner = createFakeRunner();

	const task = await runAgentTeamTask(
		storePath,
		runner,
		mockContext(),
		team.id,
		"quick review",
	);

	await assert.rejects(
		() => cancelAgentTeamTask(storePath, runner, team.id, task.id),
		/Agent team task is not running/,
	);
	assert.equal(
		readAgentViewState(storePath).teams[0]?.tasks[0]?.status,
		"completed",
	);
});
