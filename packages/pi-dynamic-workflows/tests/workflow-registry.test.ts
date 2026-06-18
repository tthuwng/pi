import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import {
	discoverWorkflowSpecs,
	parseWorkflowSpec,
} from "../src/workflow-registry.js";

function tempDir(): string {
	return fs.mkdtempSync(
		path.join(os.tmpdir(), "pi-dynamic-workflows-registry-"),
	);
}

test("parseWorkflowSpec accepts a minimal declarative workflow", () => {
	const spec = parseWorkflowSpec(
		JSON.stringify({
			name: "quality-gate",
			description: "Review a target from multiple angles.",
			argumentHint: "<target>",
			chain: [{ agent: "reviewer", task: "Review {task}" }],
		}),
		"/tmp/quality-gate.workflow.json",
		"package",
	);

	assert.equal(spec.name, "quality-gate");
	assert.equal(spec.source, "package");
	assert.equal(spec.argumentHint, "<target>");
	assert.deepEqual(spec.chain, [{ agent: "reviewer", task: "Review {task}" }]);
});

test("parseWorkflowSpec rejects invalid names and empty chains", () => {
	assert.throws(
		() =>
			parseWorkflowSpec(
				JSON.stringify({ name: "Bad Name", description: "x", chain: [] }),
				"bad.workflow.json",
				"user",
			),
		/invalid workflow name/i,
	);
	assert.throws(
		() =>
			parseWorkflowSpec(
				JSON.stringify({ name: "empty", description: "x", chain: [] }),
				"empty.workflow.json",
				"user",
			),
		/non-empty chain/i,
	);
});

test("parseWorkflowSpec rejects unbounded or excessive dynamic fanout", () => {
	const base = {
		name: "fanout",
		description: "Generate and fan out.",
		chain: [
			{ agent: "planner", task: "Return targets", as: "targets" },
			{
				expand: { from: { output: "targets", path: "/items" } },
				parallel: { agent: "reviewer", task: "Review {item}" },
				collect: { as: "reviews" },
			},
		],
	};

	assert.throws(
		() =>
			parseWorkflowSpec(
				JSON.stringify(base),
				"fanout.workflow.json",
				"project",
			),
		/requires expand\.maxItems/i,
	);

	assert.throws(
		() =>
			parseWorkflowSpec(
				JSON.stringify({
					...base,
					chain: [
						base.chain[0],
						{
							expand: {
								from: { output: "targets", path: "/items" },
								maxItems: 1001,
							},
							parallel: { agent: "reviewer", task: "Review {item}" },
							collect: { as: "reviews" },
						},
					],
				}),
				"fanout.workflow.json",
				"project",
			),
		/must be <= 1000/i,
	);
});

test("parseWorkflowSpec rejects workflow concurrency above the cap", () => {
	assert.throws(
		() =>
			parseWorkflowSpec(
				JSON.stringify({
					name: "too-wide",
					description: "Too wide.",
					chain: [
						{
							parallel: [{ agent: "reviewer" }, { agent: "reviewer" }],
							concurrency: 17,
						},
					],
				}),
				"too-wide.workflow.json",
				"user",
			),
		/must be <= 16/i,
	);
});

test("discoverWorkflowSpecs merges package, user, and project with project precedence", () => {
	const root = tempDir();
	const packageDir = path.join(root, "package");
	const userDir = path.join(root, "user");
	const projectDir = path.join(root, "project");
	for (const dir of [packageDir, userDir, projectDir])
		fs.mkdirSync(dir, { recursive: true });

	fs.writeFileSync(
		path.join(packageDir, "same.workflow.json"),
		JSON.stringify({
			name: "same",
			description: "package",
			chain: [{ agent: "delegate" }],
		}),
	);
	fs.writeFileSync(
		path.join(userDir, "same.workflow.json"),
		JSON.stringify({
			name: "same",
			description: "user",
			chain: [{ agent: "scout" }],
		}),
	);
	fs.writeFileSync(
		path.join(projectDir, "same.workflow.json"),
		JSON.stringify({
			name: "same",
			description: "project",
			chain: [{ agent: "reviewer" }],
		}),
	);
	fs.writeFileSync(
		path.join(userDir, "user-only.workflow.json"),
		JSON.stringify({
			name: "user-only",
			description: "user",
			chain: [{ agent: "researcher" }],
		}),
	);

	const result = discoverWorkflowSpecs({ packageDir, userDir, projectDir });

	assert.equal(result.diagnostics.length, 0);
	assert.deepEqual(
		result.workflows
			.map((workflow) => `${workflow.name}:${workflow.description}`)
			.sort(),
		["same:project", "user-only:user"],
	);
});
