import type { WorkflowSpec } from "./types.js";

export type WorkflowAutoRouteMode = "off" | "explicit" | "substantive";

export interface WorkflowRouteOptions {
	mode?: WorkflowAutoRouteMode;
	defaultWorkflowName?: string;
}

export type WorkflowRoute =
	| { action: "none"; reason: string }
	| {
			action: "run";
			workflowName: string;
			args: string;
			reason: string;
	  };

interface NamedWorkflow {
	workflow: WorkflowSpec;
	name: string;
	label: string;
}

const SUBSTANTIVE_PATTERN =
	/\b(audit|review|verify|quality gate|research|investigate|compare|decide|decision|generate|brainstorm|options|migrate|migration|refactor|sweep)\b/i;

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function workflowLabel(name: string): string {
	return name.replace(/-/g, " ");
}

function namedWorkflows(workflows: WorkflowSpec[]): NamedWorkflow[] {
	return workflows.map((workflow) => ({
		workflow,
		name: workflow.name.toLowerCase(),
		label: workflowLabel(workflow.name).toLowerCase(),
	}));
}

function stripLeadingPreposition(value: string): string {
	return normalizeWhitespace(
		normalizeWhitespace(value)
			.replace(/^--\s*/, "")
			.replace(/^(?:on|for|to|with|about)\s+(?:the\s+)?/i, ""),
	);
}

function isWordChar(value: string | undefined): boolean {
	return !!value && /[a-z0-9-]/i.test(value);
}

function startsWithPhrase(value: string, phrase: string): boolean {
	const lower = value.toLowerCase();
	return lower.startsWith(phrase) && !isWordChar(lower.at(phrase.length));
}

function containsPhrase(value: string, phrase: string): boolean {
	const lower = value.toLowerCase();
	let fromIndex = 0;
	while (fromIndex < lower.length) {
		const index = lower.indexOf(phrase, fromIndex);
		if (index === -1) return false;
		const before = index === 0 ? undefined : lower.at(index - 1);
		const after = lower.at(index + phrase.length);
		if (!isWordChar(before) && !isWordChar(after)) return true;
		fromIndex = index + 1;
	}
	return false;
}

function stripWorkflowPhrase(value: string, workflow: NamedWorkflow): string {
	const normalized = normalizeWhitespace(value);
	for (const phrase of [workflow.name, workflow.label]) {
		if (startsWithPhrase(normalized, phrase)) {
			return stripLeadingPreposition(normalized.slice(phrase.length));
		}
	}
	return stripLeadingPreposition(normalized);
}

function findWorkflowByName(
	input: string,
	workflows: NamedWorkflow[],
): NamedWorkflow | undefined {
	return workflows.find(
		(workflow) =>
			containsPhrase(input, workflow.name) ||
			containsPhrase(input, workflow.label),
	);
}

function workflowNamed(
	name: string,
	workflows: NamedWorkflow[],
): NamedWorkflow | undefined {
	return workflows.find((workflow) => workflow.name === name);
}

function classifyWorkflow(
	input: string,
	workflows: NamedWorkflow[],
	defaultWorkflowName?: string,
): NamedWorkflow | undefined {
	const lower = input.toLowerCase();
	if (/\b(deep research|research|source|sources|investigate)\b/.test(lower)) {
		return workflowNamed("deep-research", workflows);
	}
	if (/\b(decide|decision|compare|tradeoff|tradeoffs)\b/.test(lower)) {
		return workflowNamed("research-decision", workflows);
	}
	if (/\b(generate|brainstorm|options|filter|rank)\b/.test(lower)) {
		return workflowNamed("generate-filter", workflows);
	}
	if (/\b(audit|review|verify|quality gate|test|tests|check)\b/.test(lower)) {
		return workflowNamed("quality-gate", workflows);
	}
	return (
		(defaultWorkflowName
			? workflowNamed(defaultWorkflowName, workflows)
			: undefined) ??
		workflowNamed("quality-gate", workflows) ??
		workflows[0]
	);
}

function routeRun(
	workflow: NamedWorkflow | undefined,
	args: string,
	reason: string,
): WorkflowRoute {
	const trimmedArgs = normalizeWhitespace(args);
	if (!workflow || !trimmedArgs)
		return { action: "none", reason: "no workflow trigger" };
	return {
		action: "run",
		workflowName: workflow.workflow.name,
		args: trimmedArgs,
		reason,
	};
}

function explicitRoute(
	input: string,
	workflows: NamedWorkflow[],
	reason: string,
	defaultWorkflowName?: string,
): WorkflowRoute {
	const named = findWorkflowByName(input, workflows);
	if (named) return routeRun(named, stripWorkflowPhrase(input, named), reason);
	return routeRun(
		classifyWorkflow(input, workflows, defaultWorkflowName),
		input,
		reason,
	);
}

export function routeWorkflowPrompt(
	input: string,
	workflows: WorkflowSpec[],
	options: WorkflowRouteOptions = {},
): WorkflowRoute {
	const mode = options.mode ?? "explicit";
	if (mode === "off") {
		return { action: "none", reason: "workflow auto-routing disabled" };
	}

	const prompt = normalizeWhitespace(input);
	if (!prompt) return { action: "none", reason: "empty prompt" };
	const named = namedWorkflows(workflows);

	const ultracode = prompt.match(/^ultracode\b\s*:?[\s-]*(.*)$/i);
	if (ultracode) {
		return explicitRoute(
			ultracode[1] ?? "",
			named,
			"explicit ultracode trigger",
			options.defaultWorkflowName,
		);
	}

	const workflowRequest = prompt.match(
		/^(?:use|run|launch|start)\s+(?:a\s+|the\s+)?(?:dynamic\s+)?workflow\b\s*:?[\s-]*(.*)$/i,
	);
	if (workflowRequest) {
		return explicitRoute(
			workflowRequest[1] ?? "",
			named,
			"explicit workflow request",
			options.defaultWorkflowName,
		);
	}

	const direct = named.find((workflow) =>
		startsWithPhrase(prompt, workflow.label),
	);
	if (direct) {
		return routeRun(
			direct,
			stripWorkflowPhrase(prompt, direct),
			"explicit workflow request",
		);
	}

	if (mode === "substantive" && SUBSTANTIVE_PATTERN.test(prompt)) {
		return routeRun(
			classifyWorkflow(prompt, named, options.defaultWorkflowName),
			prompt,
			"substantive task heuristic",
		);
	}

	return { action: "none", reason: "no workflow trigger" };
}
