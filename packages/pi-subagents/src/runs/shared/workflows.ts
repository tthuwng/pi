import type { ControlConfig, MaxOutputConfig } from "../../shared/types.ts";

type WorkflowContext = "fresh" | "fork";
type WorkflowOutputMode = "inline" | "file-only";
type WorkflowSkill = string | string[] | boolean;

type WorkflowTask = {
	agent: string;
	task: string;
	output?: string | false;
	outputMode?: WorkflowOutputMode;
	progress?: boolean;
};

type WorkflowParallelStep = {
	parallel: WorkflowTask[];
	concurrency?: number;
};

type WorkflowSequentialStep = WorkflowTask;

type WorkflowChainStep = WorkflowParallelStep | WorkflowSequentialStep;

export type WorkflowParamsLike = {
	workflow?: string;
	task?: string;
	agent?: string;
	tasks?: unknown[];
	chain?: unknown[];
	action?: string;
	config?: unknown;
	chainName?: string;
	context?: WorkflowContext;
	async?: boolean;
	clarify?: boolean;
	concurrency?: number;
	cwd?: string;
	model?: string;
	skill?: WorkflowSkill;
	output?: string | boolean;
	outputMode?: WorkflowOutputMode;
	agentScope?: string;
	control?: ControlConfig;
	artifacts?: boolean;
	includeProgress?: boolean;
	share?: boolean;
	sessionDir?: string;
	maxOutput?: MaxOutputConfig;
};

export type ExpandedWorkflowParams = Omit<
	WorkflowParamsLike,
	| "workflow"
	| "agent"
	| "tasks"
	| "chain"
	| "action"
	| "config"
	| "chainName"
	| "model"
	| "skill"
	| "output"
	| "outputMode"
> & {
	tasks?: WorkflowTask[];
	chain?: WorkflowChainStep[];
	concurrency?: number;
	context: "fresh";
	async: false;
};

export const BUILTIN_WORKFLOW_IDS = [
	"quality-gate",
	"research-decision",
	"generate-filter",
] as const;

type BuiltinWorkflowId = (typeof BUILTIN_WORKFLOW_IDS)[number];

function normalizeBuiltinWorkflowId(
	workflow: string,
): BuiltinWorkflowId | undefined {
	const trimmed = workflow.trim();
	if (!trimmed.startsWith("builtin.")) return undefined;
	const id = trimmed.slice("builtin.".length);
	return (BUILTIN_WORKFLOW_IDS as readonly string[]).includes(id)
		? (id as BuiltinWorkflowId)
		: undefined;
}

function conflictingWorkflowFields(params: WorkflowParamsLike): string[] {
	const conflicts: string[] = [];
	if (params.agent !== undefined) conflicts.push("agent");
	if (params.tasks !== undefined) conflicts.push("tasks");
	if (params.chain !== undefined) conflicts.push("chain");
	if (params.action !== undefined) conflicts.push("action");
	if (params.config !== undefined) conflicts.push("config");
	if (params.chainName !== undefined) conflicts.push("chainName");
	if (params.model !== undefined) conflicts.push("model");
	if (params.skill !== undefined) conflicts.push("skill");
	if (params.output !== undefined) conflicts.push("output");
	if (params.outputMode !== undefined) conflicts.push("outputMode");
	return conflicts;
}

function qualityGateTasks(target: string): WorkflowTask[] {
	return [
		{
			agent: "reviewer",
			task: `Quality gate: attack correctness, necessity, and regression risk for this target. Do not edit. Target:\n\n${target}`,
			output: false,
			progress: false,
		},
		{
			agent: "reviewer",
			task: `Quality gate: attack evidence, tests, verification, and approval boundaries for this target. Do not edit. Target:\n\n${target}`,
			output: false,
			progress: false,
		},
		{
			agent: "reviewer",
			task: `Quality gate: attack simplicity, scope, alternatives, and operational risk for this target. Do not edit. Target:\n\n${target}`,
			output: false,
			progress: false,
		},
	];
}

