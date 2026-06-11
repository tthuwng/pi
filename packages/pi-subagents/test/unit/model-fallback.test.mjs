import test from "node:test";
import assert from "node:assert/strict";

import { loadTs } from "../support/load-ts.mjs";

const { isRetryableModelFailure } = await loadTs("../../src/runs/shared/model-fallback.ts");

test("classifies websocket transport closures as retryable model failures", () => {
	assert.equal(
		isRetryableModelFailure("WebSocket closed 1006 Connection ended"),
		true,
	);
	assert.equal(isRetryableModelFailure("websocket closed unexpectedly"), true);
	assert.equal(
		isRetryableModelFailure("Connection closed before response completed"),
		true,
	);
});

test("does not classify tool-policy blocks or generic task failures as retryable model failures", () => {
	assert.equal(isRetryableModelFailure("Edit without read"), false);
	assert.equal(
		isRetryableModelFailure("BLOCKED — Ambiguous edit target"),
		false,
	);
	assert.equal(isRetryableModelFailure("database connection closed"), false);
});
