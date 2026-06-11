import test from "node:test";
import assert from "node:assert/strict";

import { loadTs } from "../support/load-ts.mjs";

const { compactChildEventForAsyncLog } = await loadTs("../../src/runs/background/child-event-log.ts");

function serialized(value) {
	return JSON.stringify(value);
}

test("compacts streaming message updates without persisting message context", () => {
	const compact = compactChildEventForAsyncLog({
		type: "message_update",
		assistantMessageEvent: {
			type: "thinking_delta",
			contentIndex: 0,
			delta: "private chain of thought",
			partial: {
				role: "assistant",
				content: [
					{
						type: "thinking",
						thinking: "private chain of thought",
						thinkingSignature: "encrypted-thinking-signature",
					},
				],
			},
		},
		message: {
			role: "assistant",
			content: [
				{
					type: "thinking",
					thinking: "private chain of thought",
					thinkingSignature: "encrypted-thinking-signature",
				},
			],
		},
	});

	assert.deepEqual(compact, {
		type: "subagent.child.event",
		childType: "message_update",
		assistantEventType: "thinking_delta",
		contentIndex: 0,
		deltaBytes: 24,
		messageRole: "assistant",
	});
	assert.doesNotMatch(serialized(compact), /private chain of thought/);
	assert.doesNotMatch(serialized(compact), /encrypted-thinking-signature/);
	assert.equal(Object.hasOwn(compact, "message"), false);
	assert.equal(Object.hasOwn(compact, "assistantMessageEvent"), false);
	assert.equal(Object.hasOwn(compact, "partial"), false);
});

test("compacts tool and stream events without persisting args or output text", () => {
	const toolStart = compactChildEventForAsyncLog({
		type: "tool_execution_start",
		toolName: "read",
		args: { path: "/secret/path", oldText: "sensitive file context" },
	});
	const toolEnd = compactChildEventForAsyncLog({
		type: "tool_execution_end",
		toolName: "read",
		isError: true,
		result: "sensitive file output",
	});
	const stderr = compactChildEventForAsyncLog({
		type: "subagent.child.stderr",
		line: "sensitive stderr context",
	});

	assert.deepEqual(toolStart, {
		type: "subagent.child.event",
		childType: "tool_execution_start",
		toolName: "read",
	});
	assert.deepEqual(toolEnd, {
		type: "subagent.child.event",
		childType: "tool_execution_end",
		toolName: "read",
		isError: true,
	});
	assert.deepEqual(stderr, {
		type: "subagent.child.stream",
		stream: "stderr",
		lineBytes: 24,
	});

	const combined = serialized([toolStart, toolEnd, stderr]);
	assert.doesNotMatch(combined, /secret|sensitive/);
	assert.equal(Object.hasOwn(toolStart, "args"), false);
	assert.equal(Object.hasOwn(toolEnd, "result"), false);
	assert.equal(Object.hasOwn(stderr, "line"), false);
});
