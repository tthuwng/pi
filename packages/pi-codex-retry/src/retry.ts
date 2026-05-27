import {
	createAssistantMessageEventStream,
	type AssistantMessage,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type SimpleStreamOptions,
	type StreamFunction,
	type StreamOptions,
	type Transport,
} from "@mariozechner/pi-ai";
import {
	closeOpenAICodexWebSocketSessions,
	streamOpenAICodexResponses,
	streamSimpleOpenAICodexResponses,
} from "@mariozechner/pi-ai/openai-codex-responses";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1_000;
const RETRY_TRANSPORT: Transport = "sse";

const RECOVERABLE_CLOSE_CODES = new Set([1005, 1006, 1011, 1012, 1013, 1015]);

const RECOVERABLE_ERROR_PATTERNS = [
	/websocket closed\s+(1005|1006|1011|1012|1013|1015)\b/i,
	/websocket.*connection.*failed/i,
	/websocket.*failed.*connect/i,
	/connection ended/i,
	/connection closed before response/i,
	/stream closed before response\.completed/i,
	/websocket.*before response\.completed/i,
	/fetch failed/i,
	/network error/i,
	/socket hang up/i,
	/timed? out/i,
	/timeout/i,
	/\b502\b/,
	/\b503\b/,
	/\b504\b/,
];

type CodexStream<TOptions extends StreamOptions = StreamOptions> =
	StreamFunction<"openai-codex-responses", TOptions>;

export interface CodexRetryOptions {
	maxAttempts?: number;
	baseDelayMs?: number;
	retryTransport?: Transport;
	streamCodex?: CodexStream;
	closeWebSocketSessions?: (sessionId?: string) => void;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		if (!signal) return;
		const abort = () => {
			clearTimeout(timer);
			reject(new Error("Request was aborted"));
		};
		signal.addEventListener("abort", abort, { once: true });
	});
}

function diagnosticText(message: AssistantMessage): string {
	const diagnostics = message.diagnostics
		? JSON.stringify(message.diagnostics)
		: "";
	return `${message.errorMessage ?? ""}\n${diagnostics}`;
}

export function isRecoverableCodexTransportFailure(
	message: AssistantMessage | undefined,
): boolean {
	if (!message || message.stopReason !== "error") return false;
	const text = diagnosticText(message);
	if (/request was aborted/i.test(text)) return false;
	if (RECOVERABLE_ERROR_PATTERNS.some((pattern) => pattern.test(text)))
		return true;

	for (const diagnostic of message.diagnostics ?? []) {
		if (diagnostic.type !== "provider_transport_failure") continue;
		const error = diagnostic.error as
			| { code?: unknown; message?: unknown }
			| undefined;
		if (
			typeof error?.code === "number" &&
			RECOVERABLE_CLOSE_CODES.has(error.code)
		)
			return true;
		const errorMessage = error?.message;
		if (
			typeof errorMessage === "string" &&
			RECOVERABLE_ERROR_PATTERNS.some((pattern) => pattern.test(errorMessage))
		) {
			return true;
		}
	}

	return false;
}

function pushFinalError(
	stream: AssistantMessageEventStream,
	error: AssistantMessage,
): void {
	const reason = error.stopReason === "aborted" ? "aborted" : "error";
	stream.push({ type: "error", reason, error });
	stream.end(error);
}

function isToolCallEvent(event: AssistantMessageEvent): boolean {
	return (
		event.type === "toolcall_start" ||
		event.type === "toolcall_delta" ||
		event.type === "toolcall_end"
	);
}

function retryDelay(baseDelayMs: number, attemptIndex: number): number {
	return baseDelayMs * 2 ** Math.max(0, attemptIndex - 1);
}

export function createCodexRetryStream(
	model: Model<"openai-codex-responses">,
	context: Context,
	options: StreamOptions | undefined,
	retryOptions: CodexRetryOptions = {},
): AssistantMessageEventStream {
	return createRetryingStream(model, context, options, {
		...retryOptions,
		streamCodex: retryOptions.streamCodex ?? streamOpenAICodexResponses,
	});
}

export function createCodexRetrySimpleStream(
	model: Model<"openai-codex-responses">,
	context: Context,
	options: SimpleStreamOptions | undefined,
	retryOptions: CodexRetryOptions = {},
): AssistantMessageEventStream {
	return createRetryingStream(model, context, options, {
		...retryOptions,
		streamCodex: retryOptions.streamCodex ?? streamSimpleOpenAICodexResponses,
	});
}

function createRetryingStream(
	model: Model<"openai-codex-responses">,
	context: Context,
	options: StreamOptions | undefined,
	retryOptions: CodexRetryOptions,
): AssistantMessageEventStream {
	const output = createAssistantMessageEventStream();
	const maxAttempts = Math.max(
		1,
		Math.trunc(retryOptions.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
	);
	const baseDelayMs = Math.max(
		0,
		Math.trunc(retryOptions.baseDelayMs ?? DEFAULT_BASE_DELAY_MS),
	);
	const retryTransport = retryOptions.retryTransport ?? RETRY_TRANSPORT;
	const streamCodex = retryOptions.streamCodex ?? streamOpenAICodexResponses;
	const closeWebSocketSessions =
		retryOptions.closeWebSocketSessions ?? closeOpenAICodexWebSocketSessions;

	void (async () => {
		let lastError: AssistantMessage | undefined;
		let outputStarted = false;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			let sawToolCall = false;
			let attemptError: AssistantMessage | undefined;
			const attemptOptions: StreamOptions =
				attempt === 1
					? { ...options }
					: { ...options, transport: retryTransport };

			try {
				const attemptStream = streamCodex(model, context, attemptOptions);
				for await (const event of attemptStream) {
					if (isToolCallEvent(event)) sawToolCall = true;
					if (event.type === "error") {
						attemptError = event.error;
						break;
					}
					if (event.type === "start") {
						if (outputStarted) continue;
						outputStarted = true;
					}
					output.push(event);
					if (event.type === "done") {
						output.end(event.message);
						return;
					}
				}
			} catch (error) {
				attemptError = makeErrorMessage(model, error);
			}

			const recoverable = isRecoverableCodexTransportFailure(attemptError);
			lastError =
				sawToolCall && recoverable && attemptError
					? suppressUnsafeToolCallRetry(attemptError)
					: attemptError;
			const shouldRetry =
				attempt < maxAttempts &&
				!sawToolCall &&
				recoverable &&
				options?.signal?.aborted !== true;

			if (!shouldRetry) break;

			closeWebSocketSessions(options?.sessionId);
			try {
				await sleep(retryDelay(baseDelayMs, attempt), options?.signal);
			} catch (error) {
				pushFinalError(output, makeErrorMessage(model, error));
				return;
			}
		}

		pushFinalError(
			output,
			lastError ??
				makeErrorMessage(
					model,
					"OpenAI Codex retry stream ended without a result.",
				),
		);
	})();

	return output;
}

function suppressUnsafeToolCallRetry(
	message: AssistantMessage,
): AssistantMessage {
	return {
		...message,
		errorMessage:
			"Codex transport failed after a tool-call event. Automatic retry was suppressed to avoid duplicating tool side effects. Inspect provider diagnostics in the session JSONL for the original transport error.",
	};
}

function makeErrorMessage(
	model: Model<"openai-codex-responses">,
	error: unknown,
): AssistantMessage {
	const errorMessage = error instanceof Error ? error.message : String(error);
	const stopReason = /request was aborted/i.test(errorMessage)
		? "aborted"
		: "error";
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		errorMessage,
		timestamp: Date.now(),
	};
}
