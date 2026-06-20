export interface AgentRuntimeDiagnostic {
	type: "info" | "warning" | "error";
	message: string;
}

export type AgentSessionEventLike = {
	type: string;
	[key: string]: unknown;
};

export interface ManagedPromptOptions {
	source?: "interactive" | "rpc" | "extension";
}

export interface ManagedAgentSession {
	readonly sessionId: string;
	readonly sessionFile: string | undefined;
	readonly isStreaming: boolean;
	subscribe(listener: (event: AgentSessionEventLike) => void): () => void;
	prompt(text: string, options?: ManagedPromptOptions): Promise<void>;
	steer(text: string): Promise<void>;
	followUp(text: string): Promise<void>;
	abort(): Promise<void>;
	dispose(): void;
}

export interface ManagedAgentRuntime {
	readonly cwd: string;
	readonly session: ManagedAgentSession;
	readonly diagnostics: readonly AgentRuntimeDiagnostic[];
	dispose(): Promise<void>;
}

export interface AgentRuntimeFactoryOptions {
	cwd: string;
	sessionStartEvent?: {
		type: "session_start";
		reason: "startup" | "reload" | "new" | "resume" | "fork";
		previousSessionFile?: string;
	};
}

export type AgentRuntimeFactory = (
	options: AgentRuntimeFactoryOptions,
) => Promise<ManagedAgentRuntime>;
