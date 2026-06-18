import {
	cancelSubagentWorkflow,
	dispatchSubagentWorkflow,
} from "./subagents-bridge.js";
import {
	addTeamTask,
	readAgentViewState,
	updateTeamTask,
	type AgentTeam,
	type AgentTeamTask,
} from "./agent-view-store.js";

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

interface BridgeResponseLike {
	isError?: boolean;
	errorText?: string;
	result?: { content?: Array<{ type?: string; text?: string }> };
}

export interface RunAgentTeamTaskOptions {
	timeoutMs?: number;
}

export interface AgentTeamSubagentTask {
	agent: string;
	task: string;
	label: string;
}

export interface AgentTeamSubagentParams {
	tasks: AgentTeamSubagentTask[];
	concurrency: number;
	context: "fresh";
}

function responseText(response: BridgeResponseLike): string {
	if (response.errorText) return response.errorText;
	return (
		response.result?.content
			?.filter(
				(part): part is { type: string; text: string } =>
					part.type === "text" && typeof part.text === "string",
			)
			.map((part) => part.text)
			.join("\n") || ""
	);
}

function teamPrompt(team: AgentTeam, memberId: string, taskText: string): string {
	return [
		`You are member \`${memberId}\` of agent team \`${team.name}\`.`,
		"Complete only your assigned angle and report concise findings.",
		"",
		taskText,
	].join("\n");
}

export function buildAgentTeamSubagentParams(
	team: AgentTeam,
	taskText: string,
): AgentTeamSubagentParams {
	return {
		tasks: team.members.map((member) => ({
			agent: member.agent,
			label: member.label ?? member.id,
			task: teamPrompt(team, member.id, taskText),
		})),
		concurrency: team.members.length,
		context: "fresh",
	};
}

function findTeam(storePath: string, teamId: string): AgentTeam {
	const team = readAgentViewState(storePath).teams.find(
		(candidate) => candidate.id === teamId,
	);
	if (!team) throw new Error(`Unknown agent team: ${teamId}`);
	return team;
}

function findTask(
	storePath: string,
	teamId: string,
	taskId: string,
): AgentTeamTask {
	const task = findTeam(storePath, teamId).tasks.find(
		(candidate) => candidate.id === taskId,
	);
	if (!task) throw new Error(`Unknown agent team task: ${taskId}`);
	return task;
}

function bridgeUpdateText(payload: unknown): string {
	if (!payload || typeof payload !== "object") return "team update";
	const toolCount = (payload as { toolCount?: unknown }).toolCount;
	const currentTool = (payload as { currentTool?: unknown }).currentTool;
	const count = typeof toolCount === "number" ? `${toolCount} tools` : "tools";
	return typeof currentTool === "string" ? `${count} ${currentTool}` : count;
}

export async function runAgentTeamTask(
	storePath: string,
	pi: MessageSink,
	ctx: ContextLike,
	teamId: string,
	text: string,
	options: RunAgentTeamTaskOptions = {},
): Promise<AgentTeamTask> {
	const team = findTeam(storePath, teamId);
	const task = addTeamTask(storePath, team.id, text);
	const params = buildAgentTeamSubagentParams(team, task.text);
	try {
		const response = (await dispatchSubagentWorkflow(
			pi,
			ctx,
			`team:${team.name}`,
			params,
			{
				...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
				onRequest: (requestId) =>
					updateTeamTask(storePath, team.id, task.id, {
						status: "running",
						requestId,
						event: { type: "started", text: "Team task started." },
					}),
				onUpdate: (payload) =>
					updateTeamTask(storePath, team.id, task.id, {
						event: {
							type: "tool",
							text: bridgeUpdateText(payload),
							details: payload,
						},
					}),
			},
		)) as BridgeResponseLike;
		const current = findTask(storePath, team.id, task.id);
		if (current.status === "cancelled") return current;
		const textResult = responseText(response);
		return updateTeamTask(storePath, team.id, task.id, {
			status: response.isError ? "failed" : "completed",
			...(response.isError ? { errorText: textResult } : { resultText: textResult }),
		});
	} catch (error) {
		const current = findTask(storePath, team.id, task.id);
		if (current.status === "cancelled") return current;
		const message = error instanceof Error ? error.message : String(error);
		return updateTeamTask(storePath, team.id, task.id, {
			status: "failed",
			errorText: message,
			event: { type: "error", text: message },
		});
	}
}

export function cancelAgentTeamTask(
	storePath: string,
	pi: MessageSink,
	teamId: string,
	taskId: string,
): AgentTeamTask {
	const task = findTask(storePath, teamId, taskId);
	if (!task.requestId) {
		throw new Error(`Agent team task has no active request id: ${taskId}`);
	}
	cancelSubagentWorkflow(pi, task.requestId);
	return updateTeamTask(storePath, teamId, taskId, {
		status: "cancelled",
		event: { type: "cancelled", text: "Team task cancelled." },
	});
}
