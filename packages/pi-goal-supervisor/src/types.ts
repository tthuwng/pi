export const STATE_CUSTOM_TYPE = "goal-supervisor-state";
export const CONTINUATION_CUSTOM_TYPE = "goal-supervisor-continuation";

export type GoalStatus =
	| "idle"
	| "running"
	| "paused"
	| "judging"
	| "blocked"
	| "complete"
	| "stopped";

export type ContinuationReason =
	| "start"
	| "turn_end"
	| "resume"
	| "judge_rejected"
	| "compact"
	| "session_start";

export type GoalJudgeVerdict = "approved" | "rejected" | "inconclusive";

export type GoalJudgeResult = {
	verdict: GoalJudgeVerdict;
	score: number;
	reason: string;
	missingEvidence: string[];
	nextAction?: string;
	model?: string;
	at: string;
};

export type GoalSupervisorState = {
	version: 1;
	id: string;
	cwd: string;
	sessionId?: string;
	objective: string;
	status: GoalStatus;
	createdAt: string;
	updatedAt: string;
	startedAt: string;
	completedAt?: string;
	iteration: number;
	pendingContinuation?: {
		id: string;
		queuedAt: string;
		reason: ContinuationReason;
		deliveredAt?: string;
	};
	lastContinuationAt?: string;
	lastAssistantFingerprint?: string;
	repeatedFingerprintCount: number;
	noProgressTurns: number;
	lastAssistantText?: string;
	lastDoneClaim?: {
		evidence: string;
		at: string;
		source: "marker" | "command";
	};
	lastBlocker?: {
		reason: string;
		at: string;
		source: "marker" | "question" | "judge_error";
	};
	lastJudge?: GoalJudgeResult;
	counters: {
		judgeAttempts: number;
		judgeErrors: number;
		compactionsObserved: number;
		continuationsQueued: number;
	};
};

export type CustomSessionEntry = {
	type?: string;
	customType?: string;
	data?: unknown;
};

export type SendMessageCall = {
	message: {
		customType: string;
		content: string;
		display: boolean;
		details?: Record<string, unknown>;
	};
	options: {
		deliverAs: "followUp";
		triggerTurn: true;
	};
};

export type GoalSupervisorApi = {
	sendMessage?(
		message: SendMessageCall["message"],
		options: SendMessageCall["options"],
	): void;
	appendEntry?(customType: string, data?: unknown): void;
	on?(
		event: string,
		handler: (event: unknown, ctx: unknown) => void | Promise<void> | unknown,
	): void;
	registerCommand?(
		name: string,
		options: {
			description?: string;
			getArgumentCompletions?: (
				argumentPrefix: string,
			) => Array<{ value: string; label: string }> | null;
			handler: (args: string, ctx: unknown) => Promise<void>;
		},
	): void;
};

export type CommandContext = {
	cwd: string;
	sessionId?: string;
	now: string;
};
