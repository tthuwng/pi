import type { WorkflowRunRecord, WorkflowRunUpdate } from "./run-registry.js";
import type { WorkflowSpec } from "./types.js";

export interface TuiComponentLike {
	render(width: number): string[];
	invalidate(): void;
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
	constructor(
		private readonly workflows: WorkflowSpec[],
		private readonly runs: WorkflowRunRecord[],
	) {}

	render(width: number): string[] {
		return renderWorkflowProgress(this.workflows, this.runs)
			.split("\n")
			.map((line) => clipLine(line, width));
	}

	invalidate(): void {}
}
