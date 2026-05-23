import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import memoryMdExtension from "../index.js";
import {
	type MemoryFrontmatter,
	readMemoryFileAsync,
	writeMemoryFile,
} from "../memory-core.js";

type MockContext = {
	cwd: string;
	ui: {
		notify(message: string, level?: string): void;
	};
};

type Handler = (event: Record<string, unknown>, ctx: MockContext) => unknown;

type ToolResult = {
	content?: Array<{ type: string; text: string }>;
	details?: Record<string, unknown>;
};

type Tool = {
	name: string;
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: MockContext,
	): Promise<ToolResult>;
};

type Command = {
	handler(args: string[], ctx: MockContext): unknown;
};

type Harness = {
	handlers: Map<string, Handler>;
	tools: Map<string, Tool>;
	commands: Map<string, Command>;
	notifications: string[];
};

async function withGlobalOnlyMemory(
	fn: (paths: { root: string; agentDir: string; cwd: string }) => Promise<void>,
	options: {
		delivery?: "message-append" | "system-prompt";
		projectFiles?: Array<{ relativePath: string; tag: string }>;
	} = {},
): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "pi-memory-md-test-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;

	try {
		const agentDir = path.join(root, "agent");
		const memoryRoot = path.join(root, "memory");
		const globalCore = path.join(memoryRoot, "common", "core");
		const cwd = path.join(root, "project-without-memory");
		const projectMemoryDir = path.join(memoryRoot, path.basename(cwd));

		await mkdir(agentDir, { recursive: true });
		await mkdir(globalCore, { recursive: true });
		await mkdir(cwd, { recursive: true });
		await writeFile(
			path.join(agentDir, "settings.json"),
			JSON.stringify({
				"pi-memory-md": {
					enabled: true,
					memoryDir: {
						localPath: memoryRoot,
						globalMemory: "common",
					},
					delivery: options.delivery ?? "system-prompt",
					tape: { enabled: false },
				},
			}),
		);
		await writeFile(
			path.join(globalCore, "USER.md"),
			[
				"---",
				"description: Shared test memory",
				"tags:",
				"  - test-global-memory",
				"---",
				"",
				"# Shared Test Memory",
				"",
				"Global-only memory content.",
			].join("\n"),
		);
		for (const projectFile of options.projectFiles ?? []) {
			const fullPath = path.join(projectMemoryDir, projectFile.relativePath);
			await mkdir(path.dirname(fullPath), { recursive: true });
			await writeFile(
				fullPath,
				[
					"---",
					"description: Project test memory",
					"tags:",
					`  - ${projectFile.tag}`,
					"---",
					"",
					"# Project Test Memory",
					"",
					"Project memory content outside core.",
				].join("\n"),
			);
		}

		process.env.PI_CODING_AGENT_DIR = agentDir;
		await fn({ root, agentDir, cwd });
	} finally {
		if (previousAgentDir === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		}
		await rm(root, { recursive: true, force: true });
	}
}

function createHarness(): Harness {
	const handlers = new Map<string, Handler>();
	const tools = new Map<string, Tool>();
	const commands = new Map<string, Command>();
	const notifications: string[] = [];
	const pi = {
		on(name: string, handler: Handler) {
			handlers.set(name, handler);
		},
		registerTool(tool: Tool) {
			tools.set(tool.name, tool);
		},
		registerCommand(name: string, command: Command) {
			commands.set(name, command);
		},
		addMessage() {},
		exec: async (command: string, args: string[]) => {
			const result = spawnSync(command, args, { encoding: "utf-8" });
			if (result.status !== 0) {
				throw new Error(result.stderr || result.stdout || `${command} failed`);
			}

			return {
				stdout: result.stdout ?? "",
				stderr: result.stderr ?? "",
				exitCode: result.status ?? 0,
			};
		},
	} as unknown as ExtensionAPI;

	memoryMdExtension(pi);
	return { handlers, tools, commands, notifications };
}

function createContext(cwd: string, notifications: string[]): MockContext {
	return {
		cwd,
		ui: {
			notify(message: string, level = "info") {
				notifications.push(`${level}: ${message}`);
			},
		},
	};
}

test("global memory is delivered without a project memory directory", async () => {
	await withGlobalOnlyMemory(async ({ cwd }) => {
		const harness = createHarness();
		const ctx = createContext(cwd, harness.notifications);

		await harness.handlers.get("session_start")?.({ reason: "new" }, ctx);
		const result = (await harness.handlers.get("before_agent_start")?.(
			{ prompt: "hello", systemPrompt: "BASE" },
			ctx,
		)) as { systemPrompt?: string } | undefined;

		assert.match(result?.systemPrompt ?? "", /Shared Global Memory/);
		assert.match(result?.systemPrompt ?? "", /test-global-memory/);
		assert.ok(
			harness.notifications.some((message) =>
				message.includes("Memory delivered: 1 files"),
			),
		);
	});
});

