import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
	WorkflowChainStep,
	WorkflowDiagnostic,
	WorkflowDiscoveryResult,
	WorkflowDynamicFanoutStep,
	WorkflowParallelStep,
	WorkflowSource,
	WorkflowSpec,
	WorkflowTask,
} from "./types.js";

const WORKFLOW_NAME_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;
const SAFE_OUTPUT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_CONCURRENCY = 16;
const MAX_DYNAMIC_ITEMS = 1000;

export interface WorkflowDiscoveryOptions {
	packageDir?: string;
	userDir?: string;
	projectDir?: string | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function isWorkflowTask(value: unknown): value is WorkflowTask {
	return isObject(value) && typeof value.agent === "string";
}

function isParallelStep(value: unknown): value is WorkflowParallelStep {
	return isObject(value) && Array.isArray(value.parallel);
}

function isDynamicFanoutStep(
	value: unknown,
): value is WorkflowDynamicFanoutStep {
	return (
		isObject(value) &&
		isObject(value.expand) &&
		isObject(value.parallel) &&
		isObject(value.collect)
	);
}

function isChainStep(value: unknown): value is WorkflowChainStep {
	return (
		isWorkflowTask(value) || isParallelStep(value) || isDynamicFanoutStep(value)
	);
}

function listWorkflowFiles(dir: string | undefined | null): string[] {
	if (!dir) return [];
	try {
		return fs
			.readdirSync(dir, { withFileTypes: true })
			.filter(
				(entry) => entry.isFile() && entry.name.endsWith(".workflow.json"),
			)
			.map((entry) => path.join(dir, entry.name))
			.sort();
	} catch {
		return [];
	}
}

function findProjectWorkflowDir(cwd: string): string | null {
	let current = path.resolve(cwd);
	while (true) {
		const candidate = path.join(current, ".pi", "workflows");
		if (fs.existsSync(candidate)) return candidate;
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

export function defaultWorkflowDirs(
	cwd: string,
	packageDir: string,
): Required<WorkflowDiscoveryOptions> {
	return {
		packageDir,
		userDir: path.join(os.homedir(), ".pi", "agent", "workflows"),
		projectDir: findProjectWorkflowDir(cwd),
	};
}

function assertConcurrency(value: unknown, label: string): void {
	if (value === undefined) return;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		throw new Error(`${label} must be an integer >= 1 when provided.`);
	}
	if (value > MAX_CONCURRENCY) {
		throw new Error(`${label} must be <= ${MAX_CONCURRENCY}.`);
	}
}

function assertJsonPointer(value: unknown, label: string): void {
	if (typeof value !== "string" || !value.startsWith("/")) {
		throw new Error(`${label} must be a JSON Pointer starting with '/'.`);
	}
	for (const segment of value.slice(1).split("/")) {
		if (/~(?![01])/.test(segment)) {
			throw new Error(`${label} contains invalid JSON Pointer escape.`);
		}
	}
}

function assertSafeOutputName(value: unknown, label: string): void {
	if (typeof value !== "string" || !SAFE_OUTPUT_NAME_PATTERN.test(value)) {
		throw new Error(`${label} must be a safe output name.`);
	}
}

function assertWorkflowTask(task: WorkflowTask, label: string): void {
	if (!task.agent.trim()) throw new Error(`${label}.agent must be non-empty.`);
}

function assertParallelStep(
	step: WorkflowParallelStep,
	stepIndex: number,
): void {
	assertConcurrency(
		step.concurrency,
		`Workflow chain step ${stepIndex + 1} concurrency`,
	);
	if (step.parallel.length === 0) {
		throw new Error(
			`Workflow chain step ${stepIndex + 1} parallel array must be non-empty.`,
		);
	}
	step.parallel.forEach((task, taskIndex) =>
		assertWorkflowTask(
			task,
			`Workflow chain step ${stepIndex + 1} parallel task ${taskIndex + 1}`,
		),
	);
}

function assertDynamicFanoutStep(
	step: WorkflowDynamicFanoutStep,
	stepIndex: number,
): void {
	const label = `Workflow dynamic fanout step ${stepIndex + 1}`;
	assertConcurrency(step.concurrency, `${label} concurrency`);
	if (!isObject(step.expand.from))
		throw new Error(`${label} requires expand.from.`);
	assertSafeOutputName(step.expand.from.output, `${label} expand.from.output`);
	assertJsonPointer(step.expand.from.path, `${label} expand.from.path`);
	if (step.expand.key !== undefined)
		assertJsonPointer(step.expand.key, `${label} expand.key`);
	if (step.expand.maxItems === undefined) {
		throw new Error(`${label} requires expand.maxItems to bound fanout.`);
	}
	if (!Number.isInteger(step.expand.maxItems) || step.expand.maxItems < 0) {
		throw new Error(`${label} expand.maxItems must be an integer >= 0.`);
	}
	if (step.expand.maxItems > MAX_DYNAMIC_ITEMS) {
		throw new Error(
			`${label} expand.maxItems must be <= ${MAX_DYNAMIC_ITEMS}.`,
		);
	}
	assertWorkflowTask(step.parallel, `${label} parallel`);
	assertSafeOutputName(step.collect.as, `${label} collect.as`);
}

function assertChain(chain: WorkflowChainStep[]): void {
	chain.forEach((step, stepIndex) => {
		if (isWorkflowTask(step)) {
			assertWorkflowTask(step, `Workflow chain step ${stepIndex + 1}`);
			return;
		}
		if (isParallelStep(step)) {
			assertParallelStep(step, stepIndex);
			return;
		}
		assertDynamicFanoutStep(step, stepIndex);
	});
}

export function parseWorkflowSpec(
	content: string,
	filePath: string,
	source: WorkflowSource,
): WorkflowSpec {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid workflow JSON: ${message}`);
	}
	if (!isObject(parsed)) throw new Error("Workflow root must be an object.");

	const {
		name,
		description,
		argumentHint,
		context,
		defaultAsync,
		concurrency,
		artifacts,
		chain,
	} = parsed;
	if (typeof name !== "string" || !WORKFLOW_NAME_PATTERN.test(name)) {
		throw new Error(
			`Invalid workflow name '${String(name)}'. Use lowercase kebab-case, optionally dotted.`,
		);
	}
	if (typeof description !== "string" || !description.trim()) {
		throw new Error("Workflow requires a non-empty description.");
	}
	if (argumentHint !== undefined && typeof argumentHint !== "string") {
		throw new Error("Workflow argumentHint must be a string when provided.");
	}
	if (context !== undefined && context !== "fresh" && context !== "fork") {
		throw new Error(
			"Workflow context must be 'fresh' or 'fork' when provided.",
		);
	}
	if (defaultAsync !== undefined && typeof defaultAsync !== "boolean") {
		throw new Error("Workflow defaultAsync must be a boolean when provided.");
	}
	assertConcurrency(concurrency, "Workflow concurrency");
	if (artifacts !== undefined && typeof artifacts !== "boolean") {
		throw new Error("Workflow artifacts must be a boolean when provided.");
	}
	if (!Array.isArray(chain) || chain.length === 0) {
		throw new Error("Workflow requires a non-empty chain array.");
	}
	if (!chain.every(isChainStep)) {
		throw new Error(
			"Every workflow chain step must be a sequential, parallel, or dynamic fanout step.",
		);
	}
	assertChain(chain);

	const workflowName = name;
	const workflowDescription = description;
	const workflowArgumentHint = argumentHint as string | undefined;
	const workflowContext = context as WorkflowSpec["context"] | undefined;
	const workflowDefaultAsync = defaultAsync as boolean | undefined;
	const workflowConcurrency = concurrency as number | undefined;
	const workflowArtifacts = artifacts as boolean | undefined;
	const workflowChain = chain;

	return {
		name: workflowName,
		description: workflowDescription,
		...(workflowArgumentHint !== undefined
			? { argumentHint: workflowArgumentHint }
			: {}),
		...(workflowContext !== undefined ? { context: workflowContext } : {}),
		...(workflowDefaultAsync !== undefined
			? { defaultAsync: workflowDefaultAsync }
			: {}),
		...(workflowConcurrency !== undefined
			? { concurrency: workflowConcurrency }
			: {}),
		...(workflowArtifacts !== undefined
			? { artifacts: workflowArtifacts }
			: {}),
		chain: workflowChain,
		source,
		filePath,
	};
}

function loadDir(
	dir: string | undefined | null,
	source: WorkflowSource,
): { workflows: WorkflowSpec[]; diagnostics: WorkflowDiagnostic[] } {
	const workflows: WorkflowSpec[] = [];
	const diagnostics: WorkflowDiagnostic[] = [];
	for (const filePath of listWorkflowFiles(dir)) {
		try {
			workflows.push(
				parseWorkflowSpec(fs.readFileSync(filePath, "utf-8"), filePath, source),
			);
		} catch (error) {
			diagnostics.push({
				filePath,
				source,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return { workflows, diagnostics };
}

export function discoverWorkflowSpecs(
	options: WorkflowDiscoveryOptions,
): WorkflowDiscoveryResult {
	const diagnostics: WorkflowDiagnostic[] = [];
	const merged = new Map<string, WorkflowSpec>();

	for (const [dir, source] of [
		[options.packageDir, "package"],
		[options.userDir, "user"],
		[options.projectDir, "project"],
	] as const) {
		const loaded = loadDir(dir, source);
		diagnostics.push(...loaded.diagnostics);
		for (const workflow of loaded.workflows)
			merged.set(workflow.name, workflow);
	}

	return {
		workflows: Array.from(merged.values()).sort((a, b) =>
			a.name.localeCompare(b.name),
		),
		diagnostics,
	};
}
