/**
 * Compact Advisor
 *
 * Keeps unattended threshold auto-compaction moving by queueing a small
 * follow-up continuation after Pi's successful compaction hook.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const COMPACTION_CANDIDATE_MAX_AGE_MS = 30_000;
const AUTO_CONTINUE_MESSAGE = `Auto-compaction completed. Continue the active task from the compaction summary and recent messages.

Rules:
- Do not ask for confirmation just because compaction occurred.
- Do not restate the compaction summary.
- If there is a clear next action, take it now.
- If the task is already complete, give the final concise status and stop.`;

type ThresholdCandidate = {
	contextWindow: number;
	createdAt: number;
	tokens: number;
};

function isStaleContextError(error: unknown) {
	return (
		error instanceof Error &&
		error.message.includes(
			"extension ctx is stale after session replacement or reload",
		)
	);
}

function isSuccessfulAssistantEnd(event: { messages: unknown[] }) {
	for (let i = event.messages.length - 1; i >= 0; i--) {
		const message = event.messages[i];
		if (!message || typeof message !== "object") continue;
		if (!("role" in message) || message.role !== "assistant") continue;
		const stopReason = "stopReason" in message ? message.stopReason : undefined;
		return stopReason !== "error" && stopReason !== "aborted";
	}
	return false;
}

export default function (pi: ExtensionAPI) {
	let thresholdCandidate: ThresholdCandidate | undefined;
	let shouldAutoContinueAfterCompact = false;

	pi.on("agent_end", (event, ctx) => {
		try {
			const usage = ctx.getContextUsage();
			const now = Date.now();
			thresholdCandidate = undefined;

			if (
				usage?.tokens !== null &&
				usage?.tokens !== undefined &&
				usage.contextWindow > 0 &&
				isSuccessfulAssistantEnd(event)
			) {
				thresholdCandidate = {
					contextWindow: usage.contextWindow,
					createdAt: now,
					tokens: usage.tokens,
				};
			}
		} catch (error) {
			if (isStaleContextError(error)) return;
			throw error;
		}
	});

	pi.on("session_before_compact", (event, ctx) => {
		try {
			shouldAutoContinueAfterCompact = false;
			const candidate = thresholdCandidate;
			thresholdCandidate = undefined;
			if (!candidate) return;
			if (Date.now() - candidate.createdAt > COMPACTION_CANDIDATE_MAX_AGE_MS)
				return;
			if (ctx.isIdle()) return;
			if (ctx.hasPendingMessages()) return;
			if (event.customInstructions) return;

			const thresholdTokens =
				candidate.contextWindow - event.preparation.settings.reserveTokens;
			if (event.preparation.tokensBefore <= thresholdTokens) return;
			if (candidate.tokens <= thresholdTokens) return;

			shouldAutoContinueAfterCompact = true;
		} catch (error) {
			if (isStaleContextError(error)) return;
			throw error;
		}
	});

	pi.on("session_compact", (_event, ctx) => {
		try {
			if (!shouldAutoContinueAfterCompact) return;
			shouldAutoContinueAfterCompact = false;
			if (ctx.hasPendingMessages()) return;

			pi.sendMessage(
				{
					customType: "auto-compaction-continue",
					content: AUTO_CONTINUE_MESSAGE,
					display: true,
				},
				{ deliverAs: "followUp", triggerTurn: true },
			);
		} catch (error) {
			if (isStaleContextError(error)) return;
			throw error;
		}
	});
}
