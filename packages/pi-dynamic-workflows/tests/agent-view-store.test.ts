import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import {
	addTeamTask,
	appendTeamMessage,
	createAgentViewTeam,
	readAgentViewState,
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
