import assert from "node:assert/strict";
import test from "node:test";

import type { AgentRuntimeFactory } from "../src/agent-session-types.js";
import { createDefaultAgentRuntimeFactory } from "../src/pi-session-sdk.js";

test("default Pi session runtime factory is exposed through the local contract", () => {
	const factory: AgentRuntimeFactory = createDefaultAgentRuntimeFactory({
		agentDir: "/tmp/pi-dynamic-workflows-agent-dir",
	});

	assert.equal(typeof factory, "function");
});
