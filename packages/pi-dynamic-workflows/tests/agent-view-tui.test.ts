import assert from "node:assert/strict";
import test from "node:test";

import {
	AgentViewComponent,
	renderAgentViewStatus,
} from "../src/agent-view-tui.js";
import type { AgentViewState } from "../src/agent-view-store.js";

function state(): AgentViewState {
	return {
		version: 1,
		teams: [
			{
				id: "auth-team",
				name: "Auth Team",
				createdAt: "2026-06-18T00:00:00.000Z",
				updatedAt: "2026-06-18T00:00:00.000Z",
				members: [
					{ id: "review", agent: "reviewer", status: "idle" },
					{ id: "tests", agent: "scout", status: "running" },
				],
				tasks: [
					{
						id: "task-1",
						text: "audit auth",
						status: "running",
						createdAt: "2026-06-18T00:00:00.000Z",
						updatedAt: "2026-06-18T00:00:00.000Z",
						requestId: "request-1",
						events: [
							{
								at: "2026-06-18T00:00:01.000Z",
								type: "tool",
								text: "2 tools read",
							},
						],
					},
				],
				messages: [
					{
						id: "message-1",
						targetId: "review",
						text: "Check auth middleware.",
						createdAt: "2026-06-18T00:00:00.000Z",
					},
				],
			},
		],
		sessions: [],
	};
}

test("renderAgentViewStatus shows teams, members, tasks, messages, and controls", () => {
	const rendered = renderAgentViewStatus(state(), "");

	assert.match(rendered, /Auth Team/);
	assert.match(rendered, /review: reviewer/);
	assert.match(rendered, /task-1: running/);
	assert.match(rendered, /request-1/);
	assert.match(rendered, /2 tools read/);
	assert.match(rendered, /Check auth middleware/);
	assert.match(rendered, /\/team-run auth-team -- <task>/);
});

test("renderAgentViewStatus can filter by team or task id", () => {
	assert.match(renderAgentViewStatus(state(), "auth-team"), /Auth Team/);
	assert.match(renderAgentViewStatus(state(), "task-1"), /Auth Team/);
	assert.match(
		renderAgentViewStatus(state(), "missing"),
		/No matching agent teams found/,
	);
});

test("AgentViewComponent renders bounded lines", () => {
	const component = new AgentViewComponent(state());
	const lines = component.render(24);

	assert.ok(lines.length > 0);
	assert.ok(lines.every((line) => line.length <= 24));
});

test("AgentViewComponent renders a Claude-style standalone dashboard", () => {
	const rendered = new AgentViewComponent(state(), "", {
		cwd: "/home/ec2-user/pi",
	})
		.render(100)
		.join("\n");

	assert.match(rendered, /Claude Code-style agent teams/);
	assert.match(rendered, /0 awaiting input · 1 working · 0 completed/);
	assert.match(rendered, /Working/);
	assert.match(rendered, /audit auth/);
	assert.match(rendered, /describe a task for a team run/);
	assert.match(
		rendered,
		/enter to open · ctrl\+x to cancel · \? for shortcuts/,
	);
});

test("AgentViewComponent renders native agent sessions before team tasks", () => {
	const nextState = state();
	nextState.sessions.push({
		id: "session-1",
		title: "inspect docs",
		cwd: "/home/ec2-user/pi",
		status: "running",
		createdAt: "2026-06-18T00:00:00.000Z",
		updatedAt: "2026-06-18T00:00:02.000Z",
		sessionId: "pi-session-1",
		events: [
			{
				at: "2026-06-18T00:00:01.000Z",
				type: "message",
				text: "reading docs",
			},
		],
	});
	const component = new AgentViewComponent(nextState);
	const rendered = component.render(100).join("\n");

	assert.match(rendered, /Working\n✻ inspect docs\.… {2}reading docs/);
	assert.match(rendered, / {2}Auth Team\.… {2}audit auth/);
});

test("AgentViewComponent stops selected native sessions", () => {
	const nextState = state();
	nextState.sessions.push({
		id: "session-1",
		title: "inspect docs",
		cwd: "/home/ec2-user/pi",
		status: "running",
		createdAt: "2026-06-18T00:00:00.000Z",
		updatedAt: "2026-06-18T00:00:02.000Z",
	});
	const stopped: string[] = [];
	const component = new AgentViewComponent(nextState, "", {
		onStopSession: (sessionId) => stopped.push(sessionId),
	});

	component.handleInput?.("ctrl+x");

	assert.deepEqual(stopped, ["session-1"]);
});

