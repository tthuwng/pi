import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	discoverWorkflowSpecs,
	defaultWorkflowDirs,
} from "./workflow-registry.js";
import {
	routeWorkflowPrompt,
	type WorkflowAutoRouteMode,
} from "./auto-router.js";
import { planWorkflow } from "./workflow-planner.js";
import {
	cancelSubagentWorkflow,
	dispatchSubagentWorkflow,
	DYNAMIC_WORKFLOW_RESULT_TYPE,
} from "./subagents-bridge.js";
import {
	appendWorkflowRunUpdate,
	attachWorkflowRequest,
	cancelWorkflowRun,
	createWorkflowRun,
	defaultRunDir,
	finishWorkflowRun,
	listWorkflowRuns,
	startWorkflowRun,
	workflowPhases,
} from "./run-registry.js";
import type { WorkflowRunRecord, WorkflowRunUpdate } from "./run-registry.js";
import {
	renderWorkflowProgress,
	WorkflowRunsComponent,
	type TuiComponentLike,
} from "./workflows-tui.js";
import type { WorkflowChainStep, WorkflowSpec } from "./types.js";

interface CommandSpec {
	description: string;
	handler: (args: string, ctx: ContextLike) => Promise<void> | void;
	getArgumentCompletions?: (
		prefix: string,
	) => Array<{ value: string; label: string }> | null;
}

interface PiLike {
	registerCommand?(name: string, command: CommandSpec): void;
	on?(
		event: "input",
		handler: (event: InputEventLike, ctx: ContextLike) => Promise<unknown>,
	): void;
	sendMessage?(message: unknown): void;
	events?: {
		on(event: string, handler: (payload: unknown) => void): (() => void) | void;
		emit(event: string, payload: unknown): void;
	};
}

interface InputEventLike {
	text?: unknown;
	source?: unknown;
}

interface ContextLike {
	cwd: string;
	hasUI?: boolean;
	ui?: {
		notify?(message: string, type?: "info" | "warning" | "error"): void;
		setStatus?(key: string, value: string | undefined): void;
		custom?(
			factory: () => TuiComponentLike,
			options?: { overlay?: boolean },
		): unknown;
	};
}

interface BridgeResponseLike {
	isError?: boolean;
	errorText?: string;
	result?: { content?: Array<{ type?: string; text?: string }> };
}

export interface DynamicWorkflowsOptions {
	packageWorkflowDir?: string;
	userWorkflowDir?: string;
	projectWorkflowDir?: string | null;
	runDir?: string;
	autoRoute?: WorkflowAutoRouteMode | boolean;
	defaultWorkflowName?: string;
}

function packageWorkflowDir(): string {
	return path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"..",
		"workflows",
	);
}

function parseWorkflowCommandArgs(
	args: string,
): { name: string; workflowArgs: string; async?: boolean } | undefined {
	let input = args.trim();
	let asyncOverride: boolean | undefined;
	if (input.endsWith(" --bg") || input === "--bg") {
		asyncOverride = true;
		input = input === "--bg" ? "" : input.slice(0, -5).trim();
	}
	const delimiter = input.indexOf(" -- ");
	if (delimiter === -1) return undefined;
	const name = input.slice(0, delimiter).trim();
	const workflowArgs = input.slice(delimiter + 4).trim();
	if (!name || !workflowArgs) return undefined;
	return {
		name,
		workflowArgs,
		...(asyncOverride !== undefined ? { async: asyncOverride } : {}),
	};
}

function parseExportArgs(
	args: string,
): { name: string; targetPath: string } | undefined {
	const delimiter = args.indexOf(" -- ");
	if (delimiter === -1) return undefined;
	const name = args.slice(0, delimiter).trim();
	const targetPath = args.slice(delimiter + 4).trim();
	if (!name || !targetPath) return undefined;
	return { name, targetPath };
}

function parseRunSaveArgs(
	args: string,
): { runId: string; targetPath: string } | undefined {
	const delimiter = args.indexOf(" -- ");
	if (delimiter === -1) return undefined;
	const runId = args.slice(0, delimiter).trim();
	const targetPath = args.slice(delimiter + 4).trim();
	if (!runId || !targetPath) return undefined;
	return { runId, targetPath };
}

