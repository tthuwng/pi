import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { loadTs } from "../support/load-ts.mjs";

const {
	resolveChainOutputPath,
	validateUniqueChainOutputPath,
} = await loadTs("../../src/runs/shared/chain-output-paths.ts");

test("foreground chain output paths resolve relative to the chain directory", () => {
	assert.equal(
		resolveChainOutputPath("reports/a.md", "/tmp/pi-chain/run-1"),
		"/tmp/pi-chain/run-1/reports/a.md",
	);
	assert.equal(
		resolveChainOutputPath("/tmp/pi-chain/run-1/reports/a.md", "/other"),
		"/tmp/pi-chain/run-1/reports/a.md",
	);
	assert.equal(resolveChainOutputPath(false, "/tmp/pi-chain/run-1"), undefined);
});

test("foreground chain rejects duplicate sequential output paths", () => {
	const seen = new Map();
	const firstPath = resolveChainOutputPath("report.md", "/tmp/pi-chain/run-1");
	const secondPath = resolveChainOutputPath(
		"./report.md",
		"/tmp/pi-chain/run-1",
	);

	assert.equal(
		validateUniqueChainOutputPath(seen, firstPath, {
			stepIndex: 0,
			agent: "scout",
		}),
		undefined,
	);
	assert.equal(
		validateUniqueChainOutputPath(seen, secondPath, {
			stepIndex: 1,
			agent: "planner",
		}),
		"Chain step 1 (scout) and Chain step 2 (planner) resolve output to the same path: /tmp/pi-chain/run-1/report.md. Use distinct output paths.",
	);
});

test("foreground chain rejects duplicate parallel output paths", () => {
	const seen = new Map();
	const firstPath = resolveChainOutputPath("review.md", "/tmp/pi-chain/run-1");
	const secondPath = resolveChainOutputPath("review.md", "/tmp/pi-chain/run-1");

	assert.equal(
		validateUniqueChainOutputPath(seen, firstPath, {
			stepIndex: 0,
			taskIndex: 0,
			agent: "reviewer",
		}),
		undefined,
	);
	assert.equal(
		validateUniqueChainOutputPath(seen, secondPath, {
			stepIndex: 0,
			taskIndex: 1,
			agent: "reviewer",
		}),
		"Parallel chain step 1 task 1 (reviewer) and Parallel chain step 1 task 2 (reviewer) resolve output to the same path: /tmp/pi-chain/run-1/review.md. Use distinct output paths.",
	);
});

test("foreground chain permits distinct output paths", () => {
	const seen = new Map();
	assert.equal(
		validateUniqueChainOutputPath(
			seen,
			resolveChainOutputPath("a.md", "/tmp/pi-chain/run-1"),
			{ stepIndex: 0, agent: "scout" },
		),
		undefined,
	);
	assert.equal(
		validateUniqueChainOutputPath(
			seen,
			resolveChainOutputPath("b.md", "/tmp/pi-chain/run-1"),
			{ stepIndex: 1, agent: "planner" },
		),
		undefined,
	);
});

test("foreground chain rejects duplicate output paths through symlinked directories", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-output-"));
	const real = path.join(root, "real");
	const linked = path.join(root, "linked");
	fs.mkdirSync(real);
	fs.symlinkSync(real, linked, "dir");
	const seen = new Map();

	assert.equal(
		validateUniqueChainOutputPath(seen, path.join(real, "report.md"), {
			stepIndex: 0,
			agent: "scout",
		}),
		undefined,
	);
	assert.match(
		validateUniqueChainOutputPath(seen, path.join(linked, "report.md"), {
			stepIndex: 1,
			agent: "planner",
		}),
		/resolve output to the same path/,
	);
});

test("foreground chain rejects duplicate output paths through symlinked ancestors", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-output-"));
	const real = path.join(root, "real");
	const linked = path.join(root, "linked");
	fs.mkdirSync(real);
	fs.symlinkSync(real, linked, "dir");
	const seen = new Map();

	assert.equal(
		validateUniqueChainOutputPath(
			seen,
			path.join(real, "nested", "report.md"),
			{
				stepIndex: 0,
				agent: "scout",
			},
		),
		undefined,
	);
	assert.match(
		validateUniqueChainOutputPath(
			seen,
			path.join(linked, "nested", "report.md"),
			{
				stepIndex: 1,
				agent: "planner",
			},
		),
		/resolve output to the same path/,
	);
});
