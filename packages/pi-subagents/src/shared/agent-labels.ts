import {
	isParallelStep,
	type ChainStep,
	type SequentialStep,
} from "./settings.ts";

export function formatParallelAgentLabel(agents: string[]): string {
	if (agents.length === 0) return "parallel group";
	const uniqueAgents = [...new Set(agents)];
	if (uniqueAgents.length === 1)
		return agents.length === 1
			? uniqueAgents[0]!
			: `${agents.length}× ${uniqueAgents[0]}`;
	if (agents.length <= 3) return agents.join(" + ");
	const preview = uniqueAgents.slice(0, 3).join(", ");
	const suffix = uniqueAgents.length > 3 ? ", …" : "";
	return `${agents.length} agents (${preview}${suffix})`;
}

export function formatChainStepLabel(step: ChainStep): string {
	if (isParallelStep(step))
		return formatParallelAgentLabel(step.parallel.map((task) => task.agent));
	return (step as SequentialStep).agent;
}