test("global memory delivery supports message append mode", async () => {
	await withGlobalOnlyMemory(
		async ({ cwd }) => {
			const harness = createHarness();
			const ctx = createContext(cwd, harness.notifications);

			await harness.handlers.get("session_start")?.({ reason: "new" }, ctx);
			const result = (await harness.handlers.get("before_agent_start")?.(
				{ prompt: "hello", systemPrompt: "BASE" },
				ctx,
			)) as { message?: { customType?: string; content?: string } } | undefined;

			assert.equal(result?.message?.customType, "pi-memory-md");
			assert.match(result?.message?.content ?? "", /Shared Global Memory/);
			assert.match(result?.message?.content ?? "", /test-global-memory/);
		},
		{ delivery: "message-append" },
	);
});

test("project memory outside core is delivered and searchable", async () => {
	await withGlobalOnlyMemory(
		async ({ cwd }) => {
			const harness = createHarness();
			const ctx = createContext(cwd, harness.notifications);

			await harness.handlers.get("session_start")?.({ reason: "new" }, ctx);
			const result = (await harness.handlers.get("before_agent_start")?.(
				{ prompt: "hello", systemPrompt: "BASE" },
				ctx,
			)) as { systemPrompt?: string } | undefined;
			assert.match(result?.systemPrompt ?? "", /Project Memory/);
			assert.match(result?.systemPrompt ?? "", /test-project-notes/);

			const searchResult = await harness.tools
				.get("memory_search")
				?.execute(
					"test-call",
					{ query: "test-project-notes" },
					undefined,
					undefined,
					ctx,
				);
			assert.equal(searchResult?.details?.count, 1);
			assert.match(searchResult?.content?.[0]?.text ?? "", /Project/);
		},
		{
			projectFiles: [
				{ relativePath: "notes/PROJECT.md", tag: "test-project-notes" },
			],
		},
	);
});

test("global memory tools work without a project memory directory", async () => {
	await withGlobalOnlyMemory(async ({ cwd }) => {
		const harness = createHarness();
		const ctx = createContext(cwd, harness.notifications);

		const searchResult = await harness.tools
			.get("memory_search")
			?.execute(
				"test-call",
				{ query: "test-global-memory" },
				undefined,
				undefined,
				ctx,
			);
		assert.equal(searchResult?.details?.count, 1);
		assert.match(searchResult?.content?.[0]?.text ?? "", /Shared global/);

		const checkResult = await harness.tools
			.get("memory_check")
			?.execute("test-call", {}, undefined, undefined, ctx);
		assert.equal(checkResult?.details?.fileCount, 1);
		assert.equal(checkResult?.details?.globalMemoryMissing, false);
	});
});

test("status surfaces global-only local memory instead of reporting uninitialized", async () => {
	await withGlobalOnlyMemory(async ({ cwd }) => {
		const harness = createHarness();
		const ctx = createContext(cwd, harness.notifications);

		await harness.commands.get("memory-status")?.handler([], ctx);
		assert.ok(
			harness.notifications.some((message) =>
				message.includes("Shared global initialized"),
			),
		);
		assert.ok(
			harness.notifications.every(
				(message) => !message.includes("Not initialized"),
			),
		);

		const syncStatus = await harness.tools
			.get("memory_sync")
			?.execute("test-call", { action: "status" }, undefined, undefined, ctx);
		assert.equal(syncStatus?.details?.initialized, true);
		assert.equal(syncStatus?.details?.gitBacked, false);
		assert.match(syncStatus?.content?.[0]?.text ?? "", /not git-backed/);
	});
});

test("readMemoryFileAsync tolerates malformed frontmatter", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "pi-memory-md-test-"));

	try {
		const filePath = path.join(root, "bad-frontmatter.md");
		await writeFile(
			filePath,
			[
				"---",
				"description: Crash runbook",
				"evidence:",
				"  - Current boot kernel reported `BERT: [Hardware Error]: Skipped 1 error records`.",
				"tags:",
				"  - boot",
				"  - bert",
				"---",
				"",
				"# Body",
				"",
				"Body survives.",
			].join("\n"),
		);

		const memory = await readMemoryFileAsync(filePath);

		assert.ok(memory);
		assert.equal(memory.frontmatter.description, "Crash runbook");
		assert.deepEqual(memory.frontmatter.tags, ["boot", "bert"]);
		assert.equal(memory.content.trim(), "# Body\n\nBody survives.");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("writeMemoryFile uses JSON frontmatter for YAML-hostile evidence", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "pi-memory-md-test-"));
	const evidenceEntry =
		"Current boot kernel reported `BERT: [Hardware Error]: Skipped 1 error records`.";

	try {
		const filePath = path.join(root, "json-frontmatter.md");
		const frontmatter: MemoryFrontmatter & { evidence: string[] } = {
			description: "Crash runbook",
			evidence: [evidenceEntry],
			tags: ["boot", "bert"],
		};

		writeMemoryFile(filePath, "# Body\n", frontmatter);

		const raw = await readFile(filePath, "utf-8");
		assert.match(raw, /"evidence"/);
		const memory = await readMemoryFileAsync(filePath);
		const parsedEvidence = (
			memory?.frontmatter as MemoryFrontmatter & { evidence?: string[] }
		).evidence;

		assert.deepEqual(parsedEvidence, [evidenceEntry]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
