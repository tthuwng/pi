import type { StartAgentSessionInput } from "./agent-session-manager.js";
import {
	addTeamTask,
	readAgentViewState,
	updateTeamTask,
	type AgentSessionRecord,
	type AgentTeam,
	type AgentTeamTask,
} from "./agent-view-store.js";

interface ContextLike {
	cwd: string;
	hasUI?: boolean;
}

export interface AgentTeamSessionRunner {
	startAgentSession(input: StartAgentSessionInput): Promise<AgentSessionRecord>;
	waitForAgentSession(sessionId: string): Promise<AgentSessionRecord>;
	stopAgentSession(sessionId: string, reason?: string): Promise<void>;
}

export interface RunAgentTeamTaskOptions {
	timeoutMs?: number;
}

export interface AgentTeamSessionPrompt {
	memberId: string;
	agent: string;
	label: string;
	prompt: string;
}

function teamPrompt(
	team: AgentTeam,
	memberId: string,
	memberAgent: string,
	taskText: string,
): string {
	return [
		`You are member \`${memberId}\` of agent team \`${team.name}\`.`,
		`Your configured agent role is \`${memberAgent}\`.`,
		"Complete only your assigned angle and report concise findings.",
		"",
		taskText,
	].join("\n");
}

export function buildAgentTeamSessionPrompts(
	team: AgentTeam,
	taskText: string,
): AgentTeamSessionPrompt[] {
	return team.members.map((member) => ({
		memberId: member.id,
		agent: member.agent,
		label: member.label ?? member.id,
		prompt: teamPrompt(team, member.id, member.agent, taskText),
	}));
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

function formatTeamResult(
	prompts: AgentTeamSessionPrompt[],
	results: AgentSessionRecord[],
): string {
	return results
		.map((result, index) => {
			const prompt = prompts[index];
			const heading = prompt
				? `${prompt.label} (${prompt.agent})`
				: result.title;
			const text = result.resultText ?? result.errorText ?? result.status;
			return `### ${heading}\n${text}`;
		})
		.join("\n\n");
}

function firstFailedResult(
	results: AgentSessionRecord[],
): AgentSessionRecord | undefined {
	return results.find((result) => result.status === "failed");
}

function firstCancelledResult(
	results: AgentSessionRecord[],
): AgentSessionRecord | undefined {
	return results.find(
		(result) => result.status === "cancelled" || result.status === "detached",
	);
}

export async function runAgentTeamTask(
	storePath: string,
	runner: AgentTeamSessionRunner,
	ctx: ContextLike,
	teamId: string,
	text: string,
	_options: RunAgentTeamTaskOptions = {},
): Promise<AgentTeamTask> {
	const team = findTeam(storePath, teamId);
	const task = addTeamTask(storePath, team.id, text);
	const prompts = buildAgentTeamSessionPrompts(team, task.text);
	try {
		updateTeamTask(storePath, team.id, task.id, {
			status: "running",
			event: { type: "started", text: "Team task started." },
		});
		const sessions = await Promise.all(
			prompts.map((prompt) =>
				runner.startAgentSession({
					title: `${team.name}: ${prompt.label}`,
					prompt: prompt.prompt,
					cwd: ctx.cwd,
					agentName: prompt.agent,
					teamId: team.id,
					taskId: task.id,
					memberId: prompt.memberId,
					completeOnPromptEnd: true,
				}),
			),
		);
		updateTeamTask(storePath, team.id, task.id, {
			memberSessions: sessions.map((session, index) => ({
				memberId: prompts[index]?.memberId ?? session.id,
				sessionId: session.id,
			})),
			event: {
				type: "message",
				text: `Started ${sessions.length} native member sessions.`,
			},
		});
		const results = await Promise.all(
			sessions.map((session) => runner.waitForAgentSession(session.id)),
		);
		const current = findTask(storePath, team.id, task.id);
		if (current.status === "cancelled") return current;
		const cancelled = firstCancelledResult(results);
		if (cancelled) {
			return updateTeamTask(storePath, team.id, task.id, {
				status: "cancelled",
				event: {
					type: "cancelled",
					text:
						cancelled.errorText ??
						cancelled.resultText ??
						"Team member cancelled.",
				},
			});
		}
		const failed = firstFailedResult(results);
		if (failed) {
			return updateTeamTask(storePath, team.id, task.id, {
				status: "failed",
				errorText:
					failed.errorText ?? failed.resultText ?? "Team member failed.",
				event: {
					type: "error",
					text: failed.errorText ?? failed.resultText ?? "Team member failed.",
				},
			});
		}
		return updateTeamTask(storePath, team.id, task.id, {
			status: "completed",
			resultText: formatTeamResult(prompts, results),
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

export async function cancelAgentTeamTask(
	storePath: string,
	runner: AgentTeamSessionRunner,
	teamId: string,
	taskId: string,
): Promise<AgentTeamTask> {
	const task = findTask(storePath, teamId, taskId);
	if (task.status === "cancelled") return task;
	if (task.status !== "running") {
		throw new Error(`Agent team task is not running: ${taskId}`);
	}
	if (!task.memberSessions?.length) {
		throw new Error(`Agent team task has no active member sessions: ${taskId}`);
	}
	await Promise.all(
		task.memberSessions.map((memberSession) =>
			runner.stopAgentSession(memberSession.sessionId, "Team task cancelled."),
		),
	);
	return updateTeamTask(storePath, teamId, taskId, {
		status: "cancelled",
		event: { type: "cancelled", text: "Team task cancelled." },
	});
}
