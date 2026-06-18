import { randomUUID } from "node:crypto";

export const DYNAMIC_WORKFLOW_RESULT_TYPE = "dynamic-workflow-result";

const REQUEST_EVENT = "subagent:slash:request";
const STARTED_EVENT = "subagent:slash:started";
const RESPONSE_EVENT = "subagent:slash:response";
const UPDATE_EVENT = "subagent:slash:update";
const CANCEL_EVENT = "subagent:slash:cancel";

interface EventBus {
	on(event: string, handler: (payload: unknown) => void): (() => void) | void;
	emit(event: string, payload: unknown): void;
}

interface MessageSink {
	sendMessage?(message: unknown): void;
	events?: EventBus;
}

interface UiLike {
	notify?(message: string, type?: "info" | "warning" | "error"): void;
	setStatus?(key: string, value: string | undefined): void;
}

interface ContextLike {
	hasUI?: boolean;
	ui?: UiLike;
}

interface BridgeResponse {
	requestId: string;
	isError?: boolean;
	errorText?: string;
	result?: { content?: Array<{ type?: string; text?: string }> };
}

function requestIdOf(payload: unknown): string | undefined {
	return payload && typeof payload === "object"
		? ((payload as { requestId?: unknown }).requestId as string | undefined)
		: undefined;
}

function responseText(response: BridgeResponse): string {
	if (response.errorText) return response.errorText;
	const content = response.result?.content ?? [];
	return (
		content
			.filter(
				(part): part is { type: string; text: string } =>
					part.type === "text" && typeof part.text === "string",
			)
			.map((part) => part.text)
			.join("\n") || "(no output)"
	);
}

function sendWorkflowMessage(
	pi: MessageSink,
	title: string,
	body: string,
): void {
	pi.sendMessage?.({
		customType: DYNAMIC_WORKFLOW_RESULT_TYPE,
		display: true,
		content: `## ${title}\n\n${body}`,
	});
}

function updateToolStatus(
	ctx: ContextLike,
	workflowName: string,
	payload: unknown,
): void {
	if (!payload || typeof payload !== "object") return;
	const toolCount = (payload as { toolCount?: unknown }).toolCount;
	const currentTool = (payload as { currentTool?: unknown }).currentTool;
	const count = typeof toolCount === "number" ? toolCount : 0;
	const toolText = typeof currentTool === "string" ? ` ${currentTool}` : "";
	ctx.ui?.setStatus?.(
		"dynamic-workflows",
		`${workflowName}: ${count} tools${toolText}`,
	);
}

export interface BridgeDispatchOptions {
	timeoutMs?: number;
	onRequest?(requestId: string): void;
	onUpdate?(payload: unknown): void;
}

interface AwaitBridgeInput {
	events: EventBus;
	pi: MessageSink;
	ctx: ContextLike;
	workflowName: string;
	requestId: string;
	params: unknown;
	timeoutMs: number;
	onUpdate?: (payload: unknown) => void;
}

function awaitBridgeResponse(input: AwaitBridgeInput): Promise<BridgeResponse> {
	return new Promise((resolve, reject) => {
		let done = false;
		let started = false;
		const cleanups: Array<() => void> = [];
		const subscribe = (
			event: string,
			handler: (payload: unknown) => void,
		): void => {
			const unsubscribe = input.events.on(event, handler);
			if (typeof unsubscribe === "function") cleanups.push(unsubscribe);
		};
		const finish = (next: () => void): void => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			cleanups.forEach((cleanup) => cleanup());
			input.ctx.ui?.setStatus?.("dynamic-workflows", undefined);
			next();
		};
		const timer = setTimeout(() => {
			const message = started
				? `Dynamic workflow '${input.workflowName}' timed out waiting for subagent response.`
				: "No pi-subagents bridge responded. Install/enable pi-subagents before running dynamic workflows.";
			finish(() => reject(new Error(message)));
		}, input.timeoutMs);

		subscribe(STARTED_EVENT, (payload) => {
			if (requestIdOf(payload) === input.requestId) started = true;
		});
		subscribe(UPDATE_EVENT, (payload) => {
			if (requestIdOf(payload) !== input.requestId) return;
			updateToolStatus(input.ctx, input.workflowName, payload);
			input.onUpdate?.(payload);
		});
		subscribe(RESPONSE_EVENT, (payload) => {
			if (requestIdOf(payload) !== input.requestId) return;
			const response = payload as BridgeResponse;
			sendWorkflowMessage(
				input.pi,
				`Dynamic workflow result: ${input.workflowName}`,
				responseText(response),
			);
			finish(() => resolve(response));
		});

		input.events.emit(REQUEST_EVENT, {
			requestId: input.requestId,
			params: input.params,
		});
	});
}

export async function dispatchSubagentWorkflow(
	pi: MessageSink,
	ctx: ContextLike,
	workflowName: string,
	params: unknown,
	options: BridgeDispatchOptions | number = {},
): Promise<BridgeResponse> {
	const events = pi.events;
	if (!events)
		throw new Error("pi-subagents bridge is unavailable: event bus missing.");

	const dispatchOptions =
		typeof options === "number" ? { timeoutMs: options } : options;
	const requestId = randomUUID();
	dispatchOptions.onRequest?.(requestId);
	ctx.ui?.setStatus?.("dynamic-workflows", `running ${workflowName}...`);
	sendWorkflowMessage(pi, "Dynamic workflow", `Running \`${workflowName}\`...`);

	return await awaitBridgeResponse({
		events,
		pi,
		ctx,
		workflowName,
		requestId,
		params,
		timeoutMs: dispatchOptions.timeoutMs ?? 15_000,
		...(dispatchOptions.onUpdate ? { onUpdate: dispatchOptions.onUpdate } : {}),
	});
}

export function cancelSubagentWorkflow(
	pi: MessageSink,
	requestId: string,
): void {
	pi.events?.emit(CANCEL_EVENT, { requestId });
}
