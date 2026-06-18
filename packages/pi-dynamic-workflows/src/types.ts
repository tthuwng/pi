export type WorkflowSource = "package" | "user" | "project";
export type WorkflowContext = "fresh" | "fork";
export type WorkflowOutputMode = "inline" | "file-only";
export type WorkflowSkill = string | string[] | boolean;

export interface WorkflowTask {
	agent: string;
	task?: string;
	phase?: string;
	label?: string;
	as?: string;
	outputSchema?: unknown;
	cwd?: string;
	output?: string | false;
	outputMode?: WorkflowOutputMode;
	reads?: string[] | false;
	progress?: boolean;
	skill?: WorkflowSkill;
	skills?: string[] | false;
	model?: string;
	acceptance?: unknown;
}

export interface WorkflowParallelStep {
	parallel: WorkflowTask[];
	phase?: string;
	label?: string;
	concurrency?: number;
	failFast?: boolean;
	worktree?: boolean;
	acceptance?: unknown;
}

export interface WorkflowDynamicFanoutStep {
	expand: {
		from: { output: string; path: string };
		item?: string;
		key?: string;
		maxItems?: number;
		onEmpty?: "skip" | "fail";
	};
	parallel: WorkflowTask;
	collect: { as: string; outputSchema?: unknown };
	phase?: string;
	label?: string;
	concurrency?: number;
	failFast?: boolean;
	acceptance?: unknown;
}

export type WorkflowChainStep =
	| WorkflowTask
	| WorkflowParallelStep
	| WorkflowDynamicFanoutStep;

export interface WorkflowSpec {
	name: string;
	description: string;
	argumentHint?: string;
	context?: WorkflowContext;
	defaultAsync?: boolean;
	concurrency?: number;
	artifacts?: boolean;
	chain: WorkflowChainStep[];
	source: WorkflowSource;
	filePath: string;
}

export interface WorkflowDiagnostic {
	filePath: string;
	source: WorkflowSource;
	error: string;
}

export interface WorkflowDiscoveryResult {
	workflows: WorkflowSpec[];
	diagnostics: WorkflowDiagnostic[];
}

export interface PlannedWorkflowParams {
	chain: WorkflowChainStep[];
	task: string;
	context: WorkflowContext;
	async: boolean;
	clarify: false;
	agentScope: "both";
	concurrency?: number;
	artifacts?: boolean;
}
