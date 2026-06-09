import { createInitialState, reduceState } from "./state.ts";
import type {
  CommandContext,
  ContinuationReason,
  GoalSupervisorState,
} from "./types.ts";

export type GoalCommand =
  | { action: "status" }
  | { action: "start"; objective: string }
  | { action: "pause"; reason?: string }
  | { action: "resume" }
  | { action: "stop"; reason?: string }
  | { action: "clear" }
  | { action: "done"; evidence: string }
  | { action: "help" };

export type CommandResult = {
  state: GoalSupervisorState | undefined;
  message: string;
  shouldQueueContinuation: boolean;
  continuationReason?: ContinuationReason;
};

const RESERVED = new Set([
  "status",
  "start",
  "pause",
  "resume",
  "stop",
  "clear",
  "done",
  "help",
]);

function splitArgs(args: string): string[] {
  return args.trim().split(/\s+/).filter(Boolean);
}

function restAfterFirst(args: string): string {
  const trimmed = args.trim();
  const firstSpace = trimmed.search(/\s/);
  return firstSpace === -1 ? "" : trimmed.slice(firstSpace).trim();
}

export function parseGoalCommand(args: string): GoalCommand {
  const tokens = splitArgs(args);
  if (tokens.length === 0) return { action: "status" };
  const first = tokens[0]?.toLowerCase() ?? "";
  if (!RESERVED.has(first)) return { action: "start", objective: args.trim() };
  switch (first) {
    case "status":
      return { action: "status" };
    case "start": {
      const objective = restAfterFirst(args);
      if (!objective) throw new Error("Goal objective is required");
      return { action: "start", objective };
    }
    case "pause":
      return { action: "pause", reason: restAfterFirst(args) || undefined };
    case "resume":
      return { action: "resume" };
    case "stop":
      return { action: "stop", reason: restAfterFirst(args) || undefined };
    case "clear":
      return { action: "clear" };
    case "done": {
      const evidence = restAfterFirst(args);
      if (!evidence) throw new Error("Completion evidence is required");
      return { action: "done", evidence };
    }
    case "help":
      return { action: "help" };
    default:
      throw new Error(`Unknown goal command: ${first}`);
  }
}

function requireState(
  state: GoalSupervisorState | undefined,
): GoalSupervisorState {
  if (!state) throw new Error("No active goal");
  return state;
}

function formatStatus(state: GoalSupervisorState | undefined): string {
  if (!state) return "No active goal.";
  return `Goal ${state.status}: ${state.objective} (${state.iteration} turns)`;
}

export function handleCommand(
  state: GoalSupervisorState | undefined,
  args: string,
  ctx: CommandContext,
): CommandResult {
  const command = parseGoalCommand(args);
  switch (command.action) {
    case "status":
      return {
        state,
        message: formatStatus(state),
        shouldQueueContinuation: false,
      };
    case "help":
      return {
        state,
        message:
          "Usage: /goal <objective> | start <objective> | status | pause | resume | stop | clear | done <evidence> | help",
        shouldQueueContinuation: false,
      };
    case "start": {
      const next = state
        ? reduceState(state, {
            type: "started",
            objective: command.objective,
            now: ctx.now,
          })
        : createInitialState({
            objective: command.objective,
            cwd: ctx.cwd,
            sessionId: ctx.sessionId,
            now: ctx.now,
          });
      return {
        state: next,
        message: `Goal started: ${next.objective}`,
        shouldQueueContinuation: true,
        continuationReason: "start",
      };
    }
    case "pause": {
      const next = reduceState(requireState(state), {
        type: "paused",
        reason: command.reason,
        now: ctx.now,
      });
      return {
        state: next,
        message: "Goal paused.",
        shouldQueueContinuation: false,
      };
    }
    case "resume": {
      const next = reduceState(requireState(state), {
        type: "resumed",
        now: ctx.now,
      });
      return {
        state: next,
        message: "Goal resumed.",
        shouldQueueContinuation: true,
        continuationReason: "resume",
      };
    }
    case "stop": {
      const next = reduceState(requireState(state), {
        type: "stopped",
        reason: command.reason,
        now: ctx.now,
      });
      return {
        state: next,
        message: "Goal stopped.",
        shouldQueueContinuation: false,
      };
    }
    case "clear": {
      const next = reduceState(requireState(state), {
        type: "stopped",
        reason: "cleared",
        now: ctx.now,
      });
      return {
        state: next,
        message: "Goal cleared.",
        shouldQueueContinuation: false,
      };
    }
    case "done": {
      const next = reduceState(requireState(state), {
        type: "done_claimed",
        evidence: command.evidence,
        source: "command",
        now: ctx.now,
      });
      return {
        state: next,
        message: "Goal completion evidence recorded; judging required.",
        shouldQueueContinuation: false,
      };
    }
  }
}

export function getGoalArgumentCompletions(
  argumentText: string,
): Array<{ value: string; label: string }> {
  const current = argumentText.trim().split(/\s+/).at(-1) ?? "";
  return ["status", "start", "pause", "resume", "stop", "clear", "done", "help"]
    .filter((item) => item.startsWith(current))
    .map((item) => ({ value: item, label: item }));
}
