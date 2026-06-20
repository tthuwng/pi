import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import {
	addTeamTask,
	appendAgentSessionEvent,
	appendTeamMessage,
	createAgentSessionRecord,
	createAgentViewTeam,
	findAgentSessionRecord,
	readAgentViewState,
	reconcileDetachedAgentSessions,
	updateAgentSessionRecord,
	updateTeamTask,
} from "../src/agent-view-store.js";

function tempStorePath(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-view-store-"));
	return path.join(root, "state.json");
}

test("agent view store returns an empty state by default", () => {
	assert.deepEqual(readAgentViewState(tempStorePath()), {
		version: 1,
		teams: [],
		sessions: [],
	});
});

test("agent view store reads older state files with no sessions", () => {
	const storePath = tempStorePath();
	fs.writeFileSync(storePath, `${JSON.stringify({ version: 1, teams: [] })}\n`);

	assert.deepEqual(readAgentViewState(storePath), {
		version: 1,
		teams: [],
		sessions: [],
	});
});

test("agent view store creates teams with members", () => {
	const storePath = tempStorePath();
	const team = createAgentViewTeam(storePath, {
		name: "Auth Audit",
		members: [
			{ id: "review", agent: "reviewer" },
			{ id: "tests", agent: "scout", label: "Test scout" },
		],
	});

	assert.equal(team.id, "auth-audit");
	assert.equal(team.members.length, 2);
	assert.deepEqual(
		team.members.map((member) => member.status),
		["idle", "idle"],
	);
	assert.deepEqual(
		readAgentViewState(storePath).teams.map((candidate) => candidate.name),
		["Auth Audit"],
	);
});

test("agent view store adds and updates team tasks", () => {
	const storePath = tempStorePath();
	const team = createAgentViewTeam(storePath, {
		name: "Release Gate",
		members: [{ id: "review", agent: "reviewer" }],
	});
	const task = addTeamTask(storePath, team.id, "review the release diff");

	assert.equal(task.status, "queued");
	assert.equal(task.text, "review the release diff");

	const updated = updateTeamTask(storePath, team.id, task.id, {
		status: "running",
		requestId: "request-1",
		event: { type: "started", text: "Team task started." },
	});

	assert.equal(updated.status, "running");
	assert.equal(updated.requestId, "request-1");
	assert.equal(updated.events?.at(-1)?.type, "started");
	const [member] = readAgentViewState(storePath).teams[0]?.members ?? [];
	assert.equal(member?.status, "running");
	assert.equal(member?.lastTaskId, task.id);
});

test("agent view store does not let older tasks overwrite newer running members", () => {
	const storePath = tempStorePath();
	const team = createAgentViewTeam(storePath, {
		name: "Concurrent Team",
		members: [{ id: "review", agent: "reviewer" }],
	});
	const olderTask = addTeamTask(storePath, team.id, "older review");
	const newerTask = addTeamTask(storePath, team.id, "newer review");

	updateTeamTask(storePath, team.id, olderTask.id, { status: "running" });
	updateTeamTask(storePath, team.id, newerTask.id, { status: "running" });
	updateTeamTask(storePath, team.id, olderTask.id, { status: "completed" });

	const [member] = readAgentViewState(storePath).teams[0]?.members ?? [];
	assert.equal(member?.status, "running");
	assert.equal(member?.lastTaskId, newerTask.id);
});

