import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import dynamicWorkflows, {
	attachWorkflowRequest,
	createWorkflowRun,
	finishWorkflowRun,
	startWorkflowRun,
} from "../src/index.js";
import type {
	AgentRuntimeFactory,
	AgentSessionEventLike,
	ManagedAgentSession,
	ManagedPromptOptions,
} from "../src/agent-session-types.js";
import { readAgentViewState } from "../src/agent-view-store.js";
import type { PlannedWorkflowParams, WorkflowSpec } from "../src/types.js";

interface RegisteredCommand {
	description: string;
	handler: (args: string, ctx: MockContext) => Promise<void> | void;
	getArgumentCompletions?: (
		prefix: string,
	) => Array<{ value: string; label: string }> | null;
}

interface MockCustomComponent {
	render(width: number): string[];
	handleInput?(data: string): void;
	invalidate(): void;
}

interface MockTui {
	requestRender(): void;
}

interface MockContext {
	cwd: string;
	hasUI: boolean;
	ui: {
		notify(message: string, type?: string): void;
		setStatus(key: string, value: string | undefined): void;
		custom?(
			factory: (
				tui: MockTui,
				theme: unknown,
				keybindings: unknown,
				done: () => void,
			) => MockCustomComponent,
			options?: { overlay?: boolean },
		): unknown;
	};
}

function tempDir(): string {
	return fs.mkdtempSync(
		path.join(os.tmpdir(), "pi-dynamic-workflows-command-"),
	);
}

class FakeAgentSession implements ManagedAgentSession {
	readonly sessionId: string;
	readonly sessionFile: string;
	isStreaming = false;
	readonly promptCalls: string[] = [];
	readonly promptOptions: Array<ManagedPromptOptions | undefined> = [];
	readonly followUpCalls: string[] = [];
	readonly steerCalls: string[] = [];
	abortCalls = 0;
	disposeCalls = 0;
	private readonly listeners: Array<(event: AgentSessionEventLike) => void> =
		[];

