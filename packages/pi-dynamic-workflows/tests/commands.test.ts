import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import dynamicWorkflows, {
	attachWorkflowRequest,
	createWorkflowRun,
	startWorkflowRun,
} from "../src/index.js";
import { readAgentViewState } from "../src/agent-view-store.js";
import type { PlannedWorkflowParams, WorkflowSpec } from "../src/types.js";

interface RegisteredCommand {
	description: string;
	handler: (args: string, ctx: MockContext) => Promise<void> | void;
	getArgumentCompletions?: (
		prefix: string,
	) => Array<{ value: string; label: string }> | null;
}

interface MockContext {
	cwd: string;
	hasUI: boolean;
	ui: {
		notify(message: string, type?: string): void;
		setStatus(key: string, value: string | undefined): void;
	};
}

function tempDir(): string {
	return fs.mkdtempSync(
		path.join(os.tmpdir(), "pi-dynamic-workflows-command-"),
	);
}

function setup() {
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

	const commands = new Map<string, RegisteredCommand>();
	const messages: unknown[] = [];
	const events = new Map<string, Array<(payload: unknown) => void>>();
	const notifications: Array<{ message: string; type?: string }> = [];
	const inputHandlers: Array<
		(event: { text: string; source?: string }, ctx: MockContext) => unknown
	> = [];

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
			if (event === "input") inputHandlers.push(handler as never);
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
	};
}

test("registers workflow commands and lists workflows", async () => {
	const { commands, messages, ctx } = setup();

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

	await commands.get("workflows")!.handler("", ctx);
	assert.match(JSON.stringify(messages.at(-1)), /demo/);
});

test("input event auto-routes explicit workflow prompts", async () => {
	const { inputHandlers, events, ctx, runDir } = setup();
	let request:
		| {
				requestId?: string;
				params?: { task?: string };
		  }
		| undefined;
	events.on("subagent:slash:request", (payload) => {
		request = payload as typeof request;
		events.emit("subagent:slash:started", { requestId: request?.requestId });
		events.emit("subagent:slash:response", {
			requestId: request?.requestId,
			isError: false,
			result: { content: [{ type: "text", text: "auto done" }] },
		});
	});

	const result = await inputHandlers[0]?.(
		{ text: "ultracode: demo about cats", source: "interactive" },
		ctx,
	);

	assert.deepEqual(result, { action: "handled" });
	assert.equal(request?.params?.task, "cats");
	const [runFile] = fs.readdirSync(runDir);
	const run = JSON.parse(
		fs.readFileSync(path.join(runDir, runFile!), "utf-8"),
	) as { workflowName?: string; status?: string; resultText?: string };
	assert.equal(run.workflowName, "demo");
	assert.equal(run.status, "completed");
	assert.equal(run.resultText, "auto done");
});

test("input event auto-routes substantive audit prompts", async () => {
	const { inputHandlers, events, ctx, runDir } = setup();
	let request:
		| {
				requestId?: string;
				params?: { task?: string };
		  }
		| undefined;
	events.on("subagent:slash:request", (payload) => {
		request = payload as typeof request;
		events.emit("subagent:slash:started", { requestId: request?.requestId });
		events.emit("subagent:slash:response", {
			requestId: request?.requestId,
			isError: false,
			result: { content: [{ type: "text", text: "audit done" }] },
		});
	});

	const result = await inputHandlers[0]?.(
		{ text: "audit every API endpoint for auth", source: "interactive" },
		ctx,
	);

	assert.deepEqual(result, { action: "handled" });
	assert.equal(request?.params?.task, "audit every API endpoint for auth");
	const [runFile] = fs.readdirSync(runDir);
	const run = JSON.parse(
		fs.readFileSync(path.join(runDir, runFile!), "utf-8"),
	) as { workflowName?: string; status?: string; resultText?: string };
	assert.equal(run.workflowName, "quality-gate");
	assert.equal(run.status, "completed");
	assert.equal(run.resultText, "audit done");
});

test("input event leaves routine prompts alone", async () => {
	const { inputHandlers, ctx } = setup();

	const result = await inputHandlers[0]?.(
		{ text: "fix the failing test", source: "interactive" },
		ctx,
	);

	assert.deepEqual(result, { action: "continue" });
});

