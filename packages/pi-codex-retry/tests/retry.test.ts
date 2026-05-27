import assert from "node:assert/strict";
import test from "node:test";

import {
	createAssistantMessageEventStream,
	type AssistantMessage,
	type AssistantMessageEvent,
	type Context,
	type Model,
	type SimpleStreamOptions,
	type StreamOptions,
} from "@mariozechner/pi-ai";

import {
	createCodexRetrySimpleStream,
	createCodexRetryStream,
	isRecoverableCodexTransportFailure,
} from "../src/retry.ts";

const model: Model<"openai-codex-responses"> = {
	id: "gpt-5.5",
	name: "GPT-5.5",
	api: "openai-codex-responses",
	provider: "openai-codex",
	baseUrl: "https://chatgpt.com/backend-api/codex",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 272_000,
	maxTokens: 32_000,
};

const context: Context = { messages: [] };

function message(errorMessage?: string): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-codex-responses",
		provider: "openai-codex",
		model: "gpt-5.5",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: errorMessage ? "error" : "stop",
		errorMessage,
		timestamp: Date.now(),
	};
}

function fakeStream(events: AssistantMessageEvent[]) {
	const stream = createAssistantMessageEventStream();
	queueMicrotask(() => {
		for (const event of events) stream.push(event);
		const last = events.at(-1);
		stream.end(
			last?.type === "done"
				? last.message
				: last?.type === "error"
					? last.error
					: undefined,
		);
	});
	return stream;
}

async function collect(
	events: AsyncIterable<AssistantMessageEvent>,
): Promise<AssistantMessageEvent[]> {
	const collected: AssistantMessageEvent[] = [];
	for await (const event of events) collected.push(event);
	return collected;
}

test("classifies WebSocket 1006 and connection-ended transport failures as recoverable", () => {
	assert.equal(
		isRecoverableCodexTransportFailure(
			message("WebSocket closed 1006 Connection ended"),
		),
		true,
	);
	assert.equal(
		isRecoverableCodexTransportFailure(message("Request was aborted")),
		false,
	);
	assert.equal(
		isRecoverableCodexTransportFailure(message("400 invalid_request_error")),
		false,
	);
});

test("streams partial output, suppresses retryable error, and retries via SSE", async () => {
	const calls: Array<StreamOptions | undefined> = [];
	const firstError = message("WebSocket closed 1006 Connection ended");
	const success = message();
	success.content.push({ type: "text", text: "recovered" });

	const stream = createCodexRetryStream(
		model,
		context,
		{ transport: "auto" },
		{
			maxAttempts: 2,
			baseDelayMs: 0,
			streamCodex: (_model, _context, options) => {
				calls.push(options);
				if (calls.length === 1) {
					const partial = message();
					partial.content.push({ type: "text", text: "partial" });
					return fakeStream([
						{ type: "start", partial },
						{ type: "text_start", contentIndex: 0, partial },
						{ type: "text_delta", contentIndex: 0, delta: "partial", partial },
						{ type: "error", reason: "error", error: firstError },
					]);
				}
				return fakeStream([
					{ type: "start", partial: success },
					{ type: "text_start", contentIndex: 0, partial: success },
					{
						type: "text_delta",
						contentIndex: 0,
						delta: "recovered",
						partial: success,
					},
					{ type: "done", reason: "stop", message: success },
				]);
			},
		},
	);

	const events = await collect(stream);

	assert.equal(calls.length, 2);
	assert.equal(calls[0]?.transport, "auto");
	assert.equal(calls[1]?.transport, "sse");
	assert.equal(
		events.some((event) => event.type === "error"),
		false,
	);
	assert.equal(events.filter((event) => event.type === "start").length, 1);
	assert.equal(events.at(-1)?.type, "done");
});

test("simple retry stream preserves reasoning option and retries via SSE", async () => {
	const calls: Array<SimpleStreamOptions | undefined> = [];
	const firstError = message("WebSocket closed 1006 Connection ended");
	const success = message();

	const stream = createCodexRetrySimpleStream(
		model,
		context,
		{ reasoning: "high", transport: "auto" },
		{
			maxAttempts: 2,
			baseDelayMs: 0,
			streamCodex: (_model, _context, options) => {
				calls.push(options as SimpleStreamOptions | undefined);
				return fakeStream(
					calls.length === 1
						? [{ type: "error", reason: "error", error: firstError }]
						: [{ type: "done", reason: "stop", message: success }],
				);
			},
		},
	);

	const events = await collect(stream);

	assert.equal(calls.length, 2);
	assert.equal(calls[0]?.reasoning, "high");
	assert.equal(calls[1]?.reasoning, "high");
	assert.equal(calls[1]?.transport, "sse");
	assert.equal(events.at(-1)?.type, "done");
});

test("emits an aborted terminal event when cancelled during retry backoff", async () => {
	const calls: Array<StreamOptions | undefined> = [];
	const controller = new AbortController();
	const stream = createCodexRetryStream(
		model,
		context,
		{ signal: controller.signal, transport: "auto" },
		{
			maxAttempts: 2,
			baseDelayMs: 100,
			streamCodex: (_model, _context, options) => {
				calls.push(options);
				return fakeStream([
					{
						type: "error",
						reason: "error",
						error: message("WebSocket closed 1006 Connection ended"),
					},
				]);
			},
		},
	);

	setTimeout(() => controller.abort(), 10);
	const events = await collect(stream);
	const finalEvent = events.at(-1);

	assert.equal(calls.length, 1);
	assert.equal(finalEvent?.type, "error");
	assert.equal(
		finalEvent?.type === "error" ? finalEvent.error.stopReason : undefined,
		"aborted",
	);
	assert.equal(
		finalEvent?.type === "error" ? finalEvent.reason : undefined,
		"aborted",
	);
});

test("does not retry after a tool call has started", async () => {
	const calls: Array<StreamOptions | undefined> = [];
	const partial = message();
	partial.content.push({
		type: "toolCall",
		id: "call_1",
		name: "read",
		arguments: {},
	});
	const failure = message("WebSocket closed 1006 Connection ended");

	const stream = createCodexRetryStream(model, context, undefined, {
		maxAttempts: 2,
		baseDelayMs: 0,
		streamCodex: (_model, _context, options) => {
			calls.push(options);
			return fakeStream([
				{ type: "start", partial },
				{ type: "toolcall_start", contentIndex: 0, partial },
				{ type: "error", reason: "error", error: failure },
			]);
		},
	});

	const events = await collect(stream);

	assert.equal(calls.length, 1);
	const finalEvent = events.at(-1);
	assert.equal(finalEvent?.type, "error");
	assert.equal(
		finalEvent?.type === "error"
			? /WebSocket closed|Connection ended/i.test(
					finalEvent.error.errorMessage ?? "",
				)
			: true,
		false,
	);
	assert.match(
		finalEvent?.type === "error" ? (finalEvent.error.errorMessage ?? "") : "",
		/Automatic retry was suppressed to avoid duplicating tool side effects/,
	);
});
