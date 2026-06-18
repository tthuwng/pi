import type { AgentTeam, AgentViewState } from "./agent-view-store.js";
import type { TuiComponentLike } from "./workflows-tui.js";

function clipLine(line: string, width: number): string {
	if (width < 1) return "";
	if (line.length <= width) return line;
	if (width === 1) return "…";
	return `${line.slice(0, width - 1)}…`;
}

function controls(team: AgentTeam): string[] {
	return [
		`controls: /team-run ${team.id} -- <task>`,
		`          /team-send ${team.id}/<member> -- <message>`,
		`          /team-stop ${team.id}/<task-id>`,
	];
}

function teamLines(team: AgentTeam): string[] {
	const memberLines = team.members.length
		? team.members.map(
				(member) =>
					`  - ${member.id}: ${member.agent} (${member.status})`,
			)
		: ["  - no members"];
	const taskLines = team.tasks.length
		? team.tasks.map(
				(task) =>
					`  - ${task.id}: ${task.status} — ${task.text}${task.resultText ? ` — ${task.resultText}` : ""}${task.errorText ? ` — ${task.errorText}` : ""}`,
			)
		: ["  - no tasks"];
	const messageLines = team.messages.length
		? team.messages
				.slice(-5)
				.map((message) => `  - ${message.targetId}: ${message.text}`)
		: ["  - no messages"];
	return [
		`### ${team.name} (${team.id})`,
		"members:",
		...memberLines,
		"tasks:",
		...taskLines,
		"messages:",
		...messageLines,
		...controls(team),
	];
}

export function renderAgentViewStatus(
	state: AgentViewState,
	targetId = "",
): string {
	const selected = targetId
		? state.teams.filter(
				(team) =>
					team.id === targetId || team.tasks.some((task) => task.id === targetId),
			)
		: state.teams;
	const emptyText = targetId
		? "No matching agent teams found."
		: "No agent teams found.";
	return [
		"## Agent teams",
		"",
		...(selected.length ? selected.flatMap(teamLines) : [emptyText]),
	].join("\n");
}

export class AgentViewComponent implements TuiComponentLike {
	constructor(
		private readonly state: AgentViewState,
		private readonly targetId = "",
	) {}

	render(width: number): string[] {
		return renderAgentViewStatus(this.state, this.targetId)
			.split("\n")
			.map((line) => clipLine(line, width));
	}

	invalidate(): void {}
}
