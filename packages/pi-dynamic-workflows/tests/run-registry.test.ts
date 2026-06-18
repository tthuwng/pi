import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import {
	appendWorkflowRunUpdate,
	attachWorkflowRequest,
	cancelWorkflowRun,
	createWorkflowRun,
	finishWorkflowRun,
	listWorkflowRuns,
	startWorkflowRun,
} from "../src/index.js";
import type { PlannedWorkflowParams, WorkflowSpec } from "../src/types.js";

function tempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pi-dynamic-workflows-runs-"));
}

const workflow: WorkflowSpec = {
	name: "quality-gate",
	description: "Review a target.",
	source: "package",
	filePath: "/workflows/quality-gate.workflow.json",
	chain: [
		{ phase: "Review", agent: "reviewer", task: "Review {task}" },
		{ phase: "Synthesis", agent: "reviewer", task: "Synthesize" },
	],
};

const params: PlannedWorkflowParams = {
	chain: workflow.chain,
	task: "current diff",
	context: "fresh",
	async: false,
	clarify: false,
	agentScope: "both",
};

test("run registry persists planned, running, and completed workflow runs", () => {
	const runDir = tempDir();
	const run = createWorkflowRun(runDir, workflow, params);

	assert.equal(run.workflowName, "quality-gate");
	assert.equal(run.status, "planned");
	assert.deepEqual(run.phases, ["Review", "Synthesis"]);

	startWorkflowRun(runDir, run.id);
	finishWorkflowRun(runDir, run.id, {
		status: "completed",
		resultText: "PASS",
	});

	const runs = listWorkflowRuns(runDir);
	assert.equal(runs.length, 1);
	assert.equal(runs[0]?.id, run.id);
	assert.equal(runs[0]?.status, "completed");
	assert.equal(runs[0]?.resultText, "PASS");
});

test("run registry tracks request ids and bounded live updates", () => {
	const runDir = tempDir();
	const run = startWorkflowRun(
		runDir,
		createWorkflowRun(runDir, workflow, params).id,
	);

	attachWorkflowRequest(runDir, run.id, "request-1");
	for (let index = 0; index < 55; index += 1) {
		appendWorkflowRunUpdate(runDir, run.id, {
			type: "tool",
			text: `tool ${index}`,
			toolCount: index,
		});
	}

	const [updated] = listWorkflowRuns(runDir);
	assert.equal(updated?.requestId, "request-1");
	assert.equal(updated?.updates?.length, 50);
	assert.equal(updated?.updates?.[0]?.text, "tool 5");
	assert.equal(updated?.updates?.at(-1)?.text, "tool 54");
	assert.ok(updated?.updatedAt);
});

test("run registry can mark a running workflow as cancelled", () => {
	const runDir = tempDir();
	const run = startWorkflowRun(
		runDir,
		createWorkflowRun(runDir, workflow, params).id,
	);

	cancelWorkflowRun(runDir, run.id, "cancelled by user");

	const [cancelled] = listWorkflowRuns(runDir);
	assert.equal(cancelled?.status, "cancelled");
	assert.equal(cancelled?.errorText, "cancelled by user");
	assert.equal(cancelled?.updates?.at(-1)?.type, "cancelled");
});
