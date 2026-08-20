const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const jiti = require("jiti")(__filename);
const memory = jiti("./agent-memory.ts");

test("bounded memory supports explicit CRUD", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-agent-memory-"));
	try {
		memory.updateMemory(root, "memory", "add", "Prefers short answers");
		assert.equal(memory.readMemory(root, "memory"), "- Prefers short answers");
		memory.updateMemory(root, "memory", "replace", "Prefers short answers", "Prefers concise answers");
		assert.equal(memory.updateMemory(root, "memory", "list"), "- Prefers concise answers");
		memory.updateMemory(root, "memory", "remove", "Prefers concise answers");
		assert.equal(memory.readMemory(root, "memory"), "");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("memory limits are enforced", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-agent-memory-"));
	try {
		assert.throws(
			() => memory.updateMemory(root, "memory", "add", "x".repeat(501)),
			/500 characters/,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("session recap is local and summarizes tools and files", () => {
	const recap = memory.sessionRecap([
		{ type: "message", message: { role: "user", content: "Fix the build" } },
		{
			type: "message",
			message: {
				role: "assistant",
				content: [{ type: "toolCall", name: "read", arguments: { path: "src/app.ts" } }],
			},
		},
		{ type: "message", message: { role: "toolResult", toolName: "read" } },
	], "gpt-test", 1234);
	assert.match(recap, /1 user, 1 assistant/);
	assert.match(recap, /Tools: read/);
	assert.match(recap, /Files: src\/app\.ts/);
	assert.match(recap, /Context: 1,234 tokens/);
});

test("extension registers the memory tool and recap command", () => {
	const tools = [];
	const commands = [];
	memory.default({
		on() {},
		registerTool(tool) { tools.push(tool.name); },
		registerCommand(name) { commands.push(name); },
	});
	assert.deepEqual(tools, ["agent_memory"]);
	assert.deepEqual(commands, ["recap"]);
});