function formatWorkflowList(
	workflows: WorkflowSpec[],
	runs: WorkflowRunRecord[],
): string {
	return renderWorkflowProgress(workflows, runs);
}

function responseText(response: BridgeResponseLike): string {
	if (response.errorText) return response.errorText;
	return (
		response.result?.content
			?.filter(
				(part): part is { type: string; text: string } =>
					part.type === "text" && typeof part.text === "string",
			)
			.map((part) => part.text)
			.join("\n") || ""
	);
}

function bridgeUpdateToRunUpdate(
	payload: unknown,
): Omit<WorkflowRunUpdate, "at"> | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const toolCount = (payload as { toolCount?: unknown }).toolCount;
	const currentTool = (payload as { currentTool?: unknown }).currentTool;
	if (typeof toolCount !== "number" && typeof currentTool !== "string") {
		return undefined;
	}
	return {
		type: "tool",
		...(typeof toolCount === "number" ? { toolCount } : {}),
		...(typeof currentTool === "string" ? { currentTool } : {}),
	};
}

function formatPlanPreview(
	workflow: WorkflowSpec,
	chain: WorkflowChainStep[],
	runId: string,
): string {
	const phases = workflowPhases(chain);
	return [
		`## Dynamic workflow plan: ${workflow.name}`,
		"",
		workflow.description,
		"",
		`Run id: \`${runId}\``,
		`Steps: ${chain.length}`,
		`Phases: ${phases.length ? phases.join(", ") : "none declared"}`,
	].join("\n");
}

function resolveExportTarget(cwd: string, requestedPath: string): string {
	const root = path.resolve(cwd);
	const targetPath = path.resolve(root, requestedPath);
	const relative = path.relative(root, targetPath);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error(
			"Workflow export path must stay inside the current project.",
		);
	}
	return targetPath;
}

function notify(
	ctx: ContextLike,
	message: string,
	type: "info" | "warning" | "error" = "info",
): void {
	ctx.ui?.notify?.(message, type);
}

function findRun(runDir: string, runId: string): WorkflowRunRecord | undefined {
	return listWorkflowRuns(runDir, 1000).find((run) => run.id === runId);
}

