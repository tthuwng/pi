import assert from "node:assert/strict";
import test from "node:test";

import {
	DEFAULT_BRIDGE_RESPONSE_TIMEOUT_MS,
	DEFAULT_BRIDGE_START_TIMEOUT_MS,
} from "../src/subagents-bridge.js";

test("subagents bridge keeps no-bridge detection short but allows real agent runs", () => {
	assert.equal(DEFAULT_BRIDGE_START_TIMEOUT_MS, 15_000);
	assert.ok(DEFAULT_BRIDGE_RESPONSE_TIMEOUT_MS >= 10 * 60_000);
});
