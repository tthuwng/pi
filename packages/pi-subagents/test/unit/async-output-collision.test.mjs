import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { executeAsyncChain } from "../../src/runs/background/async-execution.ts";

const agent = {
	name: "scout",
	description: "Scout",
	source: "builtin",
	filePath: "builtin/scout.md",
	systemPrompt: "Scout.",
	systemPromptMode: "replace",
	inheritProjectContext: true,
	inheritSkills: false,
	tools: ["read"],
};

const baseParams = {
	agents: [agent],
	ctx: {
		pi: {},
		cwd: "/repo",
		currentSessionId: "session-1",
	},
	cwd: "/repo",
	artifactConfig: {
		enabled: false,
		inlineOnSuccess: true,
		inlineOnError: true,
	},
	shareEnabled: false,
	maxSubagentDepth: 0,
};

test("async chain rejects duplicate sequential output paths before spawn", () => {
	const result = executeAsyncChain("unit-duplicate-sequential", {
		...baseParams,
		chain: [
			{ agent: "scout", task: "first", output: "report.md" },
			{ agent: "scout", task: "second", output: "./report.md" },
		],
	});

	assert.equal(result.isError, true);
	assert.match(
		result.content[0].text,
		/Async chain step 1 \(scout\) and Async chain step 2 \(scout\) resolve output to the same path: \/repo\/report\.md/,
	);
});

test("async chain rejects duplicate parallel output paths before spawn", () => {
	const result = executeAsyncChain("unit-duplicate-parallel", {
		...baseParams,
		chain: [
			{
				parallel: [
					{ agent: "scout", task: "first", output: "review.md" },
					{ agent: "scout", task: "second", output: "./review.md" },
				],
			},
		],
	});

	assert.equal(result.isError, true);
	assert.match(
		result.content[0].text,
		/Async parallel chain step 1 task 1 \(scout\) and Async parallel chain step 1 task 2 \(scout\) resolve output to the same path: \/repo\/review\.md/,
	);
});

test("async chain rejects duplicate output paths through symlinked directories before spawn", () => {
	const root = fs.mkdtempSync(
		path.join(os.tmpdir(), "pi-subagents-async-output-"),
	);
	const real = path.join(root, "real");
	const linked = path.join(root, "linked");
	fs.mkdirSync(real);
	fs.symlinkSync(real, linked, "dir");
	const result = executeAsyncChain("unit-duplicate-symlink", {
		...baseParams,
		ctx: { ...baseParams.ctx, cwd: root },
		cwd: root,
		chain: [
			{
				agent: "scout",
				task: "first",
				output: path.join(real, "nested", "report.md"),
			},
			{
				agent: "scout",
				task: "second",
				output: path.join(linked, "nested", "report.md"),
			},
		],
	});

	assert.equal(result.isError, true);
	assert.match(result.content[0].text, /resolve output to the same path/);
});
