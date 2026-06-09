import { handleCommand, getGoalArgumentCompletions } from "./commands.ts";
import { queueContinuation } from "./continuation.ts";
import {
  assistantFingerprint,
  extractAssistantText,
  parseGoalMarkers,
} from "./evidence.ts";
import { applyJudgeResult, deterministicPrecheck } from "./judge.ts";
import { judgeWithCurrentModel } from "./model.ts";
import {
  appendState,
  reduceState,
  restoreStateFromEntries,
  serializeState,
} from "./state.ts";
import {
  STATE_CUSTOM_TYPE,
  type GoalJudgeResult,
  type GoalSupervisorApi,
  type GoalSupervisorState,
} from "./types.ts";

type Runtime = {
  state?: GoalSupervisorState;
};

type JudgeFn = (
  state: GoalSupervisorState,
  assistantText: string,
  evidence: string,
  ctx: ContextLike,
) => Promise<GoalJudgeResult> | GoalJudgeResult;

type GoalSupervisorDeps = {
  judge?: JudgeFn;
};

type ContextLike = {
  sessionManager?: {
    getBranch?(): unknown[];
    getCwd?(): string;
    getSessionId?(): string;
  };
  isIdle?(): boolean;
  hasPendingMessages?(): boolean;
  abort?(): void;
  signal?: AbortSignal;
  model?: { provider: string; id: string };
  modelRegistry?: {
    getApiKeyAndHeaders(model: { provider: string; id: string }): Promise<{
      ok?: boolean;
      error?: string;
      apiKey?: string;
      headers?: Record<string, string>;
    }>;
  };
  ui?: {
    notify?(message: string, type?: "info" | "warning" | "error"): void;
    setWidget?(
      key: string,
      content: string[] | undefined,
      options?: { placement?: string },
    ): void;
  };
};

type BeforeAgentStartEvent = {
  systemPrompt?: string;
  prompt?: string;
};

type TurnEndEvent = {
  message?: unknown;
};

function now(): string {
  return new Date().toISOString();
}

function contextCwd(ctx: ContextLike): string {
  return ctx.sessionManager?.getCwd?.() ?? ".";
}

function contextSessionId(ctx: ContextLike): string | undefined {
  return ctx.sessionManager?.getSessionId?.();
}

function restore(runtime: Runtime, ctx: ContextLike): void {
  const branch = ctx.sessionManager?.getBranch?.();
  if (!branch) return;
  runtime.state = restoreStateFromEntries(
    branch.map(
      (entry) =>
        entry as { type?: string; customType?: string; data?: unknown },
    ),
  );
}

function safeNotify(
  ctx: ContextLike,
  message: string,
  type: "info" | "warning" | "error" = "info",
): void {
  try {
    ctx.ui?.notify?.(message, type);
  } catch (error) {
    if (!String(error).includes("stale")) throw error;
  }
}

function updateWidget(
  ctx: ContextLike,
  state: GoalSupervisorState | undefined,
): void {
  try {
    if (
      !state ||
      state.status === "idle" ||
      state.status === "stopped" ||
      state.status === "complete"
    ) {
      ctx.ui?.setWidget?.("goal-supervisor", undefined);
      return;
    }
    ctx.ui?.setWidget?.(
      "goal-supervisor",
      [
        `goal: ${state.status} ${state.iteration} turns`,
        state.objective.slice(0, 100),
      ],
      { placement: "aboveEditor" },
    );
  } catch (error) {
    if (!String(error).includes("stale")) throw error;
  }
}

function queueIfSafe(
  runtime: Runtime,
  pi: GoalSupervisorApi,
  ctx: ContextLike,
  reason: Parameters<typeof queueContinuation>[2]["reason"],
): void {
  if (!runtime.state) return;
  runtime.state = queueContinuation(runtime.state, pi, {
    idle: ctx.isIdle?.() ?? true,
    pendingMessages: ctx.hasPendingMessages?.() ?? false,
    now: now(),
    reason,
  });
  updateWidget(ctx, runtime.state);
}

async function judgeCurrentClaim(
  runtime: Runtime,
  deps: GoalSupervisorDeps,
  ctx: ContextLike,
  assistantText: string,
): Promise<void> {
  if (!runtime.state?.lastDoneClaim) return;
  const evidence = runtime.state.lastDoneClaim.evidence;
  const precheck = deterministicPrecheck(assistantText, evidence, now());
  const judgeResult =
    precheck.verdict === "inconclusive"
      ? await (deps.judge ?? judgeWithCurrentModel)(
          runtime.state,
          assistantText,
          evidence,
          ctx,
        )
      : precheck;
  runtime.state = applyJudgeResult(runtime.state, judgeResult);
}

function supervisorPrompt(state: GoalSupervisorState): string {
  return `\n\n## Goal Supervisor\nActive objective: ${state.objective}\nStatus: ${state.status}; turns: ${state.iteration}.\nUse the normal Pi tools/extensions already available. This supervisor does not change tools or permissions.\nDo not ask the human unless truly blocked. If blocked, write: GOAL_BLOCKED: <specific blocker>.\nWhen fully complete, write: GOAL_DONE: <specific evidence from transcript/artifacts/verifications>.`;
}

