import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	resolvePiPackageRootFromEntry,
	resolveWindowsPiCliScript,
} from "../../src/runs/shared/pi-spawn.ts";

function makePackageRoot(name) {
	const root = mkdtempSync(join(tmpdir(), "pi-subagents-pi-root-"));
	const binDir = join(root, "dist", "cli");
	mkdirSync(binDir, { recursive: true });
	const cli = join(binDir, "pi.js");
	writeFileSync(cli, "console.log('pi');\n");
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify({ name, bin: { pi: "dist/cli/pi.js" } }),
	);
	return { root, cli };
}

test("resolves current @earendil-works pi package roots", () => {
	const { root, cli } = makePackageRoot("@earendil-works/pi-coding-agent");
	assert.equal(resolvePiPackageRootFromEntry(cli), root);
});

test("still resolves legacy @mariozechner pi package roots", () => {
	const { root, cli } = makePackageRoot("@mariozechner/pi-coding-agent");
	assert.equal(resolvePiPackageRootFromEntry(cli), root);
});

test("windows CLI resolution accepts current-scope package roots", () => {
	const { root, cli } = makePackageRoot("@earendil-works/pi-coding-agent");
	assert.equal(
		resolveWindowsPiCliScript({
			argv1: "not-a-runnable-entrypoint",
			piPackageRoot: root,
		}),
		cli,
	);
});
