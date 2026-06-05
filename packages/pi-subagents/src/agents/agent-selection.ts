import type { AgentScope, AgentConfig } from "./agents.ts";

const PROTECTED_ADVISORY_AGENT_NAMES = new Set([
	"context-builder",
	"delegate",
	"oracle",
	"planner",
	"researcher",
	"reviewer",
	"scout",
]);

const ADVISORY_DEFAULT_TOOLS: Record<string, string[]> = {
	"context-builder": [
		"read",
		"grep",
		"find",
		"ls",
		"bash",
		"code_search",
		"web_search",
		"fetch_content",
		"get_search_content",
		"contact_supervisor",
		"intercom",
	],
	delegate: ["read", "grep", "find", "ls", "bash", "contact_supervisor"],
	oracle: [
		"read",
		"grep",
		"find",
		"ls",
		"bash",
		"contact_supervisor",
		"intercom",
	],
	planner: ["read", "grep", "find", "ls", "contact_supervisor", "intercom"],
	researcher: [
		"read",
		"code_search",
		"web_search",
		"fetch_content",
		"get_search_content",
		"contact_supervisor",
		"intercom",
	],
	reviewer: [
		"read",
		"grep",
		"find",
		"ls",
		"bash",
		"contact_supervisor",
		"intercom",
	],
	scout: [
		"read",
		"grep",
		"find",
		"ls",
		"bash",
		"contact_supervisor",
		"intercom",
	],
};

const ADVISORY_ALLOWED_TOOLS = new Set([
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

function protectedAdvisoryRoleName(agent: AgentConfig): string {
	const rawName = agent.localName ?? agent.name;
	const normalized = rawName.trim().toLowerCase();
	return normalized.split(".").pop() ?? normalized;
}

export function sanitizeProtectedAdvisoryAgentTools(
	agent: AgentConfig,
): AgentConfig {
	const roleName = protectedAdvisoryRoleName(agent);
	if (!PROTECTED_ADVISORY_AGENT_NAMES.has(roleName)) return agent;
	const defaultTools = ADVISORY_DEFAULT_TOOLS[roleName]!;
	const tools = (agent.tools ?? defaultTools).filter((tool) =>
		ADVISORY_ALLOWED_TOOLS.has(tool),
	);
	const {
		mcpDirectTools: _mcpDirectTools,
		extensions: _extensions,
		...rest
	} = agent;
	return { ...rest, tools, extensions: [] };
}

export function mergeAgentsForScope(
	scope: AgentScope,
	userAgents: AgentConfig[],
	projectAgents: AgentConfig[],
	builtinAgents: AgentConfig[] = [],
): AgentConfig[] {
	const agentMap = new Map<string, AgentConfig>();

	for (const agent of builtinAgents)
		agentMap.set(agent.name, sanitizeProtectedAdvisoryAgentTools(agent));

	if (scope === "both") {
		for (const agent of userAgents)
			agentMap.set(agent.name, sanitizeProtectedAdvisoryAgentTools(agent));
		for (const agent of projectAgents)
			agentMap.set(agent.name, sanitizeProtectedAdvisoryAgentTools(agent));
	} else if (scope === "user") {
		for (const agent of userAgents)
			agentMap.set(agent.name, sanitizeProtectedAdvisoryAgentTools(agent));
	} else {
		for (const agent of projectAgents)
			agentMap.set(agent.name, sanitizeProtectedAdvisoryAgentTools(agent));
	}

	return Array.from(agentMap.values());
}