	constructor(
		index: number,
		private readonly autoCompletePrompts: boolean,
	) {
		this.sessionId = `pi-session-${index}`;
		this.sessionFile = `/tmp/pi-command-session-${index}.jsonl`;
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
		if (this.autoCompletePrompts) {
			const message = {
				role: "assistant",
				content: [{ type: "text", text: `result for ${text}` }],
			};
			this.emit({ type: "message_update", message });
			this.isStreaming = false;
			this.emit({ type: "agent_end", messages: [message] });
			return Promise.resolve();
		}
		return new Promise(() => {});
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
}

function fakeAgentRuntimeFactory(
	options: { autoCompletePrompts?: boolean } = {},
): {
	factory: AgentRuntimeFactory;
	sessions: FakeAgentSession[];
	disposedRuntimeIds: string[];
} {
	const sessions: FakeAgentSession[] = [];
	const disposedRuntimeIds: string[] = [];
	const factory: AgentRuntimeFactory = async ({ cwd }: { cwd: string }) => {
		const session = new FakeAgentSession(
			sessions.length + 1,
			options.autoCompletePrompts ?? false,
		);
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

async function flushAgentCommands(): Promise<void> {
	await new Promise((resolve) => setImmediate(resolve));
	await new Promise((resolve) => setImmediate(resolve));
}

function setup(options: { agentRuntimeFactory?: AgentRuntimeFactory } = {}) {
	const root = tempDir();
	const packageDir = path.join(root, "package-workflows");
	const runDir = path.join(root, "runs");
	const agentViewStorePath = path.join(root, "agent-view.json");
	fs.mkdirSync(packageDir, { recursive: true });
	fs.writeFileSync(
		path.join(packageDir, "demo.workflow.json"),
		JSON.stringify({
			name: "demo",
			description: "Demo workflow",
			argumentHint: "<topic>",
			chain: [{ agent: "delegate", task: "Do {task}" }],
		}),
	);
	fs.writeFileSync(
		path.join(packageDir, "quality-gate.workflow.json"),
		JSON.stringify({
			name: "quality-gate",
			description: "Quality gate workflow",
			argumentHint: "<target>",
			chain: [{ agent: "reviewer", task: "Review {task}" }],
		}),
	);
	fs.writeFileSync(
		path.join(packageDir, "async-demo.workflow.json"),
		JSON.stringify({
			name: "async-demo",
			description: "Async demo workflow",
			argumentHint: "<topic>",
			defaultAsync: true,
			chain: [{ agent: "delegate", task: "Async {task}" }],
		}),
	);

	const commands = new Map<string, RegisteredCommand>();
	const messages: unknown[] = [];
	const events = new Map<string, Array<(payload: unknown) => void>>();
	const notifications: Array<{ message: string; type?: string }> = [];
	const inputHandlers: Array<
		(event: { text: string; source?: string }, ctx: MockContext) => unknown
	> = [];
	const lifecycleHandlers = new Map<
		string,
		Array<(event: unknown, ctx: MockContext) => unknown>
	>();

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
		registerCommand(name: string, command: RegisteredCommand) {
			commands.set(name, command);
		},
		on(event: string, handler: (event: never, ctx: MockContext) => unknown) {
			if (event === "input") {
				inputHandlers.push(handler as never);
				return;
			}
			const handlers = lifecycleHandlers.get(event) ?? [];
			handlers.push(handler as never);
			lifecycleHandlers.set(event, handlers);
		},
		sendMessage(message: unknown) {
			messages.push(message);
		},
		events: eventBus,
	};
	const ctx: MockContext = {
		cwd: root,
		hasUI: true,
		ui: {
			notify(message: string, type?: string) {
				notifications.push({ message, type });
			},
			setStatus() {},
		},
	};

	dynamicWorkflows(pi as never, {
		packageWorkflowDir: packageDir,
		runDir,
		agentViewStorePath,
		...(options.agentRuntimeFactory
			? { agentRuntimeFactory: options.agentRuntimeFactory }
			: {}),
	});
	return {
		commands,
		messages,
		events: eventBus,
		notifications,
		ctx,
		root,
		runDir,
		agentViewStorePath,
		inputHandlers,
		emitLifecycle(event: string) {
			for (const handler of lifecycleHandlers.get(event) ?? [])
				handler({}, ctx);
		},
	};
}

test("registers workflow commands", () => {
	const { commands } = setup();

	assert.ok(commands.has("workflows"));
	assert.ok(commands.has("workflow"));
	assert.ok(commands.has("workflow-export"));
	assert.ok(commands.has("workflow-cancel"));
	assert.ok(commands.has("workflow-save"));
	assert.ok(commands.has("team-create"));
	assert.ok(commands.has("team-run"));
	assert.ok(commands.has("team-status"));
	assert.ok(commands.has("team-send"));
	assert.ok(commands.has("team-stop"));
	assert.ok(commands.has("agents"));
	assert.ok(commands.has("agent-start"));
	assert.ok(commands.has("agent-reply"));
	assert.ok(commands.has("agent-stop"));
	assert.ok(commands.has("agent-status"));
});

test("agent commands start, inspect, reply to, stop, and dispose native sessions", async () => {
	const fakeRuntime = fakeAgentRuntimeFactory();
	const {
		commands,
		ctx,
		agentViewStorePath,
		notifications,
		messages,
		emitLifecycle,
	} = setup({
		agentRuntimeFactory: fakeRuntime.factory,
	});

	await commands.get("agent-start")!.handler("-- inspect docs", ctx);
	await flushAgentCommands();

	const [session] = readAgentViewState(agentViewStorePath).sessions;
	assert.ok(session);
	assert.equal(session.status, "running");
	assert.equal(session.title, "inspect docs");
	assert.deepEqual(fakeRuntime.sessions[0]?.promptCalls, ["inspect docs"]);
	assert.deepEqual(notifications.at(-1), {
		message: `Started agent session '${session.id}'.`,
		type: "info",
	});

	await commands.get("agent-status")!.handler(session.id, ctx);
	assert.match(JSON.stringify(messages.at(-1)), /inspect docs/);
	assert.match(JSON.stringify(messages.at(-1)), /pi-session-1/);

	await commands.get("agent-reply")!.handler(`${session.id} -- continue`, ctx);
	assert.deepEqual(fakeRuntime.sessions[0]?.followUpCalls, ["continue"]);
	assert.deepEqual(notifications.at(-1), {
		message: `Sent reply to agent session '${session.id}'.`,
		type: "info",
	});

	await commands.get("agent-stop")!.handler(session.id, ctx);
	assert.equal(fakeRuntime.sessions[0]?.abortCalls, 1);
	assert.equal(
		readAgentViewState(agentViewStorePath).sessions[0]?.status,
		"cancelled",
	);

	await commands.get("agent-start")!.handler("-- stay alive", ctx);
	await flushAgentCommands();
	emitLifecycle("session_shutdown");
	await flushAgentCommands();
	assert.equal(
		readAgentViewState(agentViewStorePath).sessions.at(-1)?.status,
		"detached",
	);
	assert.deepEqual(fakeRuntime.disposedRuntimeIds, [
		"pi-session-1",
		"pi-session-2",
	]);
});

test("agent commands validate usage", async () => {
	const fakeRuntime = fakeAgentRuntimeFactory();
	const { commands, ctx, notifications } = setup({
		agentRuntimeFactory: fakeRuntime.factory,
	});

	await commands.get("agent-start")!.handler("", ctx);
	assert.deepEqual(notifications.at(-1), {
		message: "Usage: /agent-start -- <prompt>",
		type: "error",
	});
	await commands.get("agent-reply")!.handler("missing", ctx);
	assert.deepEqual(notifications.at(-1), {
		message: "Usage: /agent-reply <session-id> -- <message>",
		type: "error",
	});
	await commands.get("agent-stop")!.handler("", ctx);
	assert.deepEqual(notifications.at(-1), {
		message: "Usage: /agent-stop <session-id>",
		type: "error",
	});
});

test("workflows command opens a closeable focused panel when custom UI is available", async () => {
	const { commands, messages, ctx } = setup();
	let closed = false;
	let requestRenderCount = 0;
	let overlay: boolean | undefined;
	let rendered = "";

	ctx.ui.custom = (factory, options) => {
		overlay = options?.overlay;
		const component = factory(
			{
				requestRender() {
					requestRenderCount += 1;
				},
			},
			{},
			undefined,
			() => {
				closed = true;
			},
		);
		rendered = component.render(80).join("\n");
		component.handleInput?.("\x1b");
	};

	await commands.get("workflows")!.handler("", ctx);

	assert.equal(overlay, undefined);
	assert.equal(messages.length, 0);
	assert.match(rendered, /Dynamic workflows/);
	assert.doesNotMatch(rendered, /demo/);
	assert.match(rendered, /No dynamic workflows in this session/);
	assert.equal(closed, true);
	assert.equal(requestRenderCount, 0);
});

test("workflows command falls back to a markdown message without custom UI", async () => {
	const { commands, messages, ctx } = setup();

	await commands.get("workflows")!.handler("", ctx);

	assert.match(JSON.stringify(messages.at(-1)), /demo/);
});

test("input event auto-routes explicit workflow prompts", async () => {
	const fakeRuntime = fakeAgentRuntimeFactory({ autoCompletePrompts: true });
	const { inputHandlers, ctx, runDir } = setup({
		agentRuntimeFactory: fakeRuntime.factory,
	});

	const result = await inputHandlers[0]?.(
		{ text: "ultracode: demo about cats", source: "interactive" },
		ctx,
	);
	await flushAgentCommands();

	assert.deepEqual(result, { action: "handled" });
	assert.deepEqual(fakeRuntime.sessions[0]?.promptCalls, ["Do cats"]);
	const [runFile] = fs.readdirSync(runDir);
	const run = JSON.parse(
		fs.readFileSync(path.join(runDir, runFile!), "utf-8"),
	) as {
		workflowName?: string;
		status?: string;
		resultText?: string;
		sessionIds?: string[];
	};
	assert.equal(run.workflowName, "demo");
	assert.equal(run.status, "completed");
	assert.equal(run.resultText, "result for Do cats");
	assert.equal(run.sessionIds?.length, 1);
});

test("input event auto-routes substantive audit prompts", async () => {
	const fakeRuntime = fakeAgentRuntimeFactory({ autoCompletePrompts: true });
	const { inputHandlers, ctx, runDir } = setup({
		agentRuntimeFactory: fakeRuntime.factory,
	});

	const result = await inputHandlers[0]?.(
		{ text: "audit every API endpoint for auth", source: "interactive" },
		ctx,
	);
	await flushAgentCommands();

	assert.deepEqual(result, { action: "handled" });
	assert.deepEqual(fakeRuntime.sessions[0]?.promptCalls, [
		"Review audit every API endpoint for auth",
	]);
	const [runFile] = fs.readdirSync(runDir);
	const run = JSON.parse(
		fs.readFileSync(path.join(runDir, runFile!), "utf-8"),
	) as {
		workflowName?: string;
		status?: string;
		resultText?: string;
		sessionIds?: string[];
	};
	assert.equal(run.workflowName, "quality-gate");
	assert.equal(run.status, "completed");
	assert.equal(
		run.resultText,
		"result for Review audit every API endpoint for auth",
	);
	assert.equal(run.sessionIds?.length, 1);
});

test("input event leaves routine prompts alone", async () => {
	const { inputHandlers, ctx } = setup();

	const result = await inputHandlers[0]?.(
		{ text: "fix the failing test", source: "interactive" },
		ctx,
	);

	assert.deepEqual(result, { action: "continue" });
});

test("input event auto-routes explicit team prompts when a team exists", async () => {
	const fakeRuntime = fakeAgentRuntimeFactory({ autoCompletePrompts: true });
	const { commands, inputHandlers, ctx, agentViewStorePath } = setup({
		agentRuntimeFactory: fakeRuntime.factory,
	});

	await commands
		.get("team-create")!
		.handler("Audit Team -- review=reviewer", ctx);
	const result = await inputHandlers[0]?.(
		{ text: "assemble a team to audit auth", source: "interactive" },
		ctx,
	);
	await flushAgentCommands();

	assert.deepEqual(result, { action: "handled" });
	assert.match(
		fakeRuntime.sessions[0]?.promptCalls[0] ?? "",
		/assemble a team to audit auth/,
	);
	const [task] = readAgentViewState(agentViewStorePath).teams[0]?.tasks ?? [];
	assert.equal(task?.status, "completed");
	assert.match(task?.memberSessions?.[0]?.sessionId ?? "", /^session-/);
	assert.match(task?.text ?? "", /assemble a team to audit auth/);
});

test("input event does not auto-route team prompts without teams", async () => {
	const { inputHandlers, ctx } = setup();

	const result = await inputHandlers[0]?.(
		{ text: "assemble a team to audit auth", source: "interactive" },
		ctx,
	);

	assert.deepEqual(result, { action: "continue" });
});

test("workflow command runs planned params through native sessions", async () => {
	const fakeRuntime = fakeAgentRuntimeFactory({ autoCompletePrompts: true });
	const { commands, ctx, runDir } = setup({
		agentRuntimeFactory: fakeRuntime.factory,
	});

	await commands.get("workflow")!.handler("demo -- test topic", ctx);
	await flushAgentCommands();

	assert.deepEqual(fakeRuntime.sessions[0]?.promptCalls, ["Do test topic"]);
	const runs = fs.readdirSync(runDir);
	assert.equal(runs.length, 1);
	const run = JSON.parse(
		fs.readFileSync(path.join(runDir, runs[0]!), "utf-8"),
	) as {
		status?: string;
		workflowName?: string;
		resultText?: string;
		sessionIds?: string[];
		updates?: Array<{ at?: string; type?: string; text?: string }>;
	};
	assert.equal(run.status, "completed");
	assert.equal(run.workflowName, "demo");
	assert.equal(run.resultText, "result for Do test topic");
	assert.equal(run.sessionIds?.length, 1);
	assert.match(
		run.updates?.at(-1)?.text ?? "",
		/Completed native workflow session/,
	);
});

test("workflow command --bg returns before native child completion", async () => {
	const fakeRuntime = fakeAgentRuntimeFactory();
	const { commands, ctx, runDir, notifications } = setup({
		agentRuntimeFactory: fakeRuntime.factory,
	});

	const result = await Promise.race([
		Promise.resolve(
			commands.get("workflow")!.handler("demo -- long topic --bg", ctx),
		).then(() => "returned"),
		delay(30).then(() => "blocked"),
	]);
	await flushAgentCommands();

	assert.equal(result, "returned");
	assert.deepEqual(fakeRuntime.sessions[0]?.promptCalls, ["Do long topic"]);
	assert.equal(readRuns(runDir)[0]?.status, "running");
	assert.match(notifications.at(-1)?.message ?? "", /Started workflow run/);
});

test("workflow command honors defaultAsync without blocking", async () => {
	const fakeRuntime = fakeAgentRuntimeFactory();
	const { commands, ctx, runDir, notifications } = setup({
		agentRuntimeFactory: fakeRuntime.factory,
	});

	const result = await Promise.race([
		Promise.resolve(
			commands.get("workflow")!.handler("async-demo -- long topic", ctx),
		).then(() => "returned"),
		delay(30).then(() => "blocked"),
	]);
	await flushAgentCommands();

	assert.equal(result, "returned");
	assert.deepEqual(fakeRuntime.sessions[0]?.promptCalls, ["Async long topic"]);
	assert.equal(readRuns(runDir)[0]?.status, "running");
	assert.match(notifications.at(-1)?.message ?? "", /Started workflow run/);
});

test("workflow-export writes a discovered workflow without overwriting", async () => {
	const { commands, ctx, root, notifications } = setup();
	const target = path.join(root, "exported.workflow.json");

	await commands.get("workflow-export")!.handler(`demo -- ${target}`, ctx);

	assert.match(fs.readFileSync(target, "utf-8"), /Demo workflow/);

	await commands.get("workflow-export")!.handler(`demo -- ${target}`, ctx);
	assert.deepEqual(notifications.at(-1), {
		message: `Refusing to overwrite existing file: ${target}`,
		type: "error",
	});
});

test("workflow-cancel stops native workflow sessions and preserves cancelled status", async () => {
	const fakeRuntime = fakeAgentRuntimeFactory();
	const { commands, ctx, runDir, notifications } = setup({
		agentRuntimeFactory: fakeRuntime.factory,
	});

	const running = commands.get("workflow")!.handler("demo -- long topic", ctx);
	await flushAgentCommands();
	const [runFile] = fs.readdirSync(runDir);
	assert.ok(runFile);
	const run = JSON.parse(
		fs.readFileSync(path.join(runDir, runFile), "utf-8"),
	) as { id?: string; sessionIds?: string[] };
	assert.ok(run.id);
	assert.equal(run.sessionIds?.length, 1);

	await commands.get("workflow-cancel")!.handler(run.id, ctx);
	await running;
	await commands.get("workflow-cancel")!.handler(run.id, ctx);

	const [record] = readRuns(runDir);
	assert.equal(fakeRuntime.sessions[0]?.abortCalls, 1);
	assert.equal(record?.status, "cancelled");
	assert.match(notifications.at(-1)?.message ?? "", /already cancelled/);
});

test("workflow-cancel emits bridge cancellation and marks the run", async () => {
	const { commands, events, ctx, runDir } = setup();
	const run = makeRunningRun(runDir);
	attachWorkflowRequest(runDir, run.id, "request-1");
	let cancelled: unknown;
	events.on("subagent:slash:cancel", (payload) => {
		cancelled = payload;
	});

	await commands.get("workflow-cancel")!.handler(run.id, ctx);

	assert.deepEqual(cancelled, { requestId: "request-1" });
	const [record] = readRuns(runDir);
	assert.equal(record?.status, "cancelled");
});

test("workflow-cancel refuses completed runs", async () => {
	const { commands, events, ctx, runDir, notifications } = setup();
	const run = makeRunningRun(runDir);
	attachWorkflowRequest(runDir, run.id, "request-1");
	finishWorkflowRun(runDir, run.id, {
		status: "completed",
		resultText: "done",
	});
	let cancelled = false;
	events.on("subagent:slash:cancel", () => {
		cancelled = true;
	});

	await commands.get("workflow-cancel")!.handler(run.id, ctx);

	assert.equal(cancelled, false);
	assert.deepEqual(notifications.at(-1), {
		message: `Workflow run '${run.id}' is not running.`,
		type: "error",
	});
	const [record] = readRuns(runDir);
	assert.equal(record?.status, "completed");
});

test("workflow-save copies the run workflow spec without overwriting", async () => {
	const { commands, ctx, root, runDir, notifications } = setup();
	const run = makeRunningRun(runDir);
	const target = path.join(root, "saved.workflow.json");

	await commands.get("workflow-save")!.handler(`${run.id} -- ${target}`, ctx);

	assert.match(fs.readFileSync(target, "utf-8"), /Demo workflow/);
	await commands.get("workflow-save")!.handler(`${run.id} -- ${target}`, ctx);
	assert.deepEqual(notifications.at(-1), {
		message: `Refusing to overwrite existing file: ${target}`,
		type: "error",
	});
});

test("team-create creates a persistent agent team", async () => {
	const { commands, ctx, agentViewStorePath, notifications } = setup();

	await commands
		.get("team-create")!
		.handler("Auth Team -- review=reviewer,tests=scout", ctx);

	const [team] = readAgentViewState(agentViewStorePath).teams;
	assert.equal(team?.id, "auth-team");
	assert.deepEqual(
		team?.members.map((member) => [member.id, member.agent]),
		[
			["review", "reviewer"],
			["tests", "scout"],
		],
	);
	assert.deepEqual(notifications.at(-1), {
		message: "Created agent team 'auth-team'.",
		type: "info",
	});
});

test("team-run dispatches a persistent team task", async () => {
	const fakeRuntime = fakeAgentRuntimeFactory({ autoCompletePrompts: true });
	const { commands, ctx, agentViewStorePath } = setup({
		agentRuntimeFactory: fakeRuntime.factory,
	});

	await commands
		.get("team-create")!
		.handler("Auth Team -- review=reviewer", ctx);
	await commands.get("team-run")!.handler("auth-team -- audit auth", ctx);

	assert.match(fakeRuntime.sessions[0]?.promptCalls[0] ?? "", /audit auth/);
	const [task] = readAgentViewState(agentViewStorePath).teams[0]?.tasks ?? [];
	assert.equal(task?.status, "completed");
	assert.match(task?.memberSessions?.[0]?.sessionId ?? "", /^session-/);
	assert.match(task?.resultText ?? "", /result for/);
});

test("team-status and team-send render team state", async () => {
	const { commands, ctx, messages } = setup();

	await commands
		.get("team-create")!
		.handler("Research Team -- docs=scout", ctx);
	await commands
		.get("team-send")!
		.handler("research-team/docs -- Check primary docs first.", ctx);
	await commands.get("team-status")!.handler("research-team", ctx);

	assert.match(JSON.stringify(messages.at(-1)), /Research Team/);
	assert.match(JSON.stringify(messages.at(-1)), /Check primary docs first/);
});

test("agents command opens a closeable focused panel when custom UI is available", async () => {
	const { commands, ctx, messages } = setup();
	let closed = false;
	let overlay: boolean | undefined;
	let rendered = "";

	ctx.ui.custom = (factory, options) => {
		overlay = options?.overlay;
		const component = factory({ requestRender() {} }, {}, undefined, () => {
			closed = true;
		});
		rendered = component.render(80).join("\n");
		component.handleInput?.("escape");
	};

	await commands
		.get("team-create")!
		.handler("Dashboard Team -- review=reviewer", ctx);
	await commands.get("agents")!.handler("", ctx);

	assert.equal(overlay, undefined);
	assert.equal(messages.length, 0);
	assert.match(rendered, /Agent teams/);
	assert.match(rendered, /Dashboard Team/);
	assert.match(rendered, /reviewer/);
	assert.equal(closed, true);
});

test("agents command submits typed dashboard tasks through the team runner", async () => {
	const fakeRuntime = fakeAgentRuntimeFactory({ autoCompletePrompts: true });
	const { commands, ctx, agentViewStorePath } = setup({
		agentRuntimeFactory: fakeRuntime.factory,
	});
	let component: MockCustomComponent | undefined;
	ctx.ui.custom = (factory) => {
		component = factory({ requestRender() {} }, {}, undefined, () => {});
	};

	await commands
		.get("team-create")!
		.handler("Dashboard Team -- review=reviewer", ctx);
	await commands.get("agents")!.handler("", ctx);
	for (const char of "audit auth") component?.handleInput?.(char);
	component?.handleInput?.("enter");
	await flushAgentCommands();

	assert.match(fakeRuntime.sessions[0]?.promptCalls[0] ?? "", /audit auth/);
	const [task] = readAgentViewState(agentViewStorePath).teams[0]?.tasks ?? [];
	assert.equal(task?.status, "completed");
});

test("agents command falls back to a markdown message without custom UI", async () => {
	const { commands, ctx, messages } = setup();

	await commands
		.get("team-create")!
		.handler("Dashboard Team -- review=reviewer", ctx);
	await commands.get("agents")!.handler("", ctx);

	assert.match(JSON.stringify(messages.at(-1)), /Dashboard Team/);
	assert.match(
		JSON.stringify(messages.at(-1)),
		/\/team-run dashboard-team -- <task>/,
	);
});

test("team-stop cancels a running team task", async () => {
	const fakeRuntime = fakeAgentRuntimeFactory();
	const { commands, ctx, agentViewStorePath, notifications } = setup({
		agentRuntimeFactory: fakeRuntime.factory,
	});

	await commands
		.get("team-create")!
		.handler("Cancel Team -- review=reviewer", ctx);
	const running = commands
		.get("team-run")!
		.handler("cancel-team -- long review", ctx);
	await flushAgentCommands();
	const taskId = readAgentViewState(agentViewStorePath).teams[0]?.tasks[0]?.id;
	assert.ok(taskId);
	await commands.get("team-stop")!.handler(`cancel-team/${taskId}`, ctx);
	await running;
	await commands.get("team-stop")!.handler(`cancel-team/${taskId}`, ctx);

	const task = readAgentViewState(agentViewStorePath).teams[0]?.tasks[0];
	assert.equal(fakeRuntime.sessions[0]?.abortCalls, 1);
	assert.equal(task?.status, "cancelled");
	assert.deepEqual(notifications.at(-1), {
		message: `Cancelled team task '${taskId}'.`,
		type: "info",
	});
});

function demoWorkflow(): WorkflowSpec {
	return {
		name: "demo",
		description: "Demo workflow",
		source: "package",
		filePath: "/workflows/demo.workflow.json",
		chain: [{ agent: "delegate", task: "Do {task}" }],
	};
}

function demoParams(): PlannedWorkflowParams {
	const workflow = demoWorkflow();
	return {
		chain: workflow.chain,
		task: "test topic",
		context: "fresh",
		async: false,
		clarify: false,
		agentScope: "both",
	};
}

function makeRunningRun(runDir: string) {
	const run = createWorkflowRun(runDir, demoWorkflow(), demoParams());
	return startWorkflowRun(runDir, run.id);
}

function readRuns(runDir: string): Array<{ status?: string }> {
	return fs.readdirSync(runDir).map(
		(file) =>
			JSON.parse(fs.readFileSync(path.join(runDir, file), "utf-8")) as {
				status?: string;
			},
	);
}
