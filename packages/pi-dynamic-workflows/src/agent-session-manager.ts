import type {
	AgentRuntimeFactory,
	AgentSessionEventLike,
	ManagedAgentRuntime,
	ManagedAgentSession,
} from "./agent-session-types.js";
import {
	appendAgentSessionEvent,
	createAgentSessionRecord,
	readAgentViewState,
	updateAgentSessionRecord,
	type AgentSessionRecord,
	type AgentSessionStatus,
} from "./agent-view-store.js";

export interface StartAgentSessionInput {
	title: string;
	prompt: string;
	cwd: string;
	agentName?: string;
	teamId?: string;
	taskId?: string;
	memberId?: string;
	completeOnPromptEnd?: boolean;
}

export type ReplyMode = "auto" | "steer" | "follow-up";

export interface AgentSessionManagerOptions {
	storePath: string;
	runtimeFactory: AgentRuntimeFactory;
}

interface ActiveAgentSession {
	recordId: string;
	runtime: ManagedAgentRuntime;
	session: ManagedAgentSession;
	completeOnPromptEnd: boolean;
	unsubscribe?: () => void;
	lastText?: string;
}

type MappedSessionEvent =
	| {
			type: "started" | "tool" | "message" | "status";
			text?: string;
			details?: unknown;
	  }
	| {
			type: "error";
			text?: string;
			details?: unknown;
	  };

const TERMINAL_STATUSES = new Set<AgentSessionStatus>([
	"completed",
	"failed",
	"cancelled",
	"detached",
]);

export class AgentSessionManager {
	private readonly active = new Map<string, ActiveAgentSession>();
	private readonly completions = new Map<string, Promise<AgentSessionRecord>>();
	private readonly completionResolvers = new Map<
		string,
		(record: AgentSessionRecord) => void
	>();

	constructor(private readonly options: AgentSessionManagerOptions) {}

	async startAgentSession(
		input: StartAgentSessionInput,
	): Promise<AgentSessionRecord> {
		const prompt = input.prompt.trim();
		if (!prompt) throw new Error("Agent session prompt is required.");
		const record = createAgentSessionRecord(this.options.storePath, {
			title: input.title,
			cwd: input.cwd,
			agentName: input.agentName,
			teamId: input.teamId,
			taskId: input.taskId,
			memberId: input.memberId,
			prompt,
		});
		const completion = new Promise<AgentSessionRecord>((resolve) => {
			this.completionResolvers.set(record.id, resolve);
		});
		this.completions.set(record.id, completion);
		void completion.finally(() => {
			this.completions.delete(record.id);
			this.completionResolvers.delete(record.id);
		});
		void this.startRuntime(record, prompt, input.completeOnPromptEnd ?? false);
		return record;
	}

	async waitForAgentSession(
		sessionRecordId: string,
	): Promise<AgentSessionRecord> {
		const completion = this.completions.get(sessionRecordId);
		if (completion) return completion;
		const stored = readAgentViewState(this.options.storePath).sessions.find(
			(session) => session.id === sessionRecordId,
		);
		if (!stored) throw new Error(`Unknown agent session: ${sessionRecordId}`);
		return stored;
	}

	async replyToAgentSession(
		sessionRecordId: string,
		text: string,
		mode: ReplyMode = "auto",
	): Promise<void> {
		const message = text.trim();
		if (!message) throw new Error("Agent session reply text is required.");
		const active = this.requireActive(sessionRecordId);
		if (mode === "steer") {
			await active.session.steer(message);
			this.appendQueueEvent(sessionRecordId, "Steered session.", message);
			return;
		}
		if (mode === "follow-up" || active.session.isStreaming) {
			await active.session.followUp(message);
			this.appendQueueEvent(sessionRecordId, "Queued follow-up.", message);
			return;
		}
		void this.runPrompt(active, message);
	}

	async stopAgentSession(
		sessionRecordId: string,
		reason = "Agent session stopped.",
	): Promise<void> {
		const active = this.active.get(sessionRecordId);
		if (!active) {
			const stored = readAgentViewState(this.options.storePath).sessions.find(
				(session) => session.id === sessionRecordId,
			);
			if (!stored) throw new Error(`Unknown agent session: ${sessionRecordId}`);
			if (TERMINAL_STATUSES.has(stored.status)) return;
			const cancelled = updateAgentSessionRecord(
				this.options.storePath,
				sessionRecordId,
				{
					status: "cancelled",
					event: { type: "cancelled", text: reason },
				},
			);
			this.resolveCompletion(sessionRecordId, cancelled);
			return;
		}
		active.unsubscribe?.();
		try {
			await active.session.abort();
		} finally {
			await this.disposeActive(active);
			this.active.delete(sessionRecordId);
			const stored = updateAgentSessionRecord(
				this.options.storePath,
				sessionRecordId,
				{
					status: "cancelled",
					event: { type: "cancelled", text: reason },
				},
			);
			this.resolveCompletion(sessionRecordId, stored);
		}
	}

