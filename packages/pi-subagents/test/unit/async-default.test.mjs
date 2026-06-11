import test from "node:test";
import assert from "node:assert/strict";

import { loadTs } from "../support/load-ts.mjs";

const { resolveRequestedAsync } = await loadTs("../../src/runs/foreground/subagent-executor.ts");

test("omitted async follows asyncByDefault false as foreground", () => {
	assert.equal(resolveRequestedAsync({}, false), false);
});

test("explicit async overrides asyncByDefault", () => {
	assert.equal(resolveRequestedAsync({ async: true }, false), true);
	assert.equal(resolveRequestedAsync({ async: false }, true), false);
});
