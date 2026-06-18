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
	};
}

test("renderAgentViewStatus shows teams, members, tasks, messages, and controls", () => {
	const rendered = renderAgentViewStatus(state(), "");

	assert.match(rendered, /Auth Team/);
	assert.match(rendered, /review: reviewer/);
	assert.match(rendered, /task-1: running/);
	assert.match(rendered, /Check auth middleware/);
	assert.match(rendered, /\/team-run auth-team -- <task>/);
});

test("renderAgentViewStatus can filter by team or task id", () => {
	assert.match(renderAgentViewStatus(state(), "auth-team"), /Auth Team/);
	assert.match(renderAgentViewStatus(state(), "task-1"), /Auth Team/);
	assert.match(renderAgentViewStatus(state(), "missing"), /No matching agent teams found/);
});

test("AgentViewComponent renders bounded lines", () => {
	const component = new AgentViewComponent(state());
	const lines = component.render(24);

	assert.ok(lines.length > 0);
	assert.ok(lines.every((line) => line.length <= 24));
});
