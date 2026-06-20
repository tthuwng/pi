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
	DYNAMIC_WORKFLOW_RESULT_TYPE,
} from "./subagents-bridge.js";
import {
	cancelWorkflowRun,
	createWorkflowRun,
	defaultRunDir,
	finishWorkflowRun,
	listWorkflowRuns,
	startWorkflowRun,
	workflowPhases,
} from "./run-registry.js";
import type { WorkflowRunRecord } from "./run-registry.js";
import {
	renderWorkflowProgress,
	WorkflowRunsComponent,
	type TuiComponentLike,
} from "./workflows-tui.js";
import {
	WorkflowSessionCancelledError,
	executeWorkflowWithSessions,
} from "./workflow-session-executor.js";
import {
	appendTeamMessage,
	createAgentViewTeam,
	defaultAgentViewStorePath,
	readAgentViewState,
	reconcileDetachedAgentSessions,
} from "./agent-view-store.js";
import { AgentSessionManager } from "./agent-session-manager.js";
import type { AgentRuntimeFactory } from "./agent-session-types.js";
import { cancelAgentTeamTask, runAgentTeamTask } from "./agent-team-runner.js";
import { AgentViewComponent, renderAgentViewStatus } from "./agent-view-tui.js";
import { createDefaultAgentRuntimeFactory } from "./pi-session-sdk.js";
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
		event: string,
		handler: (event: unknown, ctx: ContextLike) => Promise<unknown> | unknown,
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
			factory: (
				tui: { requestRender(): void },
				theme: unknown,
				keybindings: unknown,
				done: () => void,
			) => TuiComponentLike,
			options?: { overlay?: boolean },
		): unknown;
	};
}