export default function dynamicWorkflows(
	pi: PiLike,
	options: DynamicWorkflowsOptions = {},
): void {
	const runDir = options.runDir ?? defaultRunDir();
	const load = (ctx: ContextLike) => {
		const dirs = defaultWorkflowDirs(
			ctx.cwd,
			options.packageWorkflowDir ?? packageWorkflowDir(),
		);
		return discoverWorkflowSpecs({
			packageDir: dirs.packageDir,
			userDir: options.userWorkflowDir ?? dirs.userDir,
			projectDir:
				options.projectWorkflowDir !== undefined
					? options.projectWorkflowDir
					: dirs.projectDir,
		});
	};
	const completions = (ctx: ContextLike) => (prefix: string) => {
		if (prefix.includes(" -- ")) return null;
		return load(ctx)
			.workflows.filter((workflow) => workflow.name.startsWith(prefix.trim()))
			.map((workflow) => ({ value: workflow.name, label: workflow.name }));
	};
	const autoRouteMode = (): WorkflowAutoRouteMode => {
		if (options.autoRoute === false) return "off";
		if (options.autoRoute === true || options.autoRoute === undefined)
			return "substantive";
		return options.autoRoute;
	};
	const launchWorkflow = async (
		workflow: WorkflowSpec,
		workflowArgs: string,
		ctx: ContextLike,
		asyncOverride?: boolean,
	): Promise<void> => {
		const params = planWorkflow(workflow, workflowArgs, {
			async: asyncOverride,
		});
		const run = createWorkflowRun(runDir, workflow, params);
		pi.sendMessage?.({
			customType: DYNAMIC_WORKFLOW_RESULT_TYPE,
			display: true,
			content: formatPlanPreview(workflow, params.chain, run.id),
		});
		startWorkflowRun(runDir, run.id);
		try {
			const response = (await dispatchSubagentWorkflow(
				pi,
				ctx,
				workflow.name,
				params,
				{
					onRequest: (requestId) =>
						attachWorkflowRequest(runDir, run.id, requestId),
					onUpdate: (payload) => {
						const update = bridgeUpdateToRunUpdate(payload);
						if (update) appendWorkflowRunUpdate(runDir, run.id, update);
					},
				},
			)) as BridgeResponseLike;
			const text = responseText(response);
			finishWorkflowRun(runDir, run.id, {
				status: response.isError ? "failed" : "completed",
				...(text ? { resultText: text } : {}),
				...(response.isError ? { errorText: text } : {}),
			});
			if (response.isError)
				notify(
					ctx,
					response.errorText ?? `Workflow '${workflow.name}' failed.`,
					"error",
				);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			finishWorkflowRun(runDir, run.id, {
				status: "failed",
				errorText: message,
			});
			notify(ctx, message, "error");
		}
	};

	pi.on?.("input", async (event, ctx) => {
		if (typeof event.text !== "string") return { action: "continue" };
		if (event.source === "extension" || event.text.trim().startsWith("/")) {
			return { action: "continue" };
		}
		const result = load(ctx);
		const route = routeWorkflowPrompt(event.text, result.workflows, {
			mode: autoRouteMode(),
			...(options.defaultWorkflowName
				? { defaultWorkflowName: options.defaultWorkflowName }
				: {}),
		});
		if (route.action === "none") return { action: "continue" };
		const workflow = result.workflows.find(
			(candidate) => candidate.name === route.workflowName,
		);
		if (!workflow) return { action: "continue" };
		await launchWorkflow(workflow, route.args, ctx);
		return { action: "handled" };
	});

	pi.registerCommand?.("workflows", {
		description: "List pi-dynamic-workflows workflows and recent runs.",
		handler: async (_args, ctx) => {
			const result = load(ctx);
			const runs = listWorkflowRuns(runDir);
			if (ctx.ui?.custom) {
				ctx.ui.custom(() => new WorkflowRunsComponent(result.workflows, runs), {
					overlay: true,
				});
			} else {
				pi.sendMessage?.({
					customType: DYNAMIC_WORKFLOW_RESULT_TYPE,
					display: true,
					content: formatWorkflowList(result.workflows, runs),
				});
			}
			for (const diagnostic of result.diagnostics) {
				notify(ctx, `${diagnostic.filePath}: ${diagnostic.error}`, "warning");
			}
		},
	});

	pi.registerCommand?.("workflow", {
		description:
			"Run a dynamic workflow: /workflow <name> -- <arguments> [--bg]",
		getArgumentCompletions(prefix) {
			return completions({ cwd: process.cwd() })(prefix);
		},
		handler: async (args, ctx) => {
			const parsed = parseWorkflowCommandArgs(args);
			if (!parsed) {
				notify(ctx, "Usage: /workflow <name> -- <arguments> [--bg]", "error");
				return;
			}
			const result = load(ctx);
			const workflow = result.workflows.find(
				(candidate) => candidate.name === parsed.name,
			);
			if (!workflow) {
				notify(ctx, `Unknown workflow: ${parsed.name}`, "error");
				return;
			}
			const params = planWorkflow(workflow, parsed.workflowArgs, {
				async: parsed.async,
			});
			const run = createWorkflowRun(runDir, workflow, params);
			pi.sendMessage?.({
				customType: DYNAMIC_WORKFLOW_RESULT_TYPE,
				display: true,
				content: formatPlanPreview(workflow, params.chain, run.id),
			});
			startWorkflowRun(runDir, run.id);
			try {
				const response = (await dispatchSubagentWorkflow(
					pi,
					ctx,
					workflow.name,
					params,
					{
						onRequest: (requestId) =>
							attachWorkflowRequest(runDir, run.id, requestId),
						onUpdate: (payload) => {
							const update = bridgeUpdateToRunUpdate(payload);
							if (update) appendWorkflowRunUpdate(runDir, run.id, update);
						},
					},
				)) as BridgeResponseLike;
				const text = responseText(response);
				finishWorkflowRun(runDir, run.id, {
					status: response.isError ? "failed" : "completed",
					...(text ? { resultText: text } : {}),
					...(response.isError ? { errorText: text } : {}),
				});
				if (response.isError)
					notify(
						ctx,
						response.errorText ?? `Workflow '${workflow.name}' failed.`,
						"error",
					);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				finishWorkflowRun(runDir, run.id, {
					status: "failed",
					errorText: message,
				});
				notify(ctx, message, "error");
			}
		},
	});

	pi.registerCommand?.("workflow-cancel", {
		description: "Cancel a running dynamic workflow: /workflow-cancel <run-id>",
		handler: (args, ctx) => {
			const runId = args.trim();
			if (!runId) {
				notify(ctx, "Usage: /workflow-cancel <run-id>", "error");
				return;
			}
			const run = findRun(runDir, runId);
			if (!run) {
				notify(ctx, `Unknown workflow run: ${runId}`, "error");
				return;
			}
			if (!run.requestId) {
				notify(
					ctx,
					`Workflow run '${runId}' has no active request id.`,
					"error",
				);
				return;
			}
			cancelSubagentWorkflow(pi, run.requestId);
			cancelWorkflowRun(runDir, run.id, "cancelled by user");
			notify(ctx, `Cancelled workflow run '${run.id}'.`);
		},
	});

	pi.registerCommand?.("workflow-save", {
		description:
			"Save a run's workflow spec: /workflow-save <run-id> -- <path>",
		handler: (args, ctx) => {
			const parsed = parseRunSaveArgs(args);
			if (!parsed) {
				notify(ctx, "Usage: /workflow-save <run-id> -- <path>", "error");
				return;
			}
			const run = findRun(runDir, parsed.runId);
			if (!run) {
				notify(ctx, `Unknown workflow run: ${parsed.runId}`, "error");
				return;
			}
			const workflow = load(ctx).workflows.find(
				(candidate) => candidate.name === run.workflowName,
			);
			if (!workflow) {
				notify(ctx, `Unknown workflow: ${run.workflowName}`, "error");
				return;
			}
			let targetPath: string;
			try {
				targetPath = resolveExportTarget(ctx.cwd, parsed.targetPath);
			} catch (error) {
				notify(
					ctx,
					error instanceof Error ? error.message : String(error),
					"error",
				);
				return;
			}
			if (fs.existsSync(targetPath)) {
				notify(
					ctx,
					`Refusing to overwrite existing file: ${targetPath}`,
					"error",
				);
				return;
			}
			fs.mkdirSync(path.dirname(targetPath), { recursive: true });
			fs.copyFileSync(workflow.filePath, targetPath);
			notify(ctx, `Saved workflow '${workflow.name}' to ${targetPath}`);
		},
	});

	pi.registerCommand?.("workflow-export", {
		description:
			"Export a discovered workflow: /workflow-export <name> -- <path>",
		getArgumentCompletions(prefix) {
			return completions({ cwd: process.cwd() })(prefix);
		},
		handler: async (args, ctx) => {
			const parsed = parseExportArgs(args);
			if (!parsed) {
				notify(ctx, "Usage: /workflow-export <name> -- <path>", "error");
				return;
			}
			const workflow = load(ctx).workflows.find(
				(candidate) => candidate.name === parsed.name,
			);
			if (!workflow) {
				notify(ctx, `Unknown workflow: ${parsed.name}`, "error");
				return;
			}
			let targetPath: string;
			try {
				targetPath = resolveExportTarget(ctx.cwd, parsed.targetPath);
			} catch (error) {
				notify(
					ctx,
					error instanceof Error ? error.message : String(error),
					"error",
				);
				return;
			}
			if (fs.existsSync(targetPath)) {
				notify(
					ctx,
					`Refusing to overwrite existing file: ${targetPath}`,
					"error",
				);
				return;
			}
			fs.mkdirSync(path.dirname(targetPath), { recursive: true });
			fs.copyFileSync(workflow.filePath, targetPath);
			notify(ctx, `Exported workflow '${workflow.name}' to ${targetPath}`);
		},
	});
}

export {
	discoverWorkflowSpecs,
	parseWorkflowSpec,
} from "./workflow-registry.js";
export { planWorkflow } from "./workflow-planner.js";
export {
	appendWorkflowRunUpdate,
	attachWorkflowRequest,
	cancelWorkflowRun,
	createWorkflowRun,
	finishWorkflowRun,
	listWorkflowRuns,
	startWorkflowRun,
} from "./run-registry.js";
export type {
	WorkflowSpec,
	WorkflowChainStep,
	PlannedWorkflowParams,
} from "./types.js";
