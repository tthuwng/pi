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

export type AgentSessionStatus =
	| "queued"
	| "running"
	| "idle"
	| "completed"
	| "failed"
	| "cancelled"
	| "detached";

export type AgentSessionEventType =
	| "started"
	| "tool"
	| "message"
	| "queued"
	| "completed"
	| "cancelled"
	| "detached"
	| "error"
	| "status";

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

export interface AgentTeamTaskMemberSession {
	memberId: string;
	sessionId: string;
}

export interface AgentTeamTask {
	id: string;
	text: string;
	status: AgentTeamTaskStatus;
	createdAt: string;
	updatedAt: string;
	requestId?: string;
	memberSessions?: AgentTeamTaskMemberSession[];
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

export interface AgentSessionEventRecord {
	at: string;
	type: AgentSessionEventType;
	text?: string;
	details?: unknown;
}

export interface AgentSessionRecord {
	id: string;
	title: string;
	cwd: string;
	status: AgentSessionStatus;
	createdAt: string;
	updatedAt: string;
	agentName?: string;
	teamId?: string;
	taskId?: string;
	memberId?: string;
	sessionId?: string;
	sessionFile?: string;
	prompt?: string;
	resultText?: string;
	errorText?: string;
	events?: AgentSessionEventRecord[];
}

export interface AgentViewState {
	version: 1;
	teams: AgentTeam[];
	sessions: AgentSessionRecord[];
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
	memberSessions?: AgentTeamTaskMemberSession[];
	resultText?: string;
	errorText?: string;
	event?: Omit<AgentTeamTaskEvent, "at"> & { at?: string };
}

export interface CreateAgentSessionRecordInput {
	title: string;
	cwd: string;
	status?: AgentSessionStatus;
	agentName?: string;
	teamId?: string;
	taskId?: string;
	memberId?: string;
	sessionId?: string;
	sessionFile?: string;
	prompt?: string;
	resultText?: string;
	errorText?: string;
}

export interface UpdateAgentSessionRecordInput {
	status?: AgentSessionStatus;
	sessionId?: string;
	sessionFile?: string;
	resultText?: string;
	errorText?: string;
	event?: Omit<AgentSessionEventRecord, "at"> & { at?: string };
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,80}$/;
const AGENT_SESSION_STATUSES = new Set<AgentSessionStatus>([
	"queued",
	"running",
	"idle",
	"completed",
	"failed",
	"cancelled",
	"detached",
]);
const ACTIVE_SESSION_STATUSES = new Set<AgentSessionStatus>([
	"queued",
	"running",
	"idle",
]);

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
	return { version: 1, teams: [], sessions: [] };
}

function assertId(id: string): void {
	if (!ID_PATTERN.test(id)) throw new Error(`Invalid agent view id: ${id}`);
}

