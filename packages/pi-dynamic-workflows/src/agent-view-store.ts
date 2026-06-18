import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type AgentTeamMemberStatus =
	| "idle"
	| "running"
	| "completed"
	| "failed"
	| "cancelled";

export type AgentTeamTaskStatus =
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "cancelled";

export interface AgentTeamMember {
	id: string;
	agent: string;
	label?: string;
	status: AgentTeamMemberStatus;
	lastTaskId?: string;
}

export interface AgentTeamTaskEvent {
	at: string;
	type: "started" | "tool" | "message" | "cancelled" | "error";
	text?: string;
	details?: unknown;
}

export interface AgentTeamTask {
	id: string;
	text: string;
	status: AgentTeamTaskStatus;
	createdAt: string;
	updatedAt: string;
	requestId?: string;
	resultText?: string;
	errorText?: string;
	events?: AgentTeamTaskEvent[];
}

export interface AgentTeamMessage {
	id: string;
	targetId: string;
	text: string;
	createdAt: string;
}

export interface AgentTeam {
	id: string;
	name: string;
	members: AgentTeamMember[];
	tasks: AgentTeamTask[];
	messages: AgentTeamMessage[];
	createdAt: string;
	updatedAt: string;
}

export interface AgentViewState {
	version: 1;
	teams: AgentTeam[];
}

export interface CreateAgentViewTeamInput {
	name: string;
	members: Array<{ id: string; agent: string; label?: string }>;
}

export interface AddTeamMessageInput {
	targetId: string;
	text: string;
}

export interface UpdateTeamTaskInput {
	status?: AgentTeamTaskStatus;
	requestId?: string;
	resultText?: string;
	errorText?: string;
	event?: Omit<AgentTeamTaskEvent, "at"> & { at?: string };
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,80}$/;

export function defaultAgentViewStorePath(): string {
	return path.join(
		os.homedir(),
		".pi",
		"agent",
		"dynamic-workflows",
		"agent-view.json",
	);
}

function emptyState(): AgentViewState {
	return { version: 1, teams: [] };
}

function assertId(id: string): void {
	if (!ID_PATTERN.test(id)) throw new Error(`Invalid agent view id: ${id}`);
}

function slug(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "team"
	).slice(0, 81);
}

function timestamp(): string {
	return new Date().toISOString();
}

function generatedId(prefix: string): string {
	return `${prefix}-${randomUUID()}`;
}

function writeAgentViewState(storePath: string, state: AgentViewState): void {
	fs.mkdirSync(path.dirname(storePath), { recursive: true });
	const tempPath = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
	fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`);
	fs.renameSync(tempPath, storePath);
}

export function readAgentViewState(storePath: string): AgentViewState {
	if (!fs.existsSync(storePath)) return emptyState();
	return JSON.parse(fs.readFileSync(storePath, "utf-8")) as AgentViewState;
}

function findTeam(state: AgentViewState, teamId: string): AgentTeam {
	assertId(teamId);
	const team = state.teams.find((candidate) => candidate.id === teamId);
	if (!team) throw new Error(`Unknown agent team: ${teamId}`);
	return team;
}

function findTask(team: AgentTeam, taskId: string): AgentTeamTask {
	assertId(taskId);
	const task = team.tasks.find((candidate) => candidate.id === taskId);
	if (!task) throw new Error(`Unknown agent team task: ${taskId}`);
	return task;
}

export function createAgentViewTeam(
	storePath: string,
	input: CreateAgentViewTeamInput,
): AgentTeam {
	const name = input.name.trim();
	if (!name) throw new Error("Agent team name is required.");
	if (input.members.length === 0)
		throw new Error("Agent team requires at least one member.");
	const state = readAgentViewState(storePath);
	const id = slug(name);
	assertId(id);
	if (state.teams.some((team) => team.id === id)) {
		throw new Error(`Agent team already exists: ${id}`);
	}
	const now = timestamp();
	const team: AgentTeam = {
		id,
		name,
		members: input.members.map((member) => {
			assertId(member.id);
			if (!member.agent.trim())
				throw new Error("Agent team member agent is required.");
			return {
				id: member.id,
				agent: member.agent.trim(),
				...(member.label?.trim() ? { label: member.label.trim() } : {}),
				status: "idle",
			};
		}),
		tasks: [],
		messages: [],
		createdAt: now,
		updatedAt: now,
	};
	writeAgentViewState(storePath, { ...state, teams: [...state.teams, team] });
	return team;
}

export function addTeamTask(
	storePath: string,
	teamId: string,
	text: string,
): AgentTeamTask {
	const taskText = text.trim();
	if (!taskText) throw new Error("Agent team task text is required.");
	const state = readAgentViewState(storePath);
	const team = findTeam(state, teamId);
	const now = timestamp();
	const task: AgentTeamTask = {
		id: generatedId("task"),
		text: taskText,
		status: "queued",
		createdAt: now,
		updatedAt: now,
	};
	team.tasks.push(task);
	team.updatedAt = now;
	writeAgentViewState(storePath, state);
	return task;
}

export function updateTeamTask(
	storePath: string,
	teamId: string,
	taskId: string,
	input: UpdateTeamTaskInput,
): AgentTeamTask {
	const state = readAgentViewState(storePath);
	const team = findTeam(state, teamId);
	const task = findTask(team, taskId);
	const now = timestamp();
	if (input.status !== undefined) task.status = input.status;
	if (input.requestId !== undefined) task.requestId = input.requestId;
	if (input.resultText !== undefined) task.resultText = input.resultText;
	if (input.errorText !== undefined) task.errorText = input.errorText;
	if (input.event) {
		task.events = [
			...(task.events ?? []),
			{ ...input.event, at: input.event.at ?? now },
		].slice(-50);
	}
	task.updatedAt = now;
	team.updatedAt = now;
	writeAgentViewState(storePath, state);
	return task;
}

export function appendTeamMessage(
	storePath: string,
	teamId: string,
	input: AddTeamMessageInput,
): AgentTeamMessage {
	const text = input.text.trim();
	if (!text) throw new Error("Agent team message text is required.");
	assertId(input.targetId);
	const state = readAgentViewState(storePath);
	const team = findTeam(state, teamId);
	const now = timestamp();
	const message: AgentTeamMessage = {
		id: generatedId("message"),
		targetId: input.targetId,
		text,
		createdAt: now,
	};
	team.messages.push(message);
	team.updatedAt = now;
	writeAgentViewState(storePath, state);
	return message;
}
