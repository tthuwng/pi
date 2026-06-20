import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import type { StartAgentSessionInput } from "../src/agent-session-manager.js";
import type { AgentSessionRecord } from "../src/agent-view-store.js";
import {
	createWorkflowRun,
	listWorkflowRuns,
	startWorkflowRun,
} from "../src/run-registry.js";
import type { PlannedWorkflowParams, WorkflowSpec } from "../src/types.js";
import {
	executeWorkflowWithSessions,
	type WorkflowSessionRunner,
} from "../src/workflow-session-executor.js";

interface StartedSession {
	input: StartAgentSessionInput;
	record: AgentSessionRecord;
}

type RunnerResult =
	| string
	| { status: "completed"; resultText: string }
	| { status: "failed"; errorText: string };

function tempRunDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "workflow-session-runs-"));
}

function workflow(chain: PlannedWorkflowParams["chain"]): WorkflowSpec {
	return {
		name: "demo",
		description: "Demo workflow",
		source: "package",
		filePath: "/workflows/demo.workflow.json",
		chain,
	};
}

function params(chain: PlannedWorkflowParams["chain"]): PlannedWorkflowParams {
	return {
		chain,
		task: "original task",
		context: "fresh",
		async: false,
		clarify: false,
		agentScope: "both",
	};
}

function startRun(
	runDir: string,
	spec: WorkflowSpec,
	planned: PlannedWorkflowParams,
) {
	const run = createWorkflowRun(runDir, spec, planned);
	return startWorkflowRun(runDir, run.id);
}

function createRunner(
	resultFor: (input: StartAgentSessionInput, index: number) => RunnerResult = (
		input,
		index,
	) => `result ${index + 1}: ${input.prompt}`,
): WorkflowSessionRunner & { started: StartedSession[]; stopped: string[] } {
	const started: StartedSession[] = [];
	const stopped: string[] = [];
	const completions = new Map<string, AgentSessionRecord>();
	return {
		started,
		stopped,
		async startAgentSession(input: StartAgentSessionInput) {
			const now = new Date().toISOString();
			const id = `session-${started.length + 1}`;
			const record: AgentSessionRecord = {
				id,
				title: input.title,
				cwd: input.cwd,
				status: "running",
				createdAt: now,
				updatedAt: now,
				agentName: input.agentName,
				prompt: input.prompt,
			};
			started.push({ input, record });
			const result = resultFor(input, started.length - 1);
			completions.set(id, normalizeResult(record, result));
			return record;
		},
		async waitForAgentSession(sessionId: string) {
			const completion = completions.get(sessionId);
			if (!completion) throw new Error(`unknown session ${sessionId}`);
			return completion;
		},
		async stopAgentSession(sessionId: string) {
			stopped.push(sessionId);
		},
	};
}

function normalizeResult(
	record: AgentSessionRecord,
	result: RunnerResult,
): AgentSessionRecord {
	if (typeof result === "string") {
		return { ...record, status: "completed", resultText: result };
	}
	return { ...record, ...result };
}

test("native workflow executor runs sequential steps with previous output", async () => {
	const chain: PlannedWorkflowParams["chain"] = [
		{ agent: "researcher", task: "research {task}" },
		{ agent: "reviewer", task: "review {previous}" },
	];
	const runDir = tempRunDir();
	const spec = workflow(chain);
	const planned = params(chain);
	const run = startRun(runDir, spec, planned);
	const runner = createRunner();

	const result = await executeWorkflowWithSessions({
		runDir,
		runId: run.id,
		workflowName: spec.name,
		params: planned,
		runner,
		cwd: "/tmp/repo",
	});

	assert.deepEqual(
		runner.started.map((session) => session.input.prompt),
		["research original task", "review result 1: research original task"],
	);
	assert.equal(
		result.resultText,
		"result 2: review result 1: research original task",
	);
	const [record] = listWorkflowRuns(runDir);
	assert.deepEqual(record?.sessionIds, ["session-1", "session-2"]);
	assert.match(record?.updates?.at(-1)?.text ?? "", /session-2/);
});

test("native workflow executor runs static parallel groups and reducers", async () => {
	const chain: PlannedWorkflowParams["chain"] = [
		{
			parallel: [
				{ agent: "researcher", task: "A {task}" },
				{ agent: "reviewer", task: "B {task}" },
			],
			concurrency: 2,
		},
		{ agent: "delegate", task: "reduce {previous}" },
	];
	const runDir = tempRunDir();
	const spec = workflow(chain);
	const planned = params(chain);
	const run = startRun(runDir, spec, planned);
	const runner = createRunner();

	const result = await executeWorkflowWithSessions({
		runDir,
		runId: run.id,
		workflowName: spec.name,
		params: planned,
		runner,
		cwd: "/tmp/repo",
	});

	assert.deepEqual(
		runner.started.slice(0, 2).map((session) => session.input.prompt),
		["A original task", "B original task"],
	);
	assert.match(
		runner.started[2]?.input.prompt ?? "",
		/result 1: A original task/,
	);
	assert.match(
		runner.started[2]?.input.prompt ?? "",
		/result 2: B original task/,
	);
	assert.match(result.resultText, /reduce/);
});

test("native workflow executor fails when a child session fails", async () => {
	const chain: PlannedWorkflowParams["chain"] = [
		{ agent: "researcher", task: "research {task}" },
	];
	const runDir = tempRunDir();
	const spec = workflow(chain);
	const planned = params(chain);
	const run = startRun(runDir, spec, planned);
	const runner = createRunner(() => ({
		status: "failed",
		errorText: "child failed",
	}));

	await assert.rejects(
		() =>
			executeWorkflowWithSessions({
				runDir,
				runId: run.id,
				workflowName: spec.name,
				params: planned,
				runner,
				cwd: "/tmp/repo",
			}),
		/child failed/,
	);
});

test("native workflow executor rejects dynamic fanout with a clear boundary", async () => {
	const chain: PlannedWorkflowParams["chain"] = [
		{
			expand: { from: { output: "items", path: "/items" }, maxItems: 3 },
			parallel: { agent: "delegate", task: "item {item}" },
			collect: { as: "results" },
		},
	];
	const runDir = tempRunDir();
	const spec = workflow(chain);
	const planned = params(chain);
	const run = startRun(runDir, spec, planned);
	const runner = createRunner();

	await assert.rejects(
		() =>
			executeWorkflowWithSessions({
				runDir,
				runId: run.id,
				workflowName: spec.name,
				params: planned,
				runner,
				cwd: "/tmp/repo",
			}),
		/Dynamic fanout is not supported by native workflow sessions/,
	);
});
