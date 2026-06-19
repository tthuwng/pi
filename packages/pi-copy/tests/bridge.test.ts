import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { quotePathForPaste, readBridgePath } from "../src/bridge.js";

function withTempDir(fn: (dir: string) => void): void {
	const dir = mkdtempSync(join(tmpdir(), "pi-copy-test-"));
	try {
		fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test("reads the first path printed by an argv bridge command", () => {
	withTempDir((dir) => {
		const image = join(dir, "clipboard image.png");
		writeFileSync(image, "not validated here");

		const result = readBridgePath({
			command: [process.execPath, "-e", `console.log(${JSON.stringify(image)})`],
			cwd: dir,
			timeoutMs: 1000,
		});

		assert.deepEqual(result, { ok: true, path: image });
	});
});

test("resolves relative bridge paths against cwd", () => {
	withTempDir((dir) => {
		const image = join(dir, "relative.png");
		writeFileSync(image, "not validated here");

		const result = readBridgePath({
			command: [process.execPath, "-e", "console.log('./relative.png')"],
			cwd: dir,
			timeoutMs: 1000,
		});

		assert.deepEqual(result, { ok: true, path: image });
	});
});

test("rejects missing bridge paths", () => {
	withTempDir((dir) => {
		const missing = join(dir, "missing.png");
		const result = readBridgePath({
			command: [process.execPath, "-e", `console.log(${JSON.stringify(missing)})`],
			cwd: dir,
			timeoutMs: 1000,
		});

		assert.deepEqual(result, { ok: false, reason: "missing", path: missing });
	});
});

test("reports command failure", () => {
	withTempDir((dir) => {
		const result = readBridgePath({
			command: [process.execPath, "-e", "process.exit(7)"],
			cwd: dir,
			timeoutMs: 1000,
		});

		assert.deepEqual(result, { ok: false, reason: "command-failed", status: 7 });
	});
});

test("quotes paths with whitespace for bracketed paste", () => {
	assert.equal(quotePathForPaste("/tmp/clipboard image.png"), '"/tmp/clipboard image.png"');
	assert.equal(quotePathForPaste("/tmp/clipboard.png"), "/tmp/clipboard.png");
});
