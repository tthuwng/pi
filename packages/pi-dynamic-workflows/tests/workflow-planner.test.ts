import assert from "node:assert/strict";
import test from "node:test";

import { planWorkflow } from "../src/workflow-planner.js";
import type { WorkflowSpec } from "../src/types.js";

const spec: WorkflowSpec = {
	name: "deep-research",
	description: "Research and cross-check.",
	source: "package",
	filePath: "/workflows/deep-research.workflow.json",
	context: "fresh",
	defaultAsync: true,
	chain: [
		{
			parallel: [
				{
					agent: "researcher",
					task: "Research official sources for {task}",
					output: false,
				},
				{
					agent: "researcher",
					task: "Research counterarguments for {args}",
					output: false,
				},
			],
			concurrency: 2,
		},
		{
			agent: "reviewer",
			task: "Cross-check findings for {workflow.name}: {previous}",
		},
	],
};

test("planWorkflow maps a spec to pi-subagents chain params", () => {
	const params = planWorkflow(spec, "Node permission model", { async: false });

	assert.equal(params.task, "Node permission model");
	assert.equal(params.context, "fresh");
	assert.equal(params.async, false);
	assert.equal(params.clarify, false);
	assert.equal(params.agentScope, "both");
	assert.deepEqual(params.chain?.[0], {
		parallel: [
			{
				agent: "researcher",
				task: "Research official sources for Node permission model",
				output: false,
			},
			{
				agent: "researcher",
				task: "Research counterarguments for Node permission model",
				output: false,
			},
		],
		concurrency: 2,
	});
	assert.deepEqual(params.chain?.[1], {
		agent: "reviewer",
		task: "Cross-check findings for deep-research: {previous}",
	});
});

test("planWorkflow uses workflow default async unless overridden", () => {
	assert.equal(planWorkflow(spec, "question").async, true);
	assert.equal(planWorkflow(spec, "question", { async: false }).async, false);
});

test("planWorkflow rejects empty args", () => {
	assert.throws(() => planWorkflow(spec, "   "), /requires arguments/i);
});
