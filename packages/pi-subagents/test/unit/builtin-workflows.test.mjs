import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SubagentParams } from "../../src/extension/schemas.ts";
import { applyForceTopLevelAsyncOverrideForExecution } from "../../src/runs/background/top-level-async.ts";
import {
	BUILTIN_WORKFLOW_IDS,
	expandBuiltinWorkflowParams,
} from "../../src/runs/shared/workflows.ts";

test("lists the initial builtin workflow ids", () => {
	assert.deepEqual(
		[...BUILTIN_WORKFLOW_IDS],
		["quality-gate", "research-decision", "generate-filter"],
	);
});

test("no-workflow params pass through without expanded workflow semantics", () => {
	const params = { agent: "reviewer", task: "review this" };
	const result = expandBuiltinWorkflowParams(params);

	assert.equal(result.error, undefined);
	assert.equal(result.expanded, false);
	assert.equal(result.params, params);
});

test("quality-gate workflow expands to foreground fresh reviewer fanout", () => {
	const result = expandBuiltinWorkflowParams({
		workflow: "builtin.quality-gate",
		task: "verify proposal before implementing",
	});

	assert.equal(result.error, undefined);
	assert.equal(result.expanded, true);
	assert.equal(result.params?.context, "fresh");
	assert.equal(result.params?.async, false);
	assert.equal(result.params?.concurrency, 3);
	assert.deepEqual(
		result.params?.tasks.map((task) => task.agent),
		["reviewer", "reviewer", "reviewer"],
	);
	assert.deepEqual(
		result.params?.tasks.map((task) => task.output),
		[false, false, false],
	);
	assert.deepEqual(
		result.params?.tasks.map((task) => task.progress),
		[false, false, false],
	);
	assert.match(result.params?.tasks[0]?.task ?? "", /Quality gate/);
	assert.doesNotMatch(
		result.params?.tasks[0]?.task ?? "",
		/Proposal-level quality gate/,
	);
	assert.match(
		result.params?.tasks[0]?.task ?? "",
		/verify proposal before implementing/,
	);
});

test("research-decision workflow expands to researcher scout reviewer fanout", () => {
	const result = expandBuiltinWorkflowParams({
		workflow: "builtin.research-decision",
		task: "decide whether runtime workflow selector is necessary",
		cwd: "/repo",
	});

	assert.equal(result.error, undefined);
	assert.equal(result.params?.cwd, "/repo");
	assert.equal(result.params?.context, "fresh");
	assert.equal(result.params?.async, false);
	assert.deepEqual(
		result.params?.tasks.map((task) => task.agent),
		["researcher", "scout", "reviewer"],
	);
	assert.match(result.params?.tasks[2]?.task ?? "", /adversarially critique/);
});

test("generate-filter workflow expands to foreground fan-out/fan-in chain", () => {
	const result = expandBuiltinWorkflowParams({
		workflow: "builtin.generate-filter",
		task: "test messy natural-language routing",
	});

	assert.equal(result.error, undefined);
	assert.equal(result.params?.context, "fresh");
	assert.equal(result.params?.async, false);
	assert.equal(result.params?.concurrency, undefined);
	assert.equal(result.params?.tasks, undefined);
	assert.equal(result.params?.chain?.length, 2);
	assert.deepEqual(
		result.params?.chain?.[0]?.parallel?.map((task) => task.agent),
		["delegate", "delegate", "delegate"],
	);
	assert.equal(result.params?.chain?.[1]?.agent, "reviewer");
	assert.match(result.params?.chain?.[1]?.task ?? "", /dedupe/i);
});

test("workflow rejects explicit execution, management, and ignored top-level execution fields", () => {
	const cases = [
		{ agent: "reviewer" },
		{ tasks: [] },
		{ chain: [] },
		{ action: "status" },
		{ config: {} },
		{ chainName: "review-pipeline" },
		{ model: "openai/test" },
		{ skill: "review" },
		{ output: "review.md" },
		{ outputMode: "file-only" },
	];

	for (const conflict of cases) {
		const result = expandBuiltinWorkflowParams({
			workflow: "builtin.quality-gate",
			task: "target",
			...conflict,
		});
		assert.match(result.error ?? "", /mutually exclusive/);
	}
});

test("workflow requires builtin prefix", () => {
	const result = expandBuiltinWorkflowParams({
		workflow: "quality-gate",
		task: "target",
	});

	assert.match(result.error ?? "", /Unknown workflow: quality-gate/);
	assert.match(result.error ?? "", /builtin.quality-gate/);
});

test("workflow schema exposes only documented builtin ids", () => {
	assert.deepEqual(SubagentParams.properties.workflow.enum, [
		"builtin.quality-gate",
		"builtin.research-decision",
		"builtin.generate-filter",
	]);
});

test("expanded workflows bypass forced top-level async override", () => {
	const workflowExpansion = expandBuiltinWorkflowParams({
		workflow: "builtin.quality-gate",
		task: "verify this claim",
	});
	assert.equal(workflowExpansion.error, undefined);
	assert.equal(workflowExpansion.expanded, true);
	assert.equal(workflowExpansion.params?.async, false);

	assert.equal(
		applyForceTopLevelAsyncOverrideForExecution(
			workflowExpansion.params ?? {},
			0,
			true,
			workflowExpansion,
		),
		workflowExpansion.params,
	);

	const plainExpansion = expandBuiltinWorkflowParams({
		agent: "reviewer",
		task: "review this",
		async: false,
		clarify: true,
	});
	assert.deepEqual(
		applyForceTopLevelAsyncOverrideForExecution(
			plainExpansion.params ?? {},
			0,
			true,
			plainExpansion,
		),
		{ agent: "reviewer", task: "review this", async: true, clarify: false },
	);
});

test("workflow requires task and rejects async or fork context", () => {
	assert.match(
		expandBuiltinWorkflowParams({ workflow: "builtin.quality-gate" }).error ??
			"",
		/requires a non-empty task/,
	);
	assert.match(
		expandBuiltinWorkflowParams({
			workflow: "builtin.quality-gate",
			task: "target",
			async: true,
		}).error ?? "",
		/foreground by default/,
	);
	assert.match(
		expandBuiltinWorkflowParams({
			workflow: "builtin.quality-gate",
			task: "target",
			context: "fork",
		}).error ?? "",
		/require context:'fresh'/,
	);
});

test("unknown workflow errors with builtin names", () => {
	const result = expandBuiltinWorkflowParams({
		workflow: "tournament",
		task: "target",
	});

	assert.match(result.error ?? "", /Unknown workflow: tournament/);
	assert.match(result.error ?? "", /builtin.quality-gate/);
	assert.match(result.error ?? "", /builtin.research-decision/);
});

test("proposal verification live-eval corpus stays runnable", () => {
	const cases = JSON.parse(
		readFileSync(
			new URL(
				"../nl-routing/proposal-verification-cases.json",
				import.meta.url,
			),
			"utf8",
		),
	);

	assert.equal(Array.isArray(cases), true);
	assert.equal(cases.length, 8);
	for (const testCase of cases) {
		assert.equal(typeof testCase.name, "string");
		assert.match(testCase.name, /^\d{2}-/);
		assert.equal(typeof testCase.prompt, "string");
		assert.match(testCase.prompt, /Do not edit files/);
		assert.equal(testCase.thinking, "low");
	}
});