export interface DynamicWorkflowsOptions {
	packageWorkflowDir?: string;
	userWorkflowDir?: string;
	projectWorkflowDir?: string | null;
	runDir?: string;
	agentViewStorePath?: string;
	autoRoute?: WorkflowAutoRouteMode | boolean;
	defaultWorkflowName?: string;
	agentRuntimeFactory?: AgentRuntimeFactory;
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

function parseTeamCreateArgs(args: string):
	| {
			name: string;
			members: Array<{ id: string; agent: string }>;
	  }
	| undefined {
	const delimiter = args.indexOf(" -- ");
	if (delimiter === -1) return undefined;
	const name = args.slice(0, delimiter).trim();
	const memberText = args.slice(delimiter + 4).trim();
	if (!name || !memberText) return undefined;
	const members = memberText.split(",").map((entry) => {
		const memberDelimiter = entry.indexOf("=");
		return {
			id: entry.slice(0, memberDelimiter).trim(),
			agent: entry.slice(memberDelimiter + 1).trim(),
		};
	});
	if (members.some((member) => !member.id || !member.agent)) return undefined;
	return { name, members };
}

function parseTeamTaskArgs(
	args: string,
): { teamId: string; taskText: string } | undefined {
	const delimiter = args.indexOf(" -- ");
	if (delimiter === -1) return undefined;
	const teamId = args.slice(0, delimiter).trim();
	const taskText = args.slice(delimiter + 4).trim();
	if (!teamId || !taskText) return undefined;
	return { teamId, taskText };
}

function parseTeamMessageArgs(
	args: string,
): { teamId: string; targetId: string; text: string } | undefined {
	const parsed = parseTeamTaskArgs(args);
	if (!parsed) return undefined;
	const [teamId, targetId] = parsed.teamId.split("/");
	if (!teamId) return undefined;
	return { teamId, targetId: targetId || "team", text: parsed.taskText };
}

function parseTeamStopArgs(
	args: string,
): { teamId: string; taskId: string } | undefined {
	const [teamId, taskId] = args.trim().split("/");
	if (!teamId || !taskId) return undefined;
	return { teamId, taskId };
}

function parseAgentStartArgs(args: string): string | undefined {
	const input = args.trim();
	if (!input.startsWith("-- ")) return undefined;
	const prompt = input.slice(3).trim();
	return prompt || undefined;
}

function parseAgentReplyArgs(
	args: string,
): { sessionId: string; text: string } | undefined {
	const delimiter = args.indexOf(" -- ");
	if (delimiter === -1) return undefined;
	const sessionId = args.slice(0, delimiter).trim();
	const text = args.slice(delimiter + 4).trim();
	if (!sessionId || !text) return undefined;
	return { sessionId, text };
}

function agentSessionTitle(prompt: string): string {
	return prompt.replace(/\s+/g, " ").slice(0, 64);
}

function sendDynamicMessage(pi: PiLike, content: string): void {
	pi.sendMessage?.({
		customType: DYNAMIC_WORKFLOW_RESULT_TYPE,
		display: true,
		content,
	});
}

function isExplicitTeamPrompt(text: string): boolean {
	return (
		/\b(team|swarm|agents?)\b/i.test(text) &&
		/\b(assemble|use|run|ask|coordinate|audit|review|research|investigate|analyze)\b/i.test(
			text,
		)
	);
}

function formatWorkflowList(
	workflows: WorkflowSpec[],
	runs: WorkflowRunRecord[],
): string {
	return renderWorkflowProgress(workflows, runs);
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
	const agentViewStorePath =
		options.agentViewStorePath ?? defaultAgentViewStorePath();
	reconcileDetachedAgentSessions(agentViewStorePath);
	const agentSessionManager = new AgentSessionManager({
		storePath: agentViewStorePath,
		runtimeFactory:
			options.agentRuntimeFactory ?? createDefaultAgentRuntimeFactory(),
	});
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
		const execute = async (): Promise<void> => {
			try {
				const result = await executeWorkflowWithSessions({
					runDir,
					runId: run.id,
					workflowName: workflow.name,
					params,
					runner: agentSessionManager,
					cwd: ctx.cwd,
				});
				finishWorkflowRun(runDir, run.id, {
					status: "completed",
					resultText: result.resultText,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const current = findRun(runDir, run.id);
				if (error instanceof WorkflowSessionCancelledError) {
					if (current?.status !== "cancelled") {
						cancelWorkflowRun(runDir, run.id, message);
					}
					return;
				}
				if (current?.status === "cancelled") return;
				finishWorkflowRun(runDir, run.id, {
					status: "failed",
					errorText: message,
				});
				notify(ctx, message, "error");
			}
		};
		if (params.async) {
			void execute();
			notify(ctx, `Started workflow run '${run.id}' in the background.`);
			return;
		}
		await execute();
	};

	pi.on?.("session_shutdown", () => {
		void agentSessionManager.disposeAllAgentSessions(
			"Parent Pi session shut down.",
		);
	});

	pi.on?.("input", async (event, ctx) => {
		const input = event as InputEventLike;
		if (typeof input.text !== "string") return { action: "continue" };
		if (input.source === "extension" || input.text.trim().startsWith("/")) {
			return { action: "continue" };
		}
		if (isExplicitTeamPrompt(input.text)) {
			const [team] = readAgentViewState(agentViewStorePath).teams;
			if (!team) return { action: "continue" };
			const task = await runAgentTeamTask(
				agentViewStorePath,
				agentSessionManager,
				ctx,
				team.id,
				input.text,
			);
			if (task.status === "failed") {
				notify(
					ctx,
					task.errorText ?? `Team task '${task.id}' failed.`,
					"error",
				);
			}
			return { action: "handled" };
		}
		const result = load(ctx);
		const route = routeWorkflowPrompt(input.text, result.workflows, {
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
				await ctx.ui.custom(
					(tui, _theme, _keybindings, done) =>
						new WorkflowRunsComponent(result.workflows, runs, {
							onClose: done,
							requestRender: () => tui.requestRender(),
						}),
				);
			} else {
				sendDynamicMessage(pi, formatWorkflowList(result.workflows, runs));
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
			await launchWorkflow(workflow, parsed.workflowArgs, ctx, parsed.async);
		},
	});

	pi.registerCommand?.("workflow-cancel", {
		description: "Cancel a running dynamic workflow: /workflow-cancel <run-id>",
		handler: async (args, ctx) => {
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
			if (run.status === "cancelled") {
				notify(ctx, `Workflow run '${runId}' is already cancelled.`);
				return;
			}
			if (run.status !== "running") {
				notify(ctx, `Workflow run '${runId}' is not running.`, "error");
				return;
			}
			if (run.requestId) {
				cancelSubagentWorkflow(pi, run.requestId);
			} else if (run.sessionIds?.length) {
				await Promise.all(
					run.sessionIds.map((sessionId) =>
						agentSessionManager.stopAgentSession(
							sessionId,
							"Workflow run cancelled.",
						),
					),
				);
			} else {
				notify(
					ctx,
					`Workflow run '${runId}' has no active request id or native session ids.`,
					"error",
				);
				return;
			}
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

	pi.registerCommand?.("team-create", {
		description:
			"Create an agent team: /team-create <name> -- <member>=<agent>[,<member>=<agent>]",
		handler: (args, ctx) => {
			const parsed = parseTeamCreateArgs(args);
			if (!parsed) {
				notify(
					ctx,
					"Usage: /team-create <name> -- <member>=<agent>[,<member>=<agent>]",
					"error",
				);
				return;
			}
			try {
				const team = createAgentViewTeam(agentViewStorePath, parsed);
				notify(ctx, `Created agent team '${team.id}'.`);
			} catch (error) {
				notify(
					ctx,
					error instanceof Error ? error.message : String(error),
					"error",
				);
			}
		},
	});

	pi.registerCommand?.("team-run", {
		description: "Run an agent team: /team-run <team-id> -- <task>",
		handler: async (args, ctx) => {
			const parsed = parseTeamTaskArgs(args);
			if (!parsed) {
				notify(ctx, "Usage: /team-run <team-id> -- <task>", "error");
				return;
			}
			const task = await runAgentTeamTask(
				agentViewStorePath,
				agentSessionManager,
				ctx,
				parsed.teamId,
				parsed.taskText,
			);
			if (task.status === "failed") {
				notify(
					ctx,
					task.errorText ?? `Team task '${task.id}' failed.`,
					"error",
				);
			} else {
				notify(ctx, `Team task '${task.id}' ${task.status}.`);
			}
		},
	});

	pi.registerCommand?.("team-status", {
		description: "Show agent team status: /team-status [team-or-task-id]",
		handler: (args) => {
			sendDynamicMessage(
				pi,
				renderAgentViewStatus(
					readAgentViewState(agentViewStorePath),
					args.trim(),
				),
			);
		},
	});

	pi.registerCommand?.("agent-start", {
		description: "Start a native agent session: /agent-start -- <prompt>",
		handler: async (args, ctx) => {
			const prompt = parseAgentStartArgs(args);
			if (!prompt) {
				notify(ctx, "Usage: /agent-start -- <prompt>", "error");
				return;
			}
			try {
				const session = await agentSessionManager.startAgentSession({
					title: agentSessionTitle(prompt),
					prompt,
					cwd: ctx.cwd,
				});
				notify(ctx, `Started agent session '${session.id}'.`);
			} catch (error) {
				notify(
					ctx,
					error instanceof Error ? error.message : String(error),
					"error",
				);
			}
		},
	});

	pi.registerCommand?.("agent-reply", {
		description:
			"Reply to a native agent session: /agent-reply <session-id> -- <message>",
		handler: async (args, ctx) => {
			const parsed = parseAgentReplyArgs(args);
			if (!parsed) {
				notify(ctx, "Usage: /agent-reply <session-id> -- <message>", "error");
				return;
			}
			try {
				await agentSessionManager.replyToAgentSession(
					parsed.sessionId,
					parsed.text,
				);
				notify(ctx, `Sent reply to agent session '${parsed.sessionId}'.`);
			} catch (error) {
				notify(
					ctx,
					error instanceof Error ? error.message : String(error),
					"error",
				);
			}
		},
	});

	pi.registerCommand?.("agent-stop", {
		description: "Stop a native agent session: /agent-stop <session-id>",
		handler: async (args, ctx) => {
			const sessionId = args.trim();
			if (!sessionId) {
				notify(ctx, "Usage: /agent-stop <session-id>", "error");
				return;
			}
			try {
				await agentSessionManager.stopAgentSession(
					sessionId,
					"Stopped by user.",
				);
				notify(ctx, `Stopped agent session '${sessionId}'.`);
			} catch (error) {
				notify(
					ctx,
					error instanceof Error ? error.message : String(error),
					"error",
				);
			}
		},
	});

	pi.registerCommand?.("agent-status", {
		description: "Show native agent sessions: /agent-status [session-id]",
		handler: (args) => {
			sendDynamicMessage(
				pi,
				renderAgentViewStatus(
					readAgentViewState(agentViewStorePath),
					args.trim(),
				),
			);
		},
	});

	pi.registerCommand?.("agents", {
		description: "Show the agent-view dashboard.",
		handler: async (args, ctx) => {
			const targetId = args.trim();
			const readState = () => readAgentViewState(agentViewStorePath);
			if (ctx.ui?.custom) {
				await ctx.ui.custom(
					(tui, _theme, _keybindings, done) =>
						new AgentViewComponent(readState, targetId, {
							cwd: ctx.cwd,
							onClose: done,
							onRunTask: (teamId, text) => {
								void runAgentTeamTask(
									agentViewStorePath,
									agentSessionManager,
									ctx,
									teamId,
									text,
								)
									.then((task) => {
										notify(ctx, `Team task '${task.id}' ${task.status}.`);
										tui.requestRender();
									})
									.catch((error: unknown) => {
										notify(
											ctx,
											error instanceof Error ? error.message : String(error),
											"error",
										);
									});
								tui.requestRender();
							},
							onCancelTask: (teamId, taskId) => {
								void cancelAgentTeamTask(
									agentViewStorePath,
									agentSessionManager,
									teamId,
									taskId,
								)
									.then((task) => {
										notify(ctx, `Cancelled team task '${task.id}'.`);
										tui.requestRender();
									})
									.catch((error: unknown) => {
										notify(
											ctx,
											error instanceof Error ? error.message : String(error),
											"error",
										);
									});
								tui.requestRender();
							},
							onRunSession: (text) => {
								void agentSessionManager
									.startAgentSession({
										title: agentSessionTitle(text),
										prompt: text,
										cwd: ctx.cwd,
									})
									.then((session) => {
										notify(ctx, `Started agent session '${session.id}'.`);
										tui.requestRender();
									})
									.catch((error: unknown) => {
										notify(
											ctx,
											error instanceof Error ? error.message : String(error),
											"error",
										);
									});
								tui.requestRender();
							},
							onReplySession: (sessionId, text) => {
								void agentSessionManager
									.replyToAgentSession(sessionId, text)
									.then(() => {
										notify(ctx, `Sent reply to agent session '${sessionId}'.`);
										tui.requestRender();
									})
									.catch((error: unknown) => {
										notify(
											ctx,
											error instanceof Error ? error.message : String(error),
											"error",
										);
									});
								tui.requestRender();
							},
							onStopSession: (sessionId) => {
								void agentSessionManager
									.stopAgentSession(sessionId, "Stopped from /agents.")
									.then(() => {
										notify(ctx, `Stopped agent session '${sessionId}'.`);
										tui.requestRender();
									})
									.catch((error: unknown) => {
										notify(
											ctx,
											error instanceof Error ? error.message : String(error),
											"error",
										);
									});
								tui.requestRender();
							},
							requestRender: () => tui.requestRender(),
						}),
				);
			} else {
				sendDynamicMessage(pi, renderAgentViewStatus(readState(), targetId));
			}
		},
	});

	pi.registerCommand?.("team-send", {
		description:
			"Send a team note: /team-send <team-id>[/member-id] -- <message>",
		handler: (args, ctx) => {
			const parsed = parseTeamMessageArgs(args);
			if (!parsed) {
				notify(
					ctx,
					"Usage: /team-send <team-id>[/member-id] -- <message>",
					"error",
				);
				return;
			}
			try {
				appendTeamMessage(agentViewStorePath, parsed.teamId, {
					targetId: parsed.targetId,
					text: parsed.text,
				});
				notify(ctx, `Sent team message to '${parsed.targetId}'.`);
			} catch (error) {
				notify(
					ctx,
					error instanceof Error ? error.message : String(error),
					"error",
				);
			}
		},
	});

	pi.registerCommand?.("team-stop", {
		description: "Cancel an agent team task: /team-stop <team-id>/<task-id>",
		handler: async (args, ctx) => {
			const parsed = parseTeamStopArgs(args);
			if (!parsed) {
				notify(ctx, "Usage: /team-stop <team-id>/<task-id>", "error");
				return;
			}
			try {
				const task = await cancelAgentTeamTask(
					agentViewStorePath,
					agentSessionManager,
					parsed.teamId,
					parsed.taskId,
				);
				notify(ctx, `Cancelled team task '${task.id}'.`);
			} catch (error) {
				notify(
					ctx,
					error instanceof Error ? error.message : String(error),
					"error",
				);
			}
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
	attachWorkflowSession,
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