export function registerGoalSupervisor(
  pi: GoalSupervisorApi,
  runtime: Runtime = {},
  deps: GoalSupervisorDeps = {},
): void {
  pi.registerCommand?.("goal", {
    description:
      "Run a session-scoped goal until evidence-backed completion. Usage: /goal <objective> | start <objective> | status | pause | resume | stop | clear | done <evidence> | help",
    getArgumentCompletions: getGoalArgumentCompletions,
    handler: async (args: string, rawCtx: unknown) => {
      const ctx = rawCtx as ContextLike;
      restore(runtime, ctx);
      try {
        const result = handleCommand(runtime.state, args, {
          cwd: contextCwd(ctx),
          sessionId: contextSessionId(ctx),
          now: now(),
        });
        runtime.state = result.state;
        if (runtime.state) appendState(pi, runtime.state);
        safeNotify(ctx, result.message);
        updateWidget(ctx, runtime.state);
        if (runtime.state?.status === "judging") {
          await judgeCurrentClaim(
            runtime,
            deps,
            ctx,
            runtime.state.lastAssistantText ?? "",
          );
          if (runtime.state) appendState(pi, runtime.state);
          updateWidget(ctx, runtime.state);
          const statusAfterJudge: string | undefined = runtime.state?.status;
          if (statusAfterJudge === "running")
            queueIfSafe(runtime, pi, ctx, "judge_rejected");
        }
        if (
          runtime.state?.status === "paused" ||
          runtime.state?.status === "stopped"
        ) {
          ctx.abort?.();
        }
        if (
          result.shouldQueueContinuation &&
          runtime.state &&
          result.continuationReason
        )
          queueIfSafe(runtime, pi, ctx, result.continuationReason);
      } catch (error) {
        safeNotify(
          ctx,
          error instanceof Error ? error.message : String(error),
          "warning",
        );
      }
    },
  });

  pi.on?.("session_start", (_event: unknown, rawCtx: unknown) => {
    const ctx = rawCtx as ContextLike;
    restore(runtime, ctx);
    updateWidget(ctx, runtime.state);
    queueIfSafe(runtime, pi, ctx, "session_start");
  });

  pi.on?.("before_agent_start", (rawEvent: unknown, rawCtx: unknown) => {
    const event = rawEvent as BeforeAgentStartEvent;
    const ctx = rawCtx as ContextLike;
    restore(runtime, ctx);
    if (!runtime.state || runtime.state.status !== "running") return undefined;
    if (
      runtime.state.pendingContinuation &&
      event.prompt?.includes(runtime.state.pendingContinuation.id)
    ) {
      runtime.state = reduceState(runtime.state, {
        type: "continuation_delivered",
        now: now(),
      });
      appendState(pi, runtime.state);
    }
    return {
      systemPrompt: `${event.systemPrompt ?? ""}${supervisorPrompt(runtime.state)}`,
    };
  });

  pi.on?.("turn_end", async (rawEvent: unknown, rawCtx: unknown) => {
    const ctx = rawCtx as ContextLike;
    restore(runtime, ctx);
    if (!runtime.state || runtime.state.status !== "running") return;
    const event = rawEvent as TurnEndEvent;
    const assistantText = extractAssistantText(
      event.message as { content?: unknown },
    );
    runtime.state = reduceState(runtime.state, {
      type: "turn_recorded",
      assistantText,
      fingerprint: assistantFingerprint(assistantText),
      now: now(),
    });
    const markers = parseGoalMarkers(assistantText);
    if (markers.blocked)
      runtime.state = reduceState(runtime.state, {
        type: "blocked",
        reason: markers.blocked,
        now: now(),
      });
    else if (markers.done) {
      runtime.state = reduceState(runtime.state, {
        type: "done_claimed",
        evidence: markers.done,
        source: "marker",
        now: now(),
      });
      await judgeCurrentClaim(runtime, deps, ctx, assistantText);
    }
    appendState(pi, runtime.state);
    updateWidget(ctx, runtime.state);
    queueIfSafe(runtime, pi, ctx, "turn_end");
  });

  pi.on?.("session_before_compact", (_event: unknown) => {
    if (runtime.state)
      pi.appendEntry?.(STATE_CUSTOM_TYPE, serializeState(runtime.state));
    return undefined;
  });

  pi.on?.("session_compact", (_event: unknown, rawCtx: unknown) => {
    const ctx = rawCtx as ContextLike;
    restore(runtime, ctx);
    if (runtime.state)
      runtime.state = reduceState(runtime.state, {
        type: "compacted",
        now: now(),
      });
    if (runtime.state) appendState(pi, runtime.state);
    queueIfSafe(runtime, pi, ctx, "compact");
  });

  pi.on?.("session_tree", (_event: unknown, rawCtx: unknown) => {
    const ctx = rawCtx as ContextLike;
    restore(runtime, ctx);
    updateWidget(ctx, runtime.state);
  });

  pi.on?.("session_shutdown", () => {
    if (runtime.state)
      pi.appendEntry?.(STATE_CUSTOM_TYPE, serializeState(runtime.state));
  });
}

export default async function piGoalSupervisor(
  pi: GoalSupervisorApi,
): Promise<void> {
  registerGoalSupervisor(pi);
}
