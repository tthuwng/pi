import type {
	AgentSessionRecord,
	AgentTeam,
	AgentTeamTask,
	AgentViewState,
} from "./agent-view-store.js";
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

function taskLine(task: AgentTeamTask): string {
	const latest = task.events?.at(-1);
	return [
		`  - ${task.id}: ${task.status} — ${task.text}`,
		task.requestId ? `request ${task.requestId}` : "",
		latest?.text ? `latest ${latest.text}` : "",
		task.resultText ? `result ${task.resultText}` : "",
		task.errorText ? `error ${task.errorText}` : "",
	]
		.filter(Boolean)
		.join(" — ");
}

function teamLines(team: AgentTeam): string[] {
	const memberLines = team.members.length
		? team.members.map(
				(member) => `  - ${member.id}: ${member.agent} (${member.status})`,
			)
		: ["  - no members"];
	const taskLines = team.tasks.length
		? team.tasks.map(taskLine)
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

function sessionLines(session: AgentSessionRecord): string[] {
	const latest = session.events?.at(-1);
	return [
		`### ${session.title} (${session.id})`,
		`status: ${session.status}`,
		`cwd: ${session.cwd}`,
		session.agentName ? `agent: ${session.agentName}` : "",
		session.sessionId ? `pi session: ${session.sessionId}` : "",
		session.sessionFile ? `file: ${session.sessionFile}` : "",
		latest?.text ? `latest: ${latest.text}` : "",
		session.resultText ? `result: ${session.resultText}` : "",
		session.errorText ? `error: ${session.errorText}` : "",
	]
		.filter(Boolean)
		.map(String);
}

export interface AgentViewComponentOptions {
	onClose?: () => void;
	onRunTask?: (teamId: string, text: string) => void;
	onCancelTask?: (teamId: string, taskId: string) => void;
	onRunSession?: (text: string) => void;
	onReplySession?: (sessionId: string, text: string) => void;
	onStopSession?: (sessionId: string) => void;
	requestRender?: () => void;
	cwd?: string;
}

type AgentViewStateSource = AgentViewState | (() => AgentViewState);

interface TaskRow {
	kind: "task";
	team: AgentTeam;
	task: AgentTeamTask;
}

interface SessionRow {
	kind: "session";
	session: AgentSessionRecord;
}

type AgentViewRow = TaskRow | SessionRow;

function selectedTeams(state: AgentViewState, targetId: string): AgentTeam[] {
	if (!targetId) return state.teams;
	return state.teams.filter(
		(team) =>
			team.id === targetId || team.tasks.some((task) => task.id === targetId),
	);
}

function selectedSessions(
	state: AgentViewState,
	targetId: string,
): AgentSessionRecord[] {
	if (!targetId) return state.sessions;
	return state.sessions.filter(
		(session) => session.id === targetId || session.sessionId === targetId,
	);
}

function taskRows(teams: AgentTeam[]): TaskRow[] {
	return teams.flatMap((team) =>
		team.tasks.map((task) => ({ kind: "task", team, task }) as const),
	);
}

function visibleRows(state: AgentViewState, targetId: string): AgentViewRow[] {
	const rows: AgentViewRow[] = [
		...selectedSessions(state, targetId).map(
			(session) => ({ kind: "session", session }) as const,
		),
		...taskRows(selectedTeams(state, targetId)),
	];
	return [
		...rows.filter((row) => isWorking(row)),
		...rows.filter((row) => isCompleted(row)),
	];
}

function isWorking(row: AgentViewRow): boolean {
	if (row.kind === "session") {
		return row.session.status === "queued" || row.session.status === "running";
	}
	return row.task.status === "queued" || row.task.status === "running";
}

function isCompleted(row: AgentViewRow): boolean {
	return !isWorking(row);
}

function membersText(team: AgentTeam): string {
	return team.members.length
		? team.members.map((member) => `${member.id}:${member.agent}`).join(", ")
		: "no members";
}

function compactCwd(cwd: string | undefined): string {
	if (!cwd) return "~/pi";
	const home = process.env.HOME;
	if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`;
	return cwd;
}

function elapsedText(item: { createdAt: string; updatedAt: string }): string {
	const start = Date.parse(item.createdAt);
	const end = Date.parse(item.updatedAt);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
		return "0s";
	return `${Math.max(1, Math.round((end - start) / 1000))}s`;
}

function counts(rows: AgentViewRow[]): {
	awaiting: number;
	working: number;
	completed: number;
} {
	return {
		awaiting: rows.filter(
			(row) =>
				(row.kind === "session" && row.session.status === "queued") ||
				(row.kind === "task" && row.task.status === "queued"),
		).length,
		working: rows.filter(
			(row) =>
				(row.kind === "session" && row.session.status === "running") ||
				(row.kind === "task" && row.task.status === "running"),
		).length,
		completed: rows.filter((row) => isCompleted(row)).length,
	};
}

function taskPreview(row: TaskRow): string {
	const result = row.task.resultText ?? row.task.errorText;
	return result ? `${row.task.text}  ${result}` : row.task.text;
}

function sessionPreview(session: AgentSessionRecord): string {
	return (
		session.resultText ??
		session.errorText ??
		session.events?.at(-1)?.text ??
		session.status
	);
}

function rowId(row: AgentViewRow): string {
	return row.kind === "session" ? row.session.id : row.task.id;
}

export function renderAgentViewStatus(
	state: AgentViewState,
	targetId = "",
): string {
	const sessions = selectedSessions(state, targetId);
	const selected = selectedTeams(state, targetId);
	const emptyText = targetId
		? "No matching agent teams found."
		: "No agent teams found.";
	return [
		...(sessions.length
			? ["## Agent sessions", "", ...sessions.flatMap(sessionLines), ""]
			: []),
		"## Agent teams",
		"",
		...(selected.length ? selected.flatMap(teamLines) : [emptyText]),
	].join("\n");
}

export class AgentViewComponent implements TuiComponentLike {
	private selectedRow = 0;
	private detailsOpen = false;
	private taskInput = "";
	private shortcutsOpen = false;

	constructor(
		private readonly stateSource: AgentViewStateSource,
		private readonly targetId = "",
		private readonly options: AgentViewComponentOptions = {},
	) {}

	handleInput(data: string): void {
		const state = this.state();
		const rows = visibleRows(state, this.targetId);
		if (data === "\x1b" || data === "escape") {
			this.options.onClose?.();
			return;
		}
		if (data === "?" && !this.taskInput) {
			this.shortcutsOpen = !this.shortcutsOpen;
			this.options.requestRender?.();
			return;
		}
		if ((data === "\x1b[A" || data === "up") && this.selectedRow > 0) {
			this.selectedRow -= 1;
			this.options.requestRender?.();
			return;
		}
		if (
			(data === "\x1b[B" || data === "down") &&
			this.selectedRow < rows.length - 1
		) {
			this.selectedRow += 1;
			this.options.requestRender?.();
			return;
		}
		if (data === "\x7f" || data === "backspace") {
			this.taskInput = this.taskInput.slice(0, -1);
			this.options.requestRender?.();
			return;
		}
		if (data === "\x18" || data === "ctrl+x") {
			const row = rows[this.selectedRow];
			if (row?.kind === "session" && isWorking(row)) {
				this.options.onStopSession?.(row.session.id);
				this.options.requestRender?.();
			}
			if (row?.kind === "task" && isWorking(row)) {
				this.options.onCancelTask?.(row.team.id, row.task.id);
				this.options.requestRender?.();
			}
			return;
		}
		if (data === "\r" || data === "\n" || data === "enter") {
			this.handleEnter(rows);
			return;
		}
		if (data === "space") {
			this.taskInput += " ";
			this.options.requestRender?.();
			return;
		}
		if (data.length === 1 && data >= " ") {
			this.taskInput += data;
			this.options.requestRender?.();
		}
	}

	render(width: number): string[] {
		const state = this.state();
		const teams = selectedTeams(state, this.targetId);
		const rows = visibleRows(state, this.targetId);
		const { awaiting, working, completed } = counts(rows);
		const lines = [
			" ▐▛███▜▌   Claude Code-style agent teams",
			`▝▜█████▛▘  Pi dynamic workflows · ${compactCwd(this.options.cwd)}`,
			`  ▘▘ ▝▝    ${awaiting} awaiting input · ${working} working · ${completed} completed`,
			"",
			...this.sectionLines(
				"Working",
				rows.filter((row) => isWorking(row)),
			),
			...this.sectionLines(
				"Completed",
				rows.filter((row) => isCompleted(row)),
			),
			...this.emptyHelp(teams, rows),
			...this.availableTeamLines(teams),
			"",
			"────────────────────────────────────────────────────────────────────────────────",
			this.inputLine(teams),
			"────────────────────────────────────────────────────────────────────────────────",
			this.footer(rows),
			...this.shortcutLines(),
		];
		return lines.map((line) => clipLine(line, width));
	}

	invalidate(): void {}

	private state(): AgentViewState {
		return typeof this.stateSource === "function"
			? this.stateSource()
			: this.stateSource;
	}

	private handleEnter(rows: AgentViewRow[]): void {
		const text = this.taskInput.trim();
		if (text) {
			const row = rows[this.selectedRow];
			if (row?.kind === "session") {
				this.options.onReplySession?.(row.session.id, text);
				this.taskInput = "";
				this.options.requestRender?.();
				return;
			}
			const team =
				row?.kind === "task"
					? row.team
					: selectedTeams(this.state(), this.targetId)[0];
			if (team) {
				this.options.onRunTask?.(team.id, text);
			} else {
				this.options.onRunSession?.(text);
			}
			this.taskInput = "";
			this.options.requestRender?.();
			return;
		}
		if (rows.length) {
			this.detailsOpen = !this.detailsOpen;
			this.options.requestRender?.();
		}
	}

	private sectionLines(title: string, rows: AgentViewRow[]): string[] {
		if (!rows.length) return [];
		return [title, ...rows.flatMap((row) => this.rowLines(row)), ""];
	}

	private rowLines(row: AgentViewRow): string[] {
		return row.kind === "session"
			? this.sessionRowLines(row)
			: this.taskRowLines(row);
	}

	private sessionRowLines(row: SessionRow): string[] {
		const allRows = visibleRows(this.state(), this.targetId);
		const selected = rowId(allRows[this.selectedRow] ?? row) === row.session.id;
		const marker = selected ? "✻" : " ";
		const line = `${marker} ${row.session.title}.…  ${sessionPreview(row.session)} ${elapsedText(row.session)}`;
		if (!selected || !this.detailsOpen) return [line];
		const latest = row.session.events?.at(-1)?.text ?? "no live updates";
		return [
			line,
			`    session: ${row.session.id} (${row.session.status})`,
			`    pi session: ${row.session.sessionId ?? "pending"}`,
			`    cwd: ${row.session.cwd}`,
			`    latest: ${latest}`,
			`    /agent-reply ${row.session.id} -- <message>`,
		];
	}

	private taskRowLines(row: TaskRow): string[] {
		const allRows = visibleRows(this.state(), this.targetId);
		const selected = rowId(allRows[this.selectedRow] ?? row) === row.task.id;
		const marker = selected ? "✻" : " ";
		const line = `${marker} ${row.team.name}.…  ${taskPreview(row)} ${elapsedText(row.task)}`;
		if (!selected || !this.detailsOpen) return [line];
		const latest = row.task.events?.at(-1)?.text ?? "no live updates";
		return [
			line,
			`    team: ${row.team.id}`,
			`    task: ${row.task.id} (${row.task.status})`,
			`    members: ${membersText(row.team)}`,
			`    latest: ${latest}`,
			`    /team-run ${row.team.id} -- <task>`,
		];
	}

	private emptyHelp(teams: AgentTeam[], rows: AgentViewRow[]): string[] {
		if (rows.length) return [];
		if (!teams.length) {
			return [
				"  No agent teams configured.",
				"",
				"  Type a task to start a native agent session.",
				"",
			];
		}
		return [
			"  Type a task to start a team run. It appears as a row above — open it to see its work.",
			"  Team runs keep working if you close this panel.",
			"",
			'  Try: "review the current diff" · "audit auth handlers" · "research this failure"',
			"",
		];
	}

	private availableTeamLines(teams: AgentTeam[]): string[] {
		if (!teams.length) return [];
		return [
			"Available Agent teams",
			...teams.flatMap((team) => [
				`  ${team.name} (${team.id})`,
				`    members: ${membersText(team)}`,
			]),
		];
	}

	private inputLine(teams: AgentTeam[]): string {
		const placeholder = teams.length
			? "describe a task for a team run"
			: "describe a task for a native agent session";
		return `❯ ${this.taskInput || placeholder}`;
	}

	private footer(rows: AgentViewRow[]): string {
		if (!rows.length) return "  ? for shortcuts";
		const selected = rows[this.selectedRow];
		if (selected?.kind === "session") {
			return "  enter to open · ctrl+x to stop · ? for shortcuts";
		}
		return "  enter to open · ctrl+x to cancel · ? for shortcuts";
	}

	private shortcutLines(): string[] {
		if (!this.shortcutsOpen) return [];
		return [
			"  ↑/↓ navigate rows",
			"  enter submits typed text or toggles selected row details",
			"  Esc closes the panel",
		];
	}
}