test("agent view store creates and updates native agent sessions", () => {
	const storePath = tempStorePath();
	const session = createAgentSessionRecord(storePath, {
		title: "Docs research",
		cwd: "/tmp/repo",
		agentName: "researcher",
		sessionId: "pi-session-1",
		sessionFile: "/tmp/repo/.pi-session.jsonl",
	});

	assert.match(session.id, /^session-/);
	assert.equal(session.title, "Docs research");
	assert.equal(session.cwd, "/tmp/repo");
	assert.equal(session.status, "queued");
	assert.equal(session.agentName, "researcher");
	assert.equal(session.sessionId, "pi-session-1");
	assert.equal(session.sessionFile, "/tmp/repo/.pi-session.jsonl");

	const updated = updateAgentSessionRecord(storePath, session.id, {
		status: "running",
		resultText: "working",
		event: { type: "started", text: "Session started." },
	});

	assert.equal(updated.status, "running");
	assert.equal(updated.resultText, "working");
	assert.equal(updated.events?.at(-1)?.type, "started");
	assert.equal(
		findAgentSessionRecord(readAgentViewState(storePath), session.id)?.id,
		session.id,
	);
});

test("agent view store bounds native agent session event tails", () => {
	const storePath = tempStorePath();
	const session = createAgentSessionRecord(storePath, {
		title: "Long run",
		cwd: "/tmp/repo",
	});

	for (let index = 0; index < 55; index += 1) {
		appendAgentSessionEvent(storePath, session.id, {
			type: "message",
			text: `event ${index}`,
		});
	}

	const stored = findAgentSessionRecord(
		readAgentViewState(storePath),
		session.id,
	);
	assert.equal(stored?.events?.length, 50);
	assert.equal(stored?.events?.[0]?.text, "event 5");
	assert.equal(stored?.events?.at(-1)?.text, "event 54");
});

test("agent view store reconciles stale active native sessions to detached", () => {
	const storePath = tempStorePath();
	const queued = createAgentSessionRecord(storePath, {
		title: "Queued",
		cwd: "/tmp/repo",
	});
	const running = createAgentSessionRecord(storePath, {
		title: "Running",
		cwd: "/tmp/repo",
		status: "running",
	});
	const completed = createAgentSessionRecord(storePath, {
		title: "Completed",
		cwd: "/tmp/repo",
		status: "completed",
	});

	reconcileDetachedAgentSessions(storePath);

	const state = readAgentViewState(storePath);
	assert.equal(findAgentSessionRecord(state, queued.id)?.status, "detached");
	assert.equal(findAgentSessionRecord(state, running.id)?.status, "detached");
	assert.equal(
		findAgentSessionRecord(state, completed.id)?.status,
		"completed",
	);
});

test("agent view store rejects invalid native session ids and statuses", () => {
	const storePath = tempStorePath();
	const session = createAgentSessionRecord(storePath, {
		title: "Safe session",
		cwd: "/tmp/repo",
	});

	assert.throws(
		() => findAgentSessionRecord(readAgentViewState(storePath), "../escape"),
		/Invalid agent view id/,
	);
	assert.throws(
		() =>
			updateAgentSessionRecord(storePath, session.id, {
				status: "unknown" as never,
			}),
		/Invalid agent session status/,
	);
});

test("agent view store appends team messages", () => {
	const storePath = tempStorePath();
	const team = createAgentViewTeam(storePath, {
		name: "Research Team",
		members: [{ id: "docs", agent: "researcher" }],
	});
	const message = appendTeamMessage(storePath, team.id, {
		targetId: "docs",
		text: "Check primary docs first.",
	});

	assert.equal(message.targetId, "docs");
	assert.equal(
		readAgentViewState(storePath).teams[0]?.messages[0]?.text,
		"Check primary docs first.",
	);
});

test("agent view store rejects invalid team and task ids", () => {
	const storePath = tempStorePath();
	const team = createAgentViewTeam(storePath, {
		name: "Safe Team",
		members: [{ id: "review", agent: "reviewer" }],
	});
	const task = addTeamTask(storePath, team.id, "review safely");

	assert.throws(
		() => addTeamTask(storePath, "../escape", "bad"),
		/Invalid agent view id/,
	);
	assert.throws(
		() =>
			updateTeamTask(storePath, team.id, `${task.id}/bad`, {
				status: "completed",
			}),
		/Invalid agent view id/,
	);
});
