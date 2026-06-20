import type { WorkflowRunRecord, WorkflowRunUpdate } from "./run-registry.js";
import type { WorkflowSpec } from "./types.js";

export interface TuiComponentLike {
	render(width: number): string[];
	handleInput?(data: string): void;
	invalidate(): void;
}

export interface WorkflowRunsComponentOptions {
	onClose?: () => void;
	requestRender?: () => void;
}

function latestUpdate(run: WorkflowRunRecord): WorkflowRunUpdate | undefined {
	return run.updates?.at(-1);
}

function updateText(update: WorkflowRunUpdate | undefined): string {
	if (!update) return "no live updates";
	if (update.type === "tool") {
		const count = update.toolCount ?? 0;
		return `${count} tools${update.currentTool ? ` ${update.currentTool}` : ""}`;
	}
	return update.text ?? update.type;
}

function runControls(run: WorkflowRunRecord): string {
	return `controls: /workflow-cancel ${run.id} · /workflow-save ${run.id} -- <path>`;
}

function clipLine(line: string, width: number): string {
	if (width < 1) return "";
	if (line.length <= width) return line;
	if (width === 1) return "…";
	return `${line.slice(0, width - 1)}…`;
}

function workflowLine(workflow: WorkflowSpec): string {
	return `- \`${workflow.name}\`${workflow.argumentHint ? ` ${workflow.argumentHint}` : ""} — ${workflow.description} (${workflow.source})`;
}

function runLines(run: WorkflowRunRecord): string[] {
	return [
		`- \`${run.workflowName}\` ${run.status} — ${run.args} (${run.id})`,
		`  phases: ${run.phases.length ? run.phases.join(" → ") : "none declared"}`,
		`  latest: ${updateText(latestUpdate(run))}`,
		`  ${runControls(run)}`,
	];
}

export function renderWorkflowProgress(
	workflows: WorkflowSpec[],
	runs: WorkflowRunRecord[],
): string {
	const workflowLines = workflows.length
		? workflows.map(workflowLine)
		: ["No dynamic workflows found."];
	const runSection = runs.length
		? runs.flatMap(runLines)
		: ["No recent workflow runs."];
	return [
		"## Dynamic workflows",
		"",
		...workflowLines,
		"",
		"Run with `/workflow <name> -- <arguments>` or ask Pi to use `ultracode:` / `use workflow ...`.",
		"",
		"## Workflow runs",
		"",
		...runSection,
	].join("\n");
}

export class WorkflowRunsComponent implements TuiComponentLike {
	private selectedRun = 0;
	private detailsOpen = false;

	constructor(
		private readonly workflows: WorkflowSpec[],
		private readonly runs: WorkflowRunRecord[],
		private readonly options: WorkflowRunsComponentOptions = {},
	) {}

	handleInput(data: string): void {
		if (data === "\x1b" || data === "escape" || data === "q") {
			this.options.onClose?.();
			return;
		}
		if ((data === "\x1b[A" || data === "up") && this.selectedRun > 0) {
			this.selectedRun -= 1;
			this.options.requestRender?.();
			return;
		}
		if (
			(data === "\x1b[B" || data === "down") &&
			this.selectedRun < this.runs.length - 1
		) {
			this.selectedRun += 1;
			this.options.requestRender?.();
			return;
		}
		if (
			(data === "\r" || data === "\n" || data === "enter") &&
			this.runs.length > 0
		) {
			this.detailsOpen = !this.detailsOpen;
			this.options.requestRender?.();
		}
	}

	render(width: number): string[] {
		const lines = [
			"  Dynamic workflows",
			"",
			...this.runRows(),
			...(this.runs.length
				? ["", "  Available workflows", ...this.workflowRows()]
				: []),
			"",
			this.footer(),
		];
		return lines.map((line) => clipLine(line, width));
	}

	invalidate(): void {}

	private runRows(): string[] {
		if (!this.runs.length) return ["  No dynamic workflows in this session."];
		return this.runs.flatMap((run, index) => {
			const selected = index === this.selectedRun;
			const prefix = selected ? "❯" : " ";
			const row = `${prefix} ${run.workflowName} ${run.status} — ${run.args}`;
			if (!selected || !this.detailsOpen) return [row];
			return [
				row,
				`    id: ${run.id}`,
				`    phases: ${run.phases.length ? run.phases.join(" → ") : "none declared"}`,
				`    latest: ${updateText(latestUpdate(run))}`,
				`    ${runControls(run)}`,
			];
		});
	}

	private workflowRows(): string[] {
		if (!this.workflows.length) return ["  No dynamic workflows found."];
		return this.workflows.map(
			(workflow) =>
				`  ${workflow.name}${workflow.argumentHint ? ` ${workflow.argumentHint}` : ""} — ${workflow.description}`,
		);
	}

	private footer(): string {
		if (!this.runs.length) return "  Esc to close";
		return "  ↑↓ select · enter details · Esc/q close";
	}
}