test("workflow command dispatches planned params through the subagents bridge", async () => {
	const { commands, events, ctx, runDir } = setup();
	let request:
		| {
				requestId?: string;
				params?: { chain?: unknown[]; task?: string; async?: boolean };
		  }
		| undefined;

	events.on("subagent:slash:request", (payload) => {
		request = payload as typeof request;
		events.emit("subagent:slash:started", { requestId: request?.requestId });
		events.emit("subagent:slash:update", {
			requestId: request?.requestId,
			toolCount: 3,
			currentTool: "read",
		});
		events.emit("subagent:slash:response", {
			requestId: request?.requestId,
			isError: false,
			result: {
				content: [{ type: "text", text: "done" }],
				details: { mode: "chain", results: [] },
			},
		});
	});

	await commands.get("workflow")!.handler("demo -- test topic", ctx);

	assert.equal(request?.params?.task, "test topic");
	assert.deepEqual(request?.params?.chain, [
		{ agent: "delegate", task: "Do test topic" },
	]);
	const runs = fs.readdirSync(runDir);
	assert.equal(runs.length, 1);
	const run = JSON.parse(
		fs.readFileSync(path.join(runDir, runs[0]!), "utf-8"),
	) as {
		status?: string;
		workflowName?: string;
		resultText?: string;
		requestId?: string;
		updates?: Array<{
			at?: string;
			type?: string;
			toolCount?: number;
			currentTool?: string;
		}>;
	};
	assert.equal(run.status, "completed");
	assert.equal(run.workflowName, "demo");
	assert.equal(run.resultText, "done");
	assert.equal(run.requestId, request?.requestId);
	assert.deepEqual(run.updates?.at(-1), {
		at: run.updates?.at(-1)?.at,
		type: "tool",
		toolCount: 3,
		currentTool: "read",
	});
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
	const { commands, events, ctx, agentViewStorePath } = setup();
	let request:
		| {
				requestId?: string;
				params?: { tasks?: Array<{ agent?: string; task?: string }> };
		  }
		| undefined;
	events.on("subagent:slash:request", (payload) => {
		request = payload as typeof request;
		events.emit("subagent:slash:started", { requestId: request?.requestId });
		events.emit("subagent:slash:response", {
			requestId: request?.requestId,
			isError: false,
			result: { content: [{ type: "text", text: "team result" }] },
		});
	});

	await commands.get("team-create")!.handler("Auth Team -- review=reviewer", ctx);
	await commands.get("team-run")!.handler("auth-team -- audit auth", ctx);

	assert.equal(request?.params?.tasks?.[0]?.agent, "reviewer");
	assert.match(request?.params?.tasks?.[0]?.task ?? "", /audit auth/);
	const [task] = readAgentViewState(agentViewStorePath).teams[0]?.tasks ?? [];
	assert.equal(task?.status, "completed");
	assert.equal(task?.resultText, "team result");
});

test("team-status and team-send render team state", async () => {
	const { commands, ctx, messages } = setup();

	await commands.get("team-create")!.handler("Research Team -- docs=scout", ctx);
	await commands
		.get("team-send")!
		.handler("research-team/docs -- Check primary docs first.", ctx);
	await commands.get("team-status")!.handler("research-team", ctx);

	assert.match(JSON.stringify(messages.at(-1)), /Research Team/);
	assert.match(JSON.stringify(messages.at(-1)), /Check primary docs first/);
});

test("team-stop cancels a running team task", async () => {
	const { commands, events, ctx, agentViewStorePath } = setup();
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

	await commands.get("team-create")!.handler("Cancel Team -- review=reviewer", ctx);
	const running = commands.get("team-run")!.handler("cancel-team -- long review", ctx);
	await new Promise((resolve) => setImmediate(resolve));
	const taskId = readAgentViewState(agentViewStorePath).teams[0]?.tasks[0]?.id;
	assert.ok(taskId);
	await commands.get("team-stop")!.handler(`cancel-team/${taskId}`, ctx);
	await running;

	const task = readAgentViewState(agentViewStorePath).teams[0]?.tasks[0];
	assert.deepEqual(cancelled, { requestId: task?.requestId });
	assert.equal(task?.status, "cancelled");
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
	return fs
		.readdirSync(runDir)
		.map(
			(file) =>
				JSON.parse(fs.readFileSync(path.join(runDir, file), "utf-8")) as {
					status?: string;
				},
		);
}