	async disposeAllAgentSessions(
		reason = "Agent session manager disposed.",
	): Promise<void> {
		const activeSessions = [...this.active.values()];
		this.active.clear();
		await Promise.all(
			activeSessions.map(async (active) => {
				active.unsubscribe?.();
				await this.disposeActive(active);
				const stored = readAgentViewState(this.options.storePath).sessions.find(
					(session) => session.id === active.recordId,
				);
				if (stored && !TERMINAL_STATUSES.has(stored.status)) {
					const detached = updateAgentSessionRecord(
						this.options.storePath,
						active.recordId,
						{
							status: "detached",
							event: { type: "detached", text: reason },
						},
					);
					this.resolveCompletion(active.recordId, detached);
				}
			}),
		);
	}

	listLiveSessionIds(): string[] {
		return [...this.active.keys()];
	}

	private async startRuntime(
		record: AgentSessionRecord,
		prompt: string,
		completeOnPromptEnd: boolean,
	): Promise<void> {
		let active: ActiveAgentSession | undefined;
		try {
			const runtime = await this.options.runtimeFactory({
				cwd: record.cwd,
				sessionStartEvent: { type: "session_start", reason: "startup" },
			});
			active = {
				recordId: record.id,
				runtime,
				session: runtime.session,
				completeOnPromptEnd,
			};
			active.unsubscribe = runtime.session.subscribe((event) => {
				this.handleSessionEvent(active as ActiveAgentSession, event);
			});
			this.active.set(record.id, active);
			updateAgentSessionRecord(this.options.storePath, record.id, {
				status: "running",
				sessionId: runtime.session.sessionId,
				sessionFile: runtime.session.sessionFile,
				event: { type: "started", text: "Agent session started." },
			});
			await this.runPrompt(active, prompt);
		} catch (error) {
			this.active.delete(record.id);
			if (active) await this.disposeActive(active);
			const failed = updateAgentSessionRecord(
				this.options.storePath,
				record.id,
				{
					status: "failed",
					errorText: errorMessage(error),
					event: { type: "error", text: errorMessage(error) },
				},
			);
			this.resolveCompletion(record.id, failed);
		}
	}

	private async runPrompt(
		active: ActiveAgentSession,
		prompt: string,
	): Promise<void> {
		try {
			updateAgentSessionRecord(this.options.storePath, active.recordId, {
				status: "running",
				event: { type: "queued", text: prompt },
			});
			await active.session.prompt(prompt, { source: "extension" });
			this.completePrompt(active);
		} catch (error) {
			const stored = readAgentViewState(this.options.storePath).sessions.find(
				(session) => session.id === active.recordId,
			);
			if (stored && TERMINAL_STATUSES.has(stored.status)) return;
			this.active.delete(active.recordId);
			await this.disposeActive(active);
			const failed = updateAgentSessionRecord(
				this.options.storePath,
				active.recordId,
				{
					status: "failed",
					errorText: errorMessage(error),
					event: { type: "error", text: errorMessage(error) },
				},
			);
			this.resolveCompletion(active.recordId, failed);
		}
	}

	private completePrompt(active: ActiveAgentSession): void {
		const stored = readAgentViewState(this.options.storePath).sessions.find(
			(session) => session.id === active.recordId,
		);
		if (!stored || TERMINAL_STATUSES.has(stored.status)) return;
		const status: AgentSessionStatus = active.completeOnPromptEnd
			? "completed"
			: "idle";
		const completed = updateAgentSessionRecord(
			this.options.storePath,
			active.recordId,
			{
				status,
				...(active.lastText !== undefined
					? { resultText: active.lastText }
					: {}),
				event: {
					type: status === "completed" ? "completed" : "status",
					text:
						status === "completed"
							? "Agent session completed."
							: "Agent session idle.",
				},
			},
		);
		this.resolveCompletion(active.recordId, completed);
		if (status === "completed") {
			this.active.delete(active.recordId);
			void this.disposeActive(active);
		}
	}

	private handleSessionEvent(
		active: ActiveAgentSession,
		event: AgentSessionEventLike,
	): void {
		const mapped = mapSessionEvent(event);
		if (!mapped) return;
		if (mapped.type === "error") {
			this.failActiveSession(active, mapped.text ?? "Agent session failed.", mapped);
			return;
		}
		if (mapped.type === "message" && mapped.text !== undefined) {
			active.lastText = mapped.text;
		}
		appendAgentSessionEvent(this.options.storePath, active.recordId, mapped);
	}

