import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import { AgentSessionManager } from "../src/agent-session-manager.js";
import type {
	AgentRuntimeFactory,
	AgentSessionEventLike,
	ManagedAgentSession,
	ManagedPromptOptions,
} from "../src/agent-session-types.js";
import {
	findAgentSessionRecord,
	readAgentViewState,
} from "../src/agent-view-store.js";

function tempStorePath(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-session-manager-"));
	return path.join(root, "state.json");
}

class FakeSession implements ManagedAgentSession {
	readonly sessionId: string;
	readonly sessionFile: string;
	isStreaming = false;
	readonly promptCalls: string[] = [];
	readonly promptOptions: Array<ManagedPromptOptions | undefined> = [];
	readonly steerCalls: string[] = [];
	readonly followUpCalls: string[] = [];
	abortCalls = 0;
	disposeCalls = 0;
	private readonly listeners: Array<(event: AgentSessionEventLike) => void> =
		[];
	private readonly pendingPrompts: Array<{
		resolve: () => void;
		reject: (error: unknown) => void;
	}> = [];

	constructor(index: number) {
		this.sessionId = `pi-session-${index}`;
		this.sessionFile = `/tmp/pi-session-${index}.jsonl`;
	}

	subscribe(listener: (event: AgentSessionEventLike) => void): () => void {
		this.listeners.push(listener);
		return () => {
			const index = this.listeners.indexOf(listener);
			if (index >= 0) this.listeners.splice(index, 1);
		};
	}

	prompt(text: string, options?: ManagedPromptOptions): Promise<void> {
		this.promptCalls.push(text);
		this.promptOptions.push(options);
		this.isStreaming = true;
		this.emit({ type: "agent_start" });
		return new Promise<void>((resolve, reject) => {
			this.pendingPrompts.push({
				resolve: () => {
					this.isStreaming = false;
					this.emit({ type: "agent_end" });
					resolve();
				},
				reject: (error: unknown) => {
					this.isStreaming = false;
					reject(error);
				},
			});
		});
	}

	steer(text: string): Promise<void> {
		this.steerCalls.push(text);
		return Promise.resolve();
	}

	followUp(text: string): Promise<void> {
		this.followUpCalls.push(text);
		return Promise.resolve();
	}

	abort(): Promise<void> {
		this.abortCalls += 1;
		this.isStreaming = false;
		return Promise.resolve();
	}

	dispose(): void {
		this.disposeCalls += 1;
	}

	emit(event: AgentSessionEventLike): void {
		for (const listener of [...this.listeners]) listener(event);
	}

	resolvePrompt(index = 0): void {
		this.pendingPrompts[index]?.resolve();
	}

	rejectPrompt(error: unknown, index = 0): void {
		this.pendingPrompts[index]?.reject(error);
	}
}

function createFakeFactory(): {
	factory: AgentRuntimeFactory;
	sessions: FakeSession[];
	disposedRuntimeIds: string[];
} {
	const sessions: FakeSession[] = [];
	const disposedRuntimeIds: string[] = [];
	const factory: AgentRuntimeFactory = async ({ cwd }) => {
		const session = new FakeSession(sessions.length + 1);
		sessions.push(session);
		return {
			cwd,
			session,
			diagnostics: [],
			dispose: async () => {
				disposedRuntimeIds.push(session.sessionId);
				session.dispose();
			},
		};
	};
	return { factory, sessions, disposedRuntimeIds };
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

test("agent session manager starts native sessions asynchronously and records events", async () => {
	const storePath = tempStorePath();
	const { factory, sessions } = createFakeFactory();
	const manager = new AgentSessionManager({
		storePath,
		runtimeFactory: factory,
	});

	const record = await manager.startAgentSession({
		title: "Docs research",
		prompt: "research docs",
		cwd: "/tmp/repo",
		agentName: "researcher",
	});

	assert.equal(record.status, "queued");
	await waitFor(() => {
		assert.equal(sessions.length, 1);
		assert.deepEqual(sessions[0]?.promptCalls, ["research docs"]);
		assert.deepEqual(sessions[0]?.promptOptions, [{ source: "extension" }]);
		const stored = findAgentSessionRecord(
			readAgentViewState(storePath),
			record.id,
		);
		assert.equal(stored?.status, "running");
		assert.equal(stored?.sessionId, "pi-session-1");
		assert.equal(stored?.sessionFile, "/tmp/pi-session-1.jsonl");
	});

	sessions[0]?.emit({
		type: "message_update",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "partial answer" }],
		},
	});
	await waitFor(() => {
		const stored = findAgentSessionRecord(
			readAgentViewState(storePath),
			record.id,
		);
		assert.equal(stored?.events?.at(-1)?.text, "partial answer");
	});

	sessions[0]?.resolvePrompt();
	await waitFor(() => {
		const stored = findAgentSessionRecord(
			readAgentViewState(storePath),
			record.id,
		);
		assert.equal(stored?.status, "idle");
	});
});