function assertAgentSessionStatus(status: AgentSessionStatus): void {
	if (!AGENT_SESSION_STATUSES.has(status)) {
		throw new Error(`Invalid agent session status: ${String(status)}`);
	}
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
	const parsed = JSON.parse(
		fs.readFileSync(storePath, "utf-8"),
	) as Partial<AgentViewState>;
	return {
		version: 1,
		teams: Array.isArray(parsed.teams) ? parsed.teams : [],
		sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
	};
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

export function findAgentSessionRecord(
	state: AgentViewState,
	sessionRecordId: string,
): AgentSessionRecord | undefined {
	assertId(sessionRecordId);
	return state.sessions.find((candidate) => candidate.id === sessionRecordId);
}

function requireAgentSessionRecord(
	state: AgentViewState,
	sessionRecordId: string,
): AgentSessionRecord {
	const session = findAgentSessionRecord(state, sessionRecordId);
	if (!session) throw new Error(`Unknown agent session: ${sessionRecordId}`);
	return session;
}

function syncMemberTaskStatus(
	team: AgentTeam,
	taskId: string,
	status: AgentTeamTaskStatus,
): void {
	if (status === "queued") return;
	const runningTaskIds = new Set<string>();
	for (const task of team.tasks) {
		if (task.id !== taskId && task.status === "running") {
			runningTaskIds.add(task.id);
		}
	}
	for (const member of team.members) {
		const memberRunningAnotherTask =
			member.lastTaskId !== undefined && runningTaskIds.has(member.lastTaskId);
		if (memberRunningAnotherTask && status !== "running") continue;
		member.status = status;
		member.lastTaskId = taskId;
	}
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
	if (input.status !== undefined) {
		task.status = input.status;
		syncMemberTaskStatus(team, task.id, input.status);
	}
	if (input.requestId !== undefined) task.requestId = input.requestId;
	if (input.memberSessions !== undefined)
		task.memberSessions = input.memberSessions;
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

export function createAgentSessionRecord(
	storePath: string,
	input: CreateAgentSessionRecordInput,
): AgentSessionRecord {
	const title = input.title.trim();
	const cwd = input.cwd.trim();
	if (!title) throw new Error("Agent session title is required.");
	if (!cwd) throw new Error("Agent session cwd is required.");
	const status = input.status ?? "queued";
	assertAgentSessionStatus(status);
	for (const id of [input.teamId, input.taskId, input.memberId]) {
		if (id !== undefined) assertId(id);
	}
	const state = readAgentViewState(storePath);
	const now = timestamp();
	const session: AgentSessionRecord = {
		id: generatedId("session"),
		title,
		cwd,
		status,
		createdAt: now,
		updatedAt: now,
		...(input.agentName?.trim() ? { agentName: input.agentName.trim() } : {}),
		...(input.teamId !== undefined ? { teamId: input.teamId } : {}),
		...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
		...(input.memberId !== undefined ? { memberId: input.memberId } : {}),
		...(input.sessionId?.trim() ? { sessionId: input.sessionId.trim() } : {}),
		...(input.sessionFile?.trim()
			? { sessionFile: input.sessionFile.trim() }
			: {}),
		...(input.prompt?.trim() ? { prompt: input.prompt.trim() } : {}),
		...(input.resultText !== undefined ? { resultText: input.resultText } : {}),
		...(input.errorText !== undefined ? { errorText: input.errorText } : {}),
	};
	state.sessions.push(session);
	writeAgentViewState(storePath, state);
	return session;
}

export function updateAgentSessionRecord(
	storePath: string,
	sessionRecordId: string,
	input: UpdateAgentSessionRecordInput,
): AgentSessionRecord {
	const state = readAgentViewState(storePath);
	const session = requireAgentSessionRecord(state, sessionRecordId);
	const now = timestamp();
	if (input.status !== undefined) {
		assertAgentSessionStatus(input.status);
		session.status = input.status;
	}
	if (input.sessionId !== undefined) session.sessionId = input.sessionId;
	if (input.sessionFile !== undefined) session.sessionFile = input.sessionFile;
	if (input.resultText !== undefined) session.resultText = input.resultText;
	if (input.errorText !== undefined) session.errorText = input.errorText;
	if (input.event) {
		session.events = [
			...(session.events ?? []),
			{ ...input.event, at: input.event.at ?? now },
		].slice(-50);
	}
	session.updatedAt = now;
	writeAgentViewState(storePath, state);
	return session;
}

export function appendAgentSessionEvent(
	storePath: string,
	sessionRecordId: string,
	event: Omit<AgentSessionEventRecord, "at"> & { at?: string },
): AgentSessionRecord {
	return updateAgentSessionRecord(storePath, sessionRecordId, { event });
}

export function reconcileDetachedAgentSessions(
	storePath: string,
): AgentViewState {
	const state = readAgentViewState(storePath);
	const now = timestamp();
	let changed = false;
	for (const session of state.sessions) {
		if (!ACTIVE_SESSION_STATUSES.has(session.status)) continue;
		const event: AgentSessionEventRecord = {
			type: "detached",
			text: "Session detached during startup reconciliation.",
			at: now,
		};
		session.status = "detached";
		session.updatedAt = now;
		session.events = [...(session.events ?? []), event].slice(-50);
		changed = true;
	}
	if (changed) writeAgentViewState(storePath, state);
	return state;
}