	private failActiveSession(
		active: ActiveAgentSession,
		message: string,
		event: {
			type: "error";
			text?: string;
			details?: unknown;
		},
	): void {
		const stored = readAgentViewState(this.options.storePath).sessions.find(
			(session) => session.id === active.recordId,
		);
		if (!stored || TERMINAL_STATUSES.has(stored.status)) return;
		this.active.delete(active.recordId);
		const failed = updateAgentSessionRecord(
			this.options.storePath,
			active.recordId,
			{
				status: "failed",
				errorText: message,
				event,
			},
		);
		this.resolveCompletion(active.recordId, failed);
		void this.disposeActive(active);
	}

	private appendQueueEvent(
		sessionRecordId: string,
		summary: string,
		message: string,
	): void {
		appendAgentSessionEvent(this.options.storePath, sessionRecordId, {
			type: "queued",
			text: summary,
			details: { message },
		});
	}

	private requireActive(sessionRecordId: string): ActiveAgentSession {
		const active = this.active.get(sessionRecordId);
		if (!active)
			throw new Error(`Agent session is not active: ${sessionRecordId}`);
		return active;
	}

	private resolveCompletion(
		sessionRecordId: string,
		record: AgentSessionRecord,
	): void {
		this.completionResolvers.get(sessionRecordId)?.(record);
	}

	private async disposeActive(active: ActiveAgentSession): Promise<void> {
		active.unsubscribe?.();
		try {
			active.session.dispose();
		} finally {
			await active.runtime.dispose();
		}
	}
}

function mapSessionEvent(
	event: AgentSessionEventLike,
): MappedSessionEvent | undefined {
	if (event.type === "agent_start") {
		return { type: "started", text: "Agent turn started." };
	}
	const agentError = extractAgentError(event);
	if (agentError) {
		return { type: "error", text: agentError, details: event };
	}
	if (event.type === "agent_end") {
		return { type: "message", text: extractText(event), details: event };
	}
	if (event.type === "message_update" || event.type === "message_end") {
		return { type: "message", text: extractText(event), details: event };
	}
	if (event.type.includes("tool")) {
		return { type: "tool", text: extractText(event), details: event };
	}
	if (event.type === "queue_update") {
		return { type: "status", text: extractText(event), details: event };
	}
	return undefined;
}

function extractText(event: AgentSessionEventLike): string | undefined {
	const direct = extractStringFields(event);
	if (direct) return direct;
	const messageText = textFromMessage(event.message);
	if (messageText) return messageText;
	const messages = event.messages;
	if (Array.isArray(messages)) {
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const text = textFromMessage(messages[index]);
			if (text) return text;
		}
	}
	return undefined;
}

function extractStringFields(event: AgentSessionEventLike): string | undefined {
	for (const key of ["text", "summary", "name", "toolName"]) {
		const value = event[key];
		if (typeof value === "string" && value.trim())
			return truncate(value.trim());
	}
	return undefined;
}

function extractAgentError(event: AgentSessionEventLike): string | undefined {
	const messageError = errorFromMessage(event.message);
	if (messageError) return messageError;
	const messages = event.messages;
	if (Array.isArray(messages)) {
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const error = errorFromMessage(messages[index]);
			if (error) return error;
		}
	}
	return undefined;
}

function errorFromMessage(message: unknown): string | undefined {
	if (!message || typeof message !== "object") return undefined;
	const role = (message as { role?: unknown }).role;
	if (role !== "assistant") return undefined;
	const error = (message as { errorMessage?: unknown }).errorMessage;
	if (typeof error === "string" && error.trim()) return truncate(error.trim());
	const stopReason = (message as { stopReason?: unknown }).stopReason;
	return stopReason === "error" ? "Agent session failed." : undefined;
}

function textFromMessage(message: unknown): string | undefined {
	if (!message || typeof message !== "object") return undefined;
	const role = (message as { role?: unknown }).role;
	if (role !== "assistant") return undefined;
	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) return undefined;
	const text = content
		.map((part) => {
			if (!part || typeof part !== "object") return "";
			const type = (part as { type?: unknown }).type;
			const value = (part as { text?: unknown }).text;
			return type === "text" && typeof value === "string" ? value : "";
		})
		.join("")
		.trim();
	return text ? truncate(text) : undefined;
}

function truncate(text: string): string {
	return text.length > 1_000 ? `${text.slice(0, 997)}...` : text;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