test("AgentViewComponent replies to selected native sessions", () => {
	const nextState = state();
	nextState.sessions.push({
		id: "session-1",
		title: "inspect docs",
		cwd: "/home/ec2-user/pi",
		status: "running",
		createdAt: "2026-06-18T00:00:00.000Z",
		updatedAt: "2026-06-18T00:00:02.000Z",
	});
	const replies: Array<{ sessionId: string; text: string }> = [];
	const component = new AgentViewComponent(nextState, "", {
		onReplySession: (sessionId, text) => replies.push({ sessionId, text }),
	});

	for (const char of "continue") component.handleInput?.(char);
	component.handleInput?.("enter");

	assert.deepEqual(replies, [{ sessionId: "session-1", text: "continue" }]);
});

test("AgentViewComponent starts native sessions when no team is selected", () => {
	const nextState = state();
	nextState.teams = [];
	const starts: string[] = [];
	const component = new AgentViewComponent(nextState, "", {
		onRunSession: (text) => starts.push(text),
	});

	for (const char of "research docs") component.handleInput?.(char);
	component.handleInput?.("enter");

	assert.deepEqual(starts, ["research docs"]);
});

test("AgentViewComponent shows completed task rows", () => {
	const nextState = state();
	nextState.teams[0]!.tasks.push({
		id: "task-2",
		text: "summarize results",
		status: "completed",
		createdAt: "2026-06-18T00:00:00.000Z",
		updatedAt: "2026-06-18T00:00:03.000Z",
		resultText: "summary",
	});

	const rendered = new AgentViewComponent(nextState).render(100).join("\n");

	assert.match(rendered, /0 awaiting input · 1 working · 1 completed/);
	assert.match(rendered, /Completed/);
	assert.match(rendered, /summary/);
});

test("AgentViewComponent submits typed tasks to the first visible team", () => {
	const submissions: Array<{ teamId: string; text: string }> = [];
	const component = new AgentViewComponent(state(), "", {
		onRunTask: (teamId, text) => submissions.push({ teamId, text }),
	});

	for (const char of "review") component.handleInput?.(char);
	component.handleInput?.("space");
	for (const char of "diff") component.handleInput?.(char);
	component.handleInput?.("enter");

	assert.deepEqual(submissions, [{ teamId: "auth-team", text: "review diff" }]);
});

test("AgentViewComponent maps ctrl+x to selected running task cancellation", () => {
	const cancellations: Array<{ teamId: string; taskId: string }> = [];
	const component = new AgentViewComponent(state(), "", {
		onCancelTask: (teamId, taskId) => cancellations.push({ teamId, taskId }),
	});

	component.handleInput?.("ctrl+x");

	assert.deepEqual(cancellations, [{ teamId: "auth-team", taskId: "task-1" }]);
});

test("AgentViewComponent selects rendered working row before older completed rows", () => {
	const nextState = state();
	nextState.teams[0]!.tasks = [
		{
			id: "task-1",
			text: "done task",
			status: "completed",
			createdAt: "2026-06-18T00:00:00.000Z",
			updatedAt: "2026-06-18T00:00:01.000Z",
			resultText: "done",
		},
		{
			id: "task-2",
			text: "run task",
			status: "running",
			createdAt: "2026-06-18T00:00:00.000Z",
			updatedAt: "2026-06-18T00:00:01.000Z",
			requestId: "request-2",
		},
	];
	const cancellations: Array<{ teamId: string; taskId: string }> = [];
	const component = new AgentViewComponent(nextState, "", {
		onCancelTask: (teamId, taskId) => cancellations.push({ teamId, taskId }),
	});

	const rendered = component.render(100).join("\n");
	component.handleInput?.("ctrl+x");

	assert.match(rendered, /Working\n✻ Auth Team\.… {2}run task/);
	assert.match(rendered, /Completed\n {2}Auth Team\.… {2}done task {2}done/);
	assert.deepEqual(cancellations, [{ teamId: "auth-team", taskId: "task-2" }]);
});

test("AgentViewComponent keeps printable q for task input and closes on escape", () => {
	let closeCount = 0;
	const submissions: string[] = [];
	const component = new AgentViewComponent(state(), "", {
		onClose: () => {
			closeCount += 1;
		},
		onRunTask: (_teamId, text) => submissions.push(text),
	});

	component.handleInput?.("q");
	component.handleInput?.("enter");
	component.handleInput?.("escape");

	assert.deepEqual(submissions, ["q"]);
	assert.equal(closeCount, 1);
});
