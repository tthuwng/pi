import type { StartAgentSessionInput } from "./agent-session-manager.js";
import type { AgentSessionRecord } from "./agent-view-store.js";
import {
	appendWorkflowRunUpdate,
	attachWorkflowSession,
} from "./run-registry.js";
import type {
	PlannedWorkflowParams,
	WorkflowChainStep,
	WorkflowParallelStep,
	WorkflowTask,
} from "./types.js";

export interface WorkflowSessionRunner {
	startAgentSession(input: StartAgentSessionInput): Promise<AgentSessionRecord>;
	waitForAgentSession(sessionId: string): Promise<AgentSessionRecord>;
	stopAgentSession(sessionId: string, reason?: string): Promise<void>;
}

export interface ExecuteWorkflowWithSessionsOptions {
	runDir: string;
	runId: string;
	workflowName: string;
	params: PlannedWorkflowParams;
	runner: WorkflowSessionRunner;
	cwd: string;
}

export interface ExecuteWorkflowWithSessionsResult {
	resultText: string;
	sessionIds: string[];
}

export class WorkflowSessionCancelledError extends Error {
	constructor(message = "Workflow session cancelled.") {
		super(message);
		this.name = "WorkflowSessionCancelledError";
	}
}

export async function executeWorkflowWithSessions(
	options: ExecuteWorkflowWithSessionsOptions,
): Promise<ExecuteWorkflowWithSessionsResult> {
	let previous = "";
	const sessionIds: string[] = [];
	for (const step of options.params.chain) {
		previous = await executeStep(options, step, previous, sessionIds);
	}
	return { resultText: previous, sessionIds };
}

async function executeStep(
	options: ExecuteWorkflowWithSessionsOptions,
	step: WorkflowChainStep,
	previous: string,
	sessionIds: string[],
): Promise<string> {
	if ("expand" in step) {
		throw new Error(
			"Dynamic fanout is not supported by native workflow sessions. Use the compatibility bridge for this workflow shape.",
		);
	}
	if ("parallel" in step) {
		return executeParallelStep(options, step, previous, sessionIds);
	}
	return executeTask(options, step, previous, sessionIds);
}

async function executeParallelStep(
	options: ExecuteWorkflowWithSessionsOptions,
	step: WorkflowParallelStep,
	previous: string,
	sessionIds: string[],
): Promise<string> {
	const results = await mapLimit(
		step.parallel,
		step.concurrency ?? options.params.concurrency ?? step.parallel.length,
		(task) => executeTask(options, task, previous, sessionIds),
	);
	return results.join("\n\n");
}

async function executeTask(
	options: ExecuteWorkflowWithSessionsOptions,
	task: WorkflowTask,
	previous: string,
	sessionIds: string[],
): Promise<string> {
	const prompt = renderTaskPrompt(task.task ?? options.params.task, {
		task: options.params.task,
		previous,
	});
	const title =
		task.label ?? task.phase ?? `${options.workflowName}: ${task.agent}`;
	const session = await options.runner.startAgentSession({
		title,
		prompt,
		cwd: task.cwd ?? options.cwd,
		agentName: task.agent,
		completeOnPromptEnd: true,
	});
	sessionIds.push(session.id);
	attachWorkflowSession(options.runDir, options.runId, session.id);
	appendWorkflowRunUpdate(options.runDir, options.runId, {
		type: "message",
		text: `Started native workflow session ${session.id} (${task.agent}).`,
		details: { sessionId: session.id, agent: task.agent },
	});
	const result = await options.runner.waitForAgentSession(session.id);
	if (result.status === "failed") {
		throw new Error(
			result.errorText ?? result.resultText ?? "Workflow session failed.",
		);
	}
	if (result.status === "cancelled" || result.status === "detached") {
		throw new WorkflowSessionCancelledError(
			result.errorText ?? result.resultText ?? "Workflow session cancelled.",
		);
	}
	const text = result.resultText ?? result.errorText ?? "";
	appendWorkflowRunUpdate(options.runDir, options.runId, {
		type: "message",
		text: `Completed native workflow session ${session.id}.`,
		details: { sessionId: session.id, agent: task.agent },
	});
	return text;
}

function renderTaskPrompt(
	template: string,
	values: { task: string; previous: string },
): string {
	return template
		.replace(/\{task\}/g, values.task)
		.replace(/\{previous\}/g, values.previous);
}

async function mapLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (items.length === 0) return [];
	const concurrency = Math.max(1, Math.min(limit, items.length));
	const results: R[] = new Array<R>(items.length);
	let nextIndex = 0;
	async function worker(): Promise<void> {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			const item = items[index];
			if (item === undefined) continue;
			results[index] = await fn(item, index);
		}
	}
	await Promise.all(
		Array.from({ length: concurrency }, async () => {
			await worker();
		}),
	);
	return results;
}
