import assert from "node:assert/strict";
import test from "node:test";

import {
	renderWorkflowProgress,
	WorkflowRunsComponent,
} from "../src/workflows-tui.js";
import type { WorkflowRunRecord } from "../src/run-registry.js";
import type { WorkflowSpec } from "../src/types.js";

const workflows: WorkflowSpec[] = [
	{
		name: "quality-gate",
		description: "Review a target.",
		source: "package",
		filePath: "/workflows/quality-gate.workflow.json",
		chain: [{ agent: "reviewer", task: "Review" }],
	},
];

const runs: WorkflowRunRecord[] = [
	{
		id: "11111111-1111-4111-8111-111111111111",
		workflowName: "quality-gate",
		workflowDescription: "Review a target.",
		args: "current diff",
		status: "running",
		context: "fresh",
		async: true,
		phases: ["Review", "Synthesis"],
		chainLength: 2,
		createdAt: "2026-06-18T00:00:00.000Z",
		updatedAt: "2026-06-18T00:00:01.000Z",
		requestId: "request-1",
		updates: [
			{
				at: "2026-06-18T00:00:01.000Z",
				type: "tool",
				toolCount: 4,
				currentTool: "read",
			},
		],
	},
];

test("renderWorkflowProgress shows workflows, runs, phases, updates, and controls", () => {
	const output = renderWorkflowProgress(workflows, runs);

	assert.match(output, /## Dynamic workflows/);
	assert.match(output, /`quality-gate`/);
	assert.match(output, /## Workflow runs/);
	assert.match(output, /running/);
	assert.match(output, /Review → Synthesis/);
	assert.match(output, /4 tools read/);
	assert.match(
		output,
		/\/workflow-cancel 11111111-1111-4111-8111-111111111111/,
	);
	assert.match(
		output,
		/\/workflow-save 11111111-1111-4111-8111-111111111111 --/,
	);
});

test("WorkflowRunsComponent renders bounded lines", () => {
	const component = new WorkflowRunsComponent(workflows, runs);
	const lines = component.render(48);

	assert.ok(lines.length > 3);
	assert.ok(lines.every((line) => line.length <= 48));
	assert.match(lines.join("\n"), /Dynamic workflows/);
});