test("agent session manager can complete one-shot sessions and dispose their runtimes", async () => {
	const storePath = tempStorePath();
	const { factory, sessions, disposedRuntimeIds } = createFakeFactory();
	const manager = new AgentSessionManager({
		storePath,
		runtimeFactory: factory,
	});
	const record = await manager.startAgentSession({
		title: "One shot",
		prompt: "finish",
		cwd: "/tmp/repo",
		completeOnPromptEnd: true,
	});

	await waitFor(() => assert.equal(sessions[0]?.promptCalls.length, 1));
	sessions[0]?.emit({
		type: "message_end",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "final text" }],
		},
	});
	sessions[0]?.resolvePrompt();

	await waitFor(() => {
		const stored = findAgentSessionRecord(
			readAgentViewState(storePath),
			record.id,
		);
		assert.equal(stored?.status, "completed");
		assert.equal(stored?.resultText, "final text");
		assert.deepEqual(disposedRuntimeIds, ["pi-session-1"]);
	});
});

test("agent session manager marks prompt failures as failed", async () => {
	const storePath = tempStorePath();
	const { factory, sessions, disposedRuntimeIds } = createFakeFactory();
	const manager = new AgentSessionManager({
		storePath,
		runtimeFactory: factory,
	});
	const record = await manager.startAgentSession({
		title: "Broken",
		prompt: "break",
		cwd: "/tmp/repo",
	});

	await waitFor(() => assert.equal(sessions[0]?.promptCalls.length, 1));
	sessions[0]?.rejectPrompt(new Error("boom"));

	await waitFor(() => {
		const stored = findAgentSessionRecord(
			readAgentViewState(storePath),
			record.id,
		);
		assert.equal(stored?.status, "failed");
		assert.equal(stored?.errorText, "boom");
		assert.deepEqual(disposedRuntimeIds, ["pi-session-1"]);
	});
});

test("agent session manager marks SDK agent end errors as failed", async () => {
	const storePath = tempStorePath();
	const { factory, sessions, disposedRuntimeIds } = createFakeFactory();
	const manager = new AgentSessionManager({
		storePath,
		runtimeFactory: factory,
	});
	const record = await manager.startAgentSession({
		title: "Broken SDK event",
		prompt: "break",
		cwd: "/tmp/repo",
		completeOnPromptEnd: true,
	});

	await waitFor(() => assert.equal(sessions[0]?.promptCalls.length, 1));
	sessions[0]?.emit({
		type: "agent_end",
		messages: [
			{
				role: "assistant",
				content: [],
				stopReason: "error",
				errorMessage: "model crashed",
			},
		],
	});
	sessions[0]?.resolvePrompt();

	await waitFor(() => {
		const stored = findAgentSessionRecord(
			readAgentViewState(storePath),
			record.id,
		);
		assert.equal(stored?.status, "failed");
		assert.equal(stored?.errorText, "model crashed");
		assert.deepEqual(disposedRuntimeIds, ["pi-session-1"]);
	});
});

