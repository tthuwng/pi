import assert from "node:assert/strict";
import test from "node:test";

import { routeWorkflowPrompt } from "../src/auto-router.js";
import type { WorkflowSpec } from "../src/types.js";

const workflows = [
	workflow("deep-research", "Research and cross-check sources."),
	workflow("quality-gate", "Review a target from multiple angles."),
	workflow("research-decision", "Research options and synthesize a decision."),
	workflow("generate-filter", "Generate options and filter them."),
];

function workflow(name: string, description: string): WorkflowSpec {
	return {
		name,
		description,
		source: "package",
		filePath: `/workflows/${name}.workflow.json`,
		chain: [{ agent: "delegate", task: "Do {task}" }],
	};
}

test("routes explicit ultracode prompts to a matching workflow", () => {
	const route = routeWorkflowPrompt(
		"ultracode: deep research what changed in Node permissions",
		workflows,
	);

	assert.deepEqual(route, {
		action: "run",
		workflowName: "deep-research",
		args: "what changed in Node permissions",
		reason: "explicit ultracode trigger",
	});
});

test("routes natural-language workflow requests by workflow name", () => {
	const route = routeWorkflowPrompt(
		"use workflow quality-gate on the current diff",
		workflows,
	);

	assert.deepEqual(route, {
		action: "run",
		workflowName: "quality-gate",
		args: "current diff",
		reason: "explicit workflow request",
	});
});

test("routes direct bundled workflow phrases", () => {
	const route = routeWorkflowPrompt(
		"deep research What changed in the Node.js permission model?",
		workflows,
	);

	assert.deepEqual(route, {
		action: "run",
		workflowName: "deep-research",
		args: "What changed in the Node.js permission model?",
		reason: "explicit workflow request",
	});
});

test("strips optional command-style separator from workflow requests", () => {
	const route = routeWorkflowPrompt(
		"run workflow research-decision -- compare React and Vue",
		workflows,
	);

	assert.deepEqual(route, {
		action: "run",
		workflowName: "research-decision",
		args: "compare React and Vue",
		reason: "explicit workflow request",
	});
});

test("does not route routine prompts unless substantive heuristics are enabled", () => {
	assert.deepEqual(routeWorkflowPrompt("fix the failing test", workflows), {
		action: "none",
		reason: "no workflow trigger",
	});
	assert.deepEqual(
		routeWorkflowPrompt("audit every API endpoint for auth", workflows, {
			mode: "substantive",
		}),
		{
			action: "run",
			workflowName: "quality-gate",
			args: "audit every API endpoint for auth",
			reason: "substantive task heuristic",
		},
	);
});

test("respects off mode", () => {
	assert.deepEqual(
		routeWorkflowPrompt(
			"ultracode: deep research Node permissions",
			workflows,
			{
				mode: "off",
			},
		),
		{ action: "none", reason: "workflow auto-routing disabled" },
	);
});
