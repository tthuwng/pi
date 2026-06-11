import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { loadTs } from "../support/load-ts.mjs";

const {
	agentCanMutateWorkspace,
	findSharedCwdChainParallelWriterError,
	findSharedCwdParallelWriterError,
	resolveGuardTaskCwd,
} = await loadTs("../../src/runs/shared/parallel-writer-guard.ts");

const worker = { name: "worker", tools: ["read", "edit", "write"] };
const reviewer = { name: "reviewer", tools: ["read", "grep", "bash"] };
const scout = { name: "scout", tools: ["read", "grep"] };
const writeOnlyAgent = { name: "note-taker", tools: ["read", "write"] };
const customToolAgent = {
	name: "custom-tool-agent",
	tools: ["read", "./custom-writer.ts"],
};
const genericMcpAgent = {
	name: "generic-mcp-agent",
	tools: ["read", "mcp"],
};
const directMcpAgent = {
	name: "direct-mcp-agent",
	tools: ["read"],
	mcpDirectTools: ["custom_mutator"],
};
const extensionAgent = {
	name: "extension-agent",
	tools: ["read"],
	extensions: ["./custom-writer.ts"],
};
const unrestricted = { name: "custom" };

test("detects workspace-mutation-capable agents", () => {
	assert.equal(agentCanMutateWorkspace(worker), true);
	assert.equal(agentCanMutateWorkspace(writeOnlyAgent), true);
	assert.equal(agentCanMutateWorkspace(customToolAgent), true);
	assert.equal(agentCanMutateWorkspace(genericMcpAgent), true);
	assert.equal(agentCanMutateWorkspace(directMcpAgent), true);
	assert.equal(agentCanMutateWorkspace(extensionAgent), true);
	assert.equal(agentCanMutateWorkspace(reviewer), false);
	assert.equal(agentCanMutateWorkspace(scout), false);
	assert.equal(agentCanMutateWorkspace(unrestricted), true);
	assert.equal(agentCanMutateWorkspace(undefined), false);
});

test("resolves guard task cwd relative to the base cwd", () => {
	assert.equal(resolveGuardTaskCwd("/repo", undefined), "/repo");
	assert.equal(resolveGuardTaskCwd("/repo", "packages/a"), "/repo/packages/a");
	assert.equal(
		resolveGuardTaskCwd("/repo", "/tmp/worktree-a"),
		"/tmp/worktree-a",
	);
});

test("rejects multiple workspace-mutation-capable agents sharing cwd without worktree", () => {
	assert.equal(
		findSharedCwdParallelWriterError({
			tasks: [{ agent: "worker" }, { agent: "worker", cwd: "." }],
			agents: [worker],
			baseCwd: "/repo",
			label: "Parallel",
		}),
		"Parallel tasks 1 (worker) and 2 (worker) are workspace-mutation-capable and target the same cwd without worktree isolation: /repo. Use worktree: true with a clean git state, assign distinct isolated cwd values, or run one writer at a time.",
	);
});

test("allows parallel read-only agents sharing cwd", () => {
	assert.equal(
		findSharedCwdParallelWriterError({
			tasks: [{ agent: "reviewer" }, { agent: "reviewer" }],
			agents: [reviewer],
			baseCwd: "/repo",
			label: "Parallel",
		}),
		undefined,
	);
});

test("allows one writer with read-only agents sharing cwd", () => {
	assert.equal(
		findSharedCwdParallelWriterError({
			tasks: [{ agent: "worker" }, { agent: "reviewer" }],
			agents: [worker, reviewer],
			baseCwd: "/repo",
			label: "Parallel",
		}),
		undefined,
	);
});

test("allows wrapper-output scouts sharing cwd", () => {
	assert.equal(
		findSharedCwdParallelWriterError({
			tasks: [{ agent: "scout" }, { agent: "scout" }],
			agents: [scout],
			baseCwd: "/repo",
			label: "Parallel",
		}),
		undefined,
	);
});

