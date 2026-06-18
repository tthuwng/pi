import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type {
	PlannedWorkflowParams,
	WorkflowChainStep,
	WorkflowSpec,
} from "./types.js";

export type WorkflowRunStatus =
	| "planned"
	| "running"
	| "completed"
	| "failed"
	| "cancelled";

const RUN_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface WorkflowRunUpdate {
	at: string;
	type: "started" | "tool" | "message" | "cancelled" | "error";
	text?: string;
	toolCount?: number;
	currentTool?: string;
	details?: unknown;
}

export interface WorkflowRunRecord {
	id: string;
	workflowName: string;
	workflowDescription: string;
	args: string;
	status: WorkflowRunStatus;
	context: PlannedWorkflowParams["context"];
	async: boolean;
	phases: string[];
	chainLength: number;
	createdAt: string;
	updatedAt: string;
	startedAt?: string;
	finishedAt?: string;
	requestId?: string;
	resultText?: string;
	errorText?: string;
	updates?: WorkflowRunUpdate[];
	savedCommandPath?: string;
}

export function defaultRunDir(): string {
	return path.join(os.homedir(), ".pi", "agent", "dynamic-workflows", "runs");
}

function assertRunId(runId: string): void {
	if (!RUN_ID_PATTERN.test(runId))
		throw new Error(`Invalid workflow run id: ${runId}`);
}

function runPath(runDir: string, runId: string): string {
	assertRunId(runId);
	const base = path.resolve(runDir);
	const filePath = path.resolve(base, `${runId}.json`);
	if (path.dirname(filePath) !== base) {
		throw new Error(`Workflow run path escaped run directory: ${runId}`);
	}
	return filePath;
}

function ensureRunDir(runDir: string): void {
	fs.mkdirSync(runDir, { recursive: true });
}

function readRun(runDir: string, runId: string): WorkflowRunRecord {
	return JSON.parse(
		fs.readFileSync(runPath(runDir, runId), "utf-8"),
	) as WorkflowRunRecord;
}

function writeRun(runDir: string, record: WorkflowRunRecord): void {
	ensureRunDir(runDir);
	fs.writeFileSync(
		runPath(runDir, record.id),
		`${JSON.stringify(record, null, 2)}\n`,
	);
}

function boundedUpdates(
	record: WorkflowRunRecord,
	update: WorkflowRunUpdate,
	limit: number,
): WorkflowRunUpdate[] {
	return [...(record.updates ?? []), update].slice(-limit);
}

function stepPhase(step: WorkflowChainStep): string | undefined {
	if ("phase" in step && typeof step.phase === "string" && step.phase.trim()) {
		return step.phase.trim();
	}
	if ("label" in step && typeof step.label === "string" && step.label.trim()) {
		return step.label.trim();
	}
	if ("parallel" in step && Array.isArray(step.parallel)) {
		return step.parallel
			.map((task) => task.phase ?? task.label)
			.find(
				(value): value is string =>
					typeof value === "string" && value.trim().length > 0,
			)
			?.trim();
	}
	if ("parallel" in step && !Array.isArray(step.parallel)) {
		return step.parallel.phase?.trim() || step.parallel.label?.trim();
	}
	return undefined;
}

export function workflowPhases(chain: WorkflowChainStep[]): string[] {
	const phases: string[] = [];
	for (const step of chain) {
		const phase = stepPhase(step);
		if (phase && !phases.includes(phase)) phases.push(phase);
	}
	return phases;
}

export function createWorkflowRun(
	runDir: string,
	workflow: WorkflowSpec,
	params: PlannedWorkflowParams,
): WorkflowRunRecord {
	const now = new Date().toISOString();
	const record: WorkflowRunRecord = {
		id: randomUUID(),
		workflowName: workflow.name,
		workflowDescription: workflow.description,
		args: params.task,
		status: "planned",
		context: params.context,
		async: params.async,
		phases: workflowPhases(params.chain),
		chainLength: params.chain.length,
		createdAt: now,
		updatedAt: now,
	};
	writeRun(runDir, record);
	return record;
}

export function startWorkflowRun(
	runDir: string,
	runId: string,
): WorkflowRunRecord {
	const now = new Date().toISOString();
	const previous = readRun(runDir, runId);
	const record = {
		...previous,
		status: "running" as const,
		startedAt: now,
		updatedAt: now,
		updates: boundedUpdates(
			previous,
			{ at: now, type: "started", text: "Workflow started." },
			50,
		),
	};
	writeRun(runDir, record);
	return record;
}

export function attachWorkflowRequest(
	runDir: string,
	runId: string,
	requestId: string,
): WorkflowRunRecord {
	const record = {
		...readRun(runDir, runId),
		requestId,
		updatedAt: new Date().toISOString(),
	};
	writeRun(runDir, record);
	return record;
}

export function appendWorkflowRunUpdate(
	runDir: string,
	runId: string,
	update: Omit<WorkflowRunUpdate, "at"> & { at?: string },
	limit = 50,
): WorkflowRunRecord {
	const now = new Date().toISOString();
	const previous = readRun(runDir, runId);
	const nextUpdate: WorkflowRunUpdate = { ...update, at: update.at ?? now };
	const record = {
		...previous,
		updatedAt: now,
		updates: boundedUpdates(previous, nextUpdate, limit),
	};
	writeRun(runDir, record);
	return record;
}

export function cancelWorkflowRun(
	runDir: string,
	runId: string,
	reason = "Workflow cancelled.",
): WorkflowRunRecord {
	const now = new Date().toISOString();
	const previous = readRun(runDir, runId);
	const record = {
		...previous,
		status: "cancelled" as const,
		finishedAt: now,
		updatedAt: now,
		errorText: reason,
		updates: boundedUpdates(
			previous,
			{ at: now, type: "cancelled", text: reason },
			50,
		),
	};
	writeRun(runDir, record);
	return record;
}

export function finishWorkflowRun(
	runDir: string,
	runId: string,
	result: {
		status: "completed" | "failed";
		resultText?: string;
		errorText?: string;
	},
): WorkflowRunRecord {
	const now = new Date().toISOString();
	const record = {
		...readRun(runDir, runId),
		status: result.status,
		finishedAt: now,
		updatedAt: now,
		...(result.resultText !== undefined
			? { resultText: result.resultText }
			: {}),
		...(result.errorText !== undefined ? { errorText: result.errorText } : {}),
	};
	writeRun(runDir, record);
	return record;
}

export function listWorkflowRuns(
	runDir: string,
	limit = 10,
): WorkflowRunRecord[] {
	try {
		return fs
			.readdirSync(runDir, { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
			.map((entry) => readRun(runDir, path.basename(entry.name, ".json")))
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
			.slice(0, limit);
	} catch {
		return [];
	}
}
