import * as path from "node:path";
import { canonicalizeExistingPathForCollision } from "./path-collision.ts";

export interface ParallelWriterGuardTask {
	agent: string;
	cwd?: string;
}

export interface ParallelWriterGuardAgent {
	name: string;
	tools?: string[];
	mcpDirectTools?: string[];
	extensions?: string[];
}

export interface ParallelWriterGuardChainStep {
	parallel?: ParallelWriterGuardTask[];
	worktree?: boolean;
	cwd?: string;
}

const WORKSPACE_MUTATION_TOOLS = new Set(["edit", "write", "ast_grep_replace"]);
const KNOWN_ADVISORY_TOOLS = new Set([
	"read",
	"grep",
	"find",
	"ls",
	"bash",
	"contact_supervisor",
	"intercom",
	"tree_sitter_search_symbols",
	"tree_sitter_document_symbols",
	"tree_sitter_symbol_definition",
	"tree_sitter_pattern_search",
	"tree_sitter_codebase_overview",
	"tree_sitter_codebase_map",
	"ast_grep_search",
	"lsp_navigation",
	"code_search",
	"web_search",
	"fetch_content",
	"get_search_content",
]);

export function agentCanMutateWorkspace(
	agent: ParallelWriterGuardAgent | undefined,
): boolean {
	if (!agent) return false;
	if ((agent.mcpDirectTools?.length ?? 0) > 0) return true;
	if ((agent.extensions?.length ?? 0) > 0) return true;
	if (!agent.tools) return true;
	return agent.tools.some(
		(tool) =>
			WORKSPACE_MUTATION_TOOLS.has(tool) || !KNOWN_ADVISORY_TOOLS.has(tool),
	);
}

export function resolveGuardTaskCwd(baseCwd: string, taskCwd?: string): string {
	if (!taskCwd) return path.resolve(baseCwd);
	return path.isAbsolute(taskCwd)
		? path.resolve(taskCwd)
		: path.resolve(baseCwd, taskCwd);
}

export function findSharedCwdParallelWriterError(input: {
	tasks: ParallelWriterGuardTask[];
	agents: ParallelWriterGuardAgent[];
	baseCwd: string;
	worktree?: boolean;
	label: string;
}): string | undefined {
	if (input.worktree) return undefined;
	const agentsByName = new Map(
		input.agents.map((agent) => [agent.name, agent]),
	);
	const writersByCwd = new Map<
		string,
		Array<{ index: number; agent: string }>
	>();

	for (let index = 0; index < input.tasks.length; index++) {
		const task = input.tasks[index]!;
		const agent = agentsByName.get(task.agent);
		if (!agentCanMutateWorkspace(agent)) continue;
		const taskCwd = resolveGuardTaskCwd(input.baseCwd, task.cwd);
		const taskCwdKey = canonicalizeExistingPathForCollision(taskCwd);
		const writers = writersByCwd.get(taskCwdKey) ?? [];
		writers.push({ index, agent: task.agent });
		writersByCwd.set(taskCwdKey, writers);
	}

	for (const [taskCwd, writers] of writersByCwd) {
		if (writers.length < 2) continue;
		const first = writers[0]!;
		const second = writers[1]!;
		return `${input.label} tasks ${first.index + 1} (${first.agent}) and ${second.index + 1} (${second.agent}) are workspace-mutation-capable and target the same cwd without worktree isolation: ${taskCwd}. Use worktree: true with a clean git state, assign distinct isolated cwd values, or run one writer at a time.`;
	}

	return undefined;
}

export function findSharedCwdChainParallelWriterError(input: {
	chain: ParallelWriterGuardChainStep[];
	agents: ParallelWriterGuardAgent[];
	baseCwd: string;
}): string | undefined {
	for (let stepIndex = 0; stepIndex < input.chain.length; stepIndex++) {
		const step = input.chain[stepIndex]!;
		if (!Array.isArray(step.parallel)) continue;
		const stepCwd = resolveGuardTaskCwd(input.baseCwd, step.cwd);
		const error = findSharedCwdParallelWriterError({
			tasks: step.parallel,
			agents: input.agents,
			baseCwd: stepCwd,
			worktree: step.worktree,
			label: `Parallel chain step ${stepIndex + 1}`,
		});
		if (error) return error;
	}
	return undefined;
}