test("rejects multiple write-only agents sharing cwd without worktree", () => {
	assert.match(
		findSharedCwdParallelWriterError({
			tasks: [{ agent: "note-taker" }, { agent: "note-taker" }],
			agents: [writeOnlyAgent],
			baseCwd: "/repo",
			label: "Parallel",
		}),
		/workspace-mutation-capable/,
	);
});

test("rejects multiple custom-tool agents sharing cwd without worktree", () => {
	assert.match(
		findSharedCwdParallelWriterError({
			tasks: [{ agent: "custom-tool-agent" }, { agent: "custom-tool-agent" }],
			agents: [customToolAgent],
			baseCwd: "/repo",
			label: "Parallel",
		}),
		/workspace-mutation-capable/,
	);
});

test("rejects multiple generic-MCP agents sharing cwd without worktree", () => {
	assert.match(
		findSharedCwdParallelWriterError({
			tasks: [{ agent: "generic-mcp-agent" }, { agent: "generic-mcp-agent" }],
			agents: [genericMcpAgent],
			baseCwd: "/repo",
			label: "Parallel",
		}),
		/workspace-mutation-capable/,
	);
});

test("rejects multiple direct-MCP agents sharing cwd without worktree", () => {
	assert.match(
		findSharedCwdParallelWriterError({
			tasks: [{ agent: "direct-mcp-agent" }, { agent: "direct-mcp-agent" }],
			agents: [directMcpAgent],
			baseCwd: "/repo",
			label: "Parallel",
		}),
		/workspace-mutation-capable/,
	);
});

test("rejects multiple extension-loaded agents sharing cwd without worktree", () => {
	assert.match(
		findSharedCwdParallelWriterError({
			tasks: [{ agent: "extension-agent" }, { agent: "extension-agent" }],
			agents: [extensionAgent],
			baseCwd: "/repo",
			label: "Parallel",
		}),
		/workspace-mutation-capable/,
	);
});

test("allows multiple writers in distinct explicit workspaces", () => {
	assert.equal(
		findSharedCwdParallelWriterError({
			tasks: [
				{ agent: "worker", cwd: "/tmp/workspace-a" },
				{ agent: "worker", cwd: "/tmp/workspace-b" },
			],
			agents: [worker],
			baseCwd: "/repo",
			label: "Parallel",
		}),
		undefined,
	);
});

test("rejects multiple writers sharing a real cwd through a symlink alias", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-cwd-"));
	const real = path.join(root, "real");
	const linked = path.join(root, "linked");
	fs.mkdirSync(real);
	fs.symlinkSync(real, linked, "dir");

	assert.match(
		findSharedCwdParallelWriterError({
			tasks: [{ agent: "worker" }, { agent: "worker", cwd: linked }],
			agents: [worker],
			baseCwd: real,
			label: "Parallel",
		}),
		/workspace-mutation-capable/,
	);
});

test("allows multiple writers when worktree isolation is enabled", () => {
	assert.equal(
		findSharedCwdParallelWriterError({
			tasks: [{ agent: "worker" }, { agent: "worker" }],
			agents: [worker],
			baseCwd: "/repo",
			worktree: true,
			label: "Parallel",
		}),
		undefined,
	);
});

test("rejects async/background chain parallel writers sharing cwd without worktree", () => {
	assert.equal(
		findSharedCwdChainParallelWriterError({
			chain: [
				{ agent: "scout" },
				{
					parallel: [{ agent: "worker" }, { agent: "worker", cwd: "." }],
				},
			],
			agents: [worker, scout],
			baseCwd: "/repo",
		}),
		"Parallel chain step 2 tasks 1 (worker) and 2 (worker) are workspace-mutation-capable and target the same cwd without worktree isolation: /repo. Use worktree: true with a clean git state, assign distinct isolated cwd values, or run one writer at a time.",
	);
});

test("allows async/background chain parallel advisory fanout with wrapper outputs", () => {
	assert.equal(
		findSharedCwdChainParallelWriterError({
			chain: [
				{
					parallel: [{ agent: "scout", cwd: "." }, { agent: "reviewer" }],
				},
			],
			agents: [scout, reviewer],
			baseCwd: "/repo",
		}),
		undefined,
	);
});
