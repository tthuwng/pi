import test from "node:test";
import assert from "node:assert/strict";

import {
	formatChainStepLabel,
	formatParallelAgentLabel,
} from "../../src/shared/agent-labels.ts";

test("formatParallelAgentLabel compacts repeated agent names", () => {
	assert.equal(
		formatParallelAgentLabel(["delegate", "delegate", "delegate"]),
		"3× delegate",
	);
});

test("formatParallelAgentLabel keeps small mixed groups readable", () => {
	assert.equal(
		formatParallelAgentLabel(["scout", "reviewer"]),
		"scout + reviewer",
	);
});

test("formatParallelAgentLabel summarizes large mixed groups", () => {
	assert.equal(
		formatParallelAgentLabel(["scout", "reviewer", "worker", "planner"]),
		"4 agents (scout, reviewer, worker, …)",
	);
});

test("formatChainStepLabel uses compact labels for parallel steps", () => {
	assert.equal(
		formatChainStepLabel({
			parallel: [
				{ agent: "delegate", task: "one" },
				{ agent: "delegate", task: "two" },
			],
		}),
		"2× delegate",
	);
});
