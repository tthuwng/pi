import assert from "node:assert/strict";
import test from "node:test";

import { resolvePiCopyConfig } from "../src/config.js";

test("uses clipaste-paste defaults", () => {
	assert.deepEqual(resolvePiCopyConfig({}, {}), {
		command: "clipaste-paste",
		timeoutMs: 5000,
		notifyOnFailure: true,
	});
});

test("reads command and timeout from environment", () => {
	assert.deepEqual(
		resolvePiCopyConfig(
			{},
			{
				PI_COPY_COMMAND: "custom-paste",
				PI_COPY_TIMEOUT_MS: "1234",
				PI_COPY_NOTIFY_FAILURE: "false",
			},
		),
		{
			command: "custom-paste",
			timeoutMs: 1234,
			notifyOnFailure: false,
		},
	);
});

test("explicit config wins over environment", () => {
	assert.deepEqual(
		resolvePiCopyConfig(
			{ command: ["tool", "--image"], timeoutMs: 42, notifyOnFailure: true },
			{
				PI_COPY_COMMAND: "ignored",
				PI_COPY_TIMEOUT_MS: "1234",
				PI_COPY_NOTIFY_FAILURE: "false",
			},
		),
		{
			command: ["tool", "--image"],
			timeoutMs: 42,
			notifyOnFailure: true,
		},
	);
});