function researchDecisionTasks(target: string): WorkflowTask[] {
	return [
		{
			agent: "researcher",
			task: `Research decision: gather external/current evidence relevant to this decision. Do not edit. Return sources, confidence, risks, and implications. Decision target:\n\n${target}`,
			output: false,
			progress: false,
		},
		{
			agent: "scout",
			task: `Research decision: gather local repository/config context relevant to this decision. Do not edit or implement. Return files, constraints, risks, and likely verification surfaces. Decision target:\n\n${target}`,
			output: false,
			progress: false,
		},
		{
			agent: "reviewer",
			task: `Research decision: adversarially critique the decision and compare the strongest alternatives. Do not edit. Return must-fix objections, tradeoffs, and a recommended verdict shape. Decision target:\n\n${target}`,
			output: false,
			progress: false,
		},
	];
}

function generateFilterChain(target: string): WorkflowChainStep[] {
	return [
		{
			parallel: [
				{
					agent: "delegate",
					task: `Generate practical, low-risk options for this request. Return concrete options only; do not filter yet. Request:\n\n${target}`,
					output: false,
					progress: false,
				},
				{
					agent: "delegate",
					task: `Generate ambitious/high-upside options for this request. Return concrete options only; do not filter yet. Request:\n\n${target}`,
					output: false,
					progress: false,
				},
				{
					agent: "delegate",
					task: `Generate minimal/simplifying options for this request. Return concrete options only; do not filter yet. Request:\n\n${target}`,
					output: false,
					progress: false,
				},
			],
			concurrency: 3,
		},
		{
			agent: "reviewer",
			task: "Filter the generated options from {previous}. Dedupe aggressively, reject weak or duplicate ideas, rank the strongest few, include tradeoffs and the next validation step. Do not edit.",
			output: false,
			progress: false,
		},
	];
}

export function expandBuiltinWorkflowParams<T extends WorkflowParamsLike>(
	params: T,
): {
	params?: T | ExpandedWorkflowParams;
	error?: string;
	expanded?: boolean;
} {
	if (params.workflow === undefined) return { params, expanded: false };
	if (
		typeof params.workflow !== "string" ||
		params.workflow.trim().length === 0
	) {
		return { error: "workflow must be a non-empty string." };
	}

	const conflicts = conflictingWorkflowFields(params);
	if (conflicts.length > 0) {
		return {
			error: `workflow is mutually exclusive with ${conflicts.join(", ")}. Use either a named workflow or explicit execution/management parameters, not both.`,
		};
	}

	const task = params.task?.trim();
	if (!task) return { error: "workflow requires a non-empty task." };

	if (params.async === true) {
		return {
			error:
				"builtin workflows are foreground by default because parent synthesis depends on their result. Omit async or set async:false.",
		};
	}

	if (params.context !== undefined && params.context !== "fresh") {
		return {
			error:
				"builtin workflows require context:'fresh' for independent review/research.",
		};
	}

	const workflowId = normalizeBuiltinWorkflowId(params.workflow);
	if (!workflowId) {
		return {
			error: `Unknown workflow: ${params.workflow}. Builtin workflows: ${BUILTIN_WORKFLOW_IDS.map((id) => `builtin.${id}`).join(", ")}.`,
		};
	}

	const {
		workflow: _workflow,
		agent: _agent,
		tasks: _tasks,
		chain: _chain,
		action: _action,
		config: _config,
		chainName: _chainName,
		model: _model,
		skill: _skill,
		output: _output,
		outputMode: _outputMode,
		...rest
	} = params;
	const base = {
		...rest,
		task,
		context: "fresh" as const,
		async: false as const,
	};

	if (workflowId === "generate-filter") {
		return {
			params: {
				...base,
				chain: generateFilterChain(task),
			},
			expanded: true,
		};
	}

	const tasks =
		workflowId === "quality-gate"
			? qualityGateTasks(task)
			: researchDecisionTasks(task);
	return {
		params: {
			...base,
			tasks,
			concurrency: 3,
		},
		expanded: true,
	};
}
