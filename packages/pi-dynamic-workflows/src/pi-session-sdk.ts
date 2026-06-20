import {
	SessionManager,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
} from "@mariozechner/pi-coding-agent";

import type {
	AgentRuntimeDiagnostic,
	AgentRuntimeFactory,
	ManagedAgentRuntime,
	ManagedAgentSession,
} from "./agent-session-types.js";

export interface CreateDefaultAgentRuntimeFactoryOptions {
	agentDir?: string;
}

export function createDefaultAgentRuntimeFactory(
	options: CreateDefaultAgentRuntimeFactoryOptions = {},
): AgentRuntimeFactory {
	const agentDir = options.agentDir ?? getAgentDir();
	return async ({ cwd, sessionStartEvent }): Promise<ManagedAgentRuntime> => {
		const sessionManager = SessionManager.create(cwd);
		const runtime = await createAgentSessionRuntime(
			async (runtimeOptions) => {
				const services = await createAgentSessionServices({
					cwd: runtimeOptions.cwd,
					agentDir: runtimeOptions.agentDir,
				});
				const result = await createAgentSessionFromServices({
					services,
					sessionManager: runtimeOptions.sessionManager,
					sessionStartEvent: runtimeOptions.sessionStartEvent,
				});
				return {
					...result,
					services,
					diagnostics: services.diagnostics,
				};
			},
			{
				cwd,
				agentDir,
				sessionManager,
				sessionStartEvent: sessionStartEvent ?? {
					type: "session_start",
					reason: "startup",
				},
			},
		);

		return {
			cwd: runtime.cwd,
			diagnostics: runtime.diagnostics as readonly AgentRuntimeDiagnostic[],
			session: adaptSession(runtime.session),
			dispose: () => runtime.dispose(),
		};
	};
}

function adaptSession(session: ManagedAgentSession): ManagedAgentSession {
	return {
		get sessionId() {
			return session.sessionId;
		},
		get sessionFile() {
			return session.sessionFile;
		},
		get isStreaming() {
			return session.isStreaming;
		},
		subscribe: (listener) => session.subscribe((event) => listener(event)),
		prompt: (text, promptOptions) => session.prompt(text, promptOptions),
		steer: (text) => session.steer(text),
		followUp: (text) => session.followUp(text),
		abort: () => session.abort(),
		dispose: () => session.dispose(),
	};
}
