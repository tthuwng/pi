import type {
	PlannedWorkflowParams,
	WorkflowChainStep,
	WorkflowSpec,
} from "./types.js";

export interface PlanWorkflowOptions {
	async?: boolean;
	context?: "fresh" | "fork";
	artifacts?: boolean;
}

function replaceInString(
	value: string,
	args: string,
	spec: WorkflowSpec,
): string {
	return value
		.replace(/\{args\}/g, args)
		.replace(/\{task\}/g, args)
		.replace(/\{workflow\.name\}/g, spec.name)
		.replace(/\{workflow\.description\}/g, spec.description);
}

function templateValue(
	value: unknown,
	args: string,
	spec: WorkflowSpec,
): unknown {
	if (typeof value === "string") return replaceInString(value, args, spec);
	if (Array.isArray(value))
		return value.map((item) => templateValue(item, args, spec));
	if (value && typeof value === "object") {
		const templated: Record<string, unknown> = {};
		for (const [key, nested] of Object.entries(value)) {
			templated[key] = templateValue(nested, args, spec);
		}
		return templated;
	}
	return value;
}

export function planWorkflow(
	spec: WorkflowSpec,
	rawArgs: string,
	options: PlanWorkflowOptions = {},
): PlannedWorkflowParams {
	const args = rawArgs.trim();
	if (!args) throw new Error(`Workflow '${spec.name}' requires arguments.`);

	return {
		chain: templateValue(spec.chain, args, spec) as WorkflowChainStep[],
		task: args,
		context: options.context ?? spec.context ?? "fresh",
		async: options.async ?? spec.defaultAsync ?? false,
		clarify: false,
		agentScope: "both",
		...(spec.concurrency !== undefined
			? { concurrency: spec.concurrency }
			: {}),
		...(options.artifacts !== undefined
			? { artifacts: options.artifacts }
			: spec.artifacts !== undefined
				? { artifacts: spec.artifacts }
				: {}),
	};
}