test("agent session manager replies with prompt when idle and follow-up when streaming", async () => {
	const storePath = tempStorePath();
	const { factory, sessions } = createFakeFactory();
	const manager = new AgentSessionManager({
		storePath,
		runtimeFactory: factory,
	});
	const record = await manager.startAgentSession({
		title: "Interactive",
		prompt: "start",
		cwd: "/tmp/repo",
	});

	await waitFor(() => assert.equal(sessions[0]?.promptCalls.length, 1));
	sessions[0]?.resolvePrompt();
	await waitFor(() => {
		const stored = findAgentSessionRecord(
			readAgentViewState(storePath),
			record.id,
		);
		assert.equal(stored?.status, "idle");
	});

	await manager.replyToAgentSession(record.id, "next prompt");
	await waitFor(() =>
		assert.deepEqual(sessions[0]?.promptCalls, ["start", "next prompt"]),
	);

	await manager.replyToAgentSession(record.id, "queued prompt");
	assert.deepEqual(sessions[0]?.followUpCalls, ["queued prompt"]);
});

test("agent session manager stops and disposes active sessions", async () => {
	const storePath = tempStorePath();
	const { factory, sessions, disposedRuntimeIds } = createFakeFactory();
	const manager = new AgentSessionManager({
		storePath,
		runtimeFactory: factory,
	});
	const record = await manager.startAgentSession({
		title: "Stop me",
		prompt: "run",
		cwd: "/tmp/repo",
	});

	await waitFor(() => assert.equal(sessions[0]?.promptCalls.length, 1));
	await manager.stopAgentSession(record.id, "test stop");

	const stored = findAgentSessionRecord(
		readAgentViewState(storePath),
		record.id,
	);
	assert.equal(stored?.status, "cancelled");
	assert.equal(sessions[0]?.abortCalls, 1);
	assert.deepEqual(disposedRuntimeIds, ["pi-session-1"]);
});

test("agent session manager stop is idempotent for completed sessions", async () => {
	const storePath = tempStorePath();
	const { factory, sessions } = createFakeFactory();
	const manager = new AgentSessionManager({
		storePath,
		runtimeFactory: factory,
	});
	const record = await manager.startAgentSession({
		title: "One shot",
		prompt: "finish",
		cwd: "/tmp/repo",
		completeOnPromptEnd: true,
	});

	await waitFor(() => assert.equal(sessions[0]?.promptCalls.length, 1));
	sessions[0]?.resolvePrompt();
	await waitFor(() => {
		const stored = findAgentSessionRecord(
			readAgentViewState(storePath),
			record.id,
		);
		assert.equal(stored?.status, "completed");
	});

	await manager.stopAgentSession(record.id, "second stop");

	assert.equal(
		findAgentSessionRecord(readAgentViewState(storePath), record.id)?.status,
		"completed",
	);
});

test("agent session manager detaches active sessions during shutdown disposal", async () => {
	const storePath = tempStorePath();
	const { factory, sessions, disposedRuntimeIds } = createFakeFactory();
	const manager = new AgentSessionManager({
		storePath,
		runtimeFactory: factory,
	});
	const record = await manager.startAgentSession({
		title: "Detach me",
		prompt: "run",
		cwd: "/tmp/repo",
	});

	await waitFor(() => assert.equal(sessions[0]?.promptCalls.length, 1));
	await manager.disposeAllAgentSessions("shutdown");

	const stored = findAgentSessionRecord(
		readAgentViewState(storePath),
		record.id,
	);
	assert.equal(stored?.status, "detached");
	assert.deepEqual(disposedRuntimeIds, ["pi-session-1"]);
	assert.deepEqual(manager.listLiveSessionIds(), []);
});
