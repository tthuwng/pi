import test from "node:test";
import assert from "node:assert/strict";

import { loadTs } from "../support/load-ts.mjs";

const { buildSubagentResultIntercomPayload } = await loadTs("../../src/intercom/result-intercom.ts");
const {
	normalizeSingleOutputOverride,
	resolveSingleOutputPath,
} = await loadTs("../../src/runs/shared/single-output.ts");

test("builds compact subagent result intercom messages", () => {
	const longSummary = `${"line one ".repeat(40)}\n${"line two ".repeat(40)}`;
	const payload = buildSubagentResultIntercomPayload({
		to: "parent",
		runId: "run-123",
		mode: "parallel",
		source: "async",
		asyncId: "run-123",
		asyncDir: "/tmp/run-123",
		children: Array.from({ length: 6 }, (_, index) => ({
			agent: `agent-${index}`,
			status: "completed",
			summary: longSummary,
			index,
			artifactPath: `/tmp/run-123/output-${index}.log`,
			sessionPath: `/tmp/run-123/session-${index}.jsonl`,
			intercomTarget: `subagent-${index}`,
		})),
	});

	assert.match(payload.message, /Children: 6 completed/);
	assert.match(payload.message, /1\. agent-0 — completed/);
	assert.match(payload.message, /5\. agent-4 — completed/);
	assert.match(payload.message, /… 1 more children/);
	assert.doesNotMatch(payload.message, /6\. agent-5 — completed/);
	assert.doesNotMatch(
		payload.message,
		/Previous intercom targets below identify/,
	);
	assert.doesNotMatch(payload.message, /line two/);
	assert.ok(payload.message.length < 2500);
});

test("normalizes false string output overrides without resolving a file path", () => {
	assert.equal(
		normalizeSingleOutputOverride("false", "agent-output.md"),
		false,
	);
	assert.equal(
		resolveSingleOutputPath(
			normalizeSingleOutputOverride("false", "agent-output.md"),
			"/repo",
		),
		undefined,
	);
	assert.equal(
		resolveSingleOutputPath(
			normalizeSingleOutputOverride(true, "agent-output.md"),
			"/repo",
		),
		"/repo/agent-output.md",
	);
});
