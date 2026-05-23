/**
 * pi-rewind — /rewind command and Esc+Esc shortcut
 *
 * Registers the user-facing rewind command which presents a checkpoint
 * browser and restore options.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { RewindState } from "./state.js";
import type { CheckpointData } from "./core.js";
import { restoreCheckpoint, createCheckpoint, deleteCheckpoint, diffCheckpoints, git } from "./core.js";

// ============================================================================
// Helpers
// ============================================================================

function formatClock(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function sameLocalDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

export function formatCheckpointTime(ts: number, nowMs = Date.now()): string {
  const d = new Date(ts);
  const now = new Date(nowMs);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (sameLocalDate(d, now)) return `Today ${formatClock(ts)}`;
  if (sameLocalDate(d, yesterday)) return `Yesterday ${formatClock(ts)}`;

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${formatClock(ts)}`;
}

function singleLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function truncate(s: string, maxLen: number): string {
  const clean = singleLine(s);
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 1) + "…";
}

function legacyDescriptionParts(description?: string): { prompt?: string; tools?: string } {
  if (!description) return {};
  if (!description.startsWith("\"")) return { tools: description };

  const separator = description.indexOf("\" → ", 1);
  if (separator === -1) return { prompt: description.slice(1) };

  return {
    prompt: description.slice(1, separator),
    tools: description.slice(separator + "\" → ".length),
  };
}

function checkpointConversation(cp: CheckpointData): string {
  const legacy = legacyDescriptionParts(cp.description);
  const prompt = cp.prompt || legacy.prompt;
  if (prompt) return `User: \"${truncate(prompt, 120)}\"`;
  if (cp.trigger === "resume") return "Session start";
  return `Turn ${cp.turnIndex}`;
}

function checkpointToolSummary(cp: CheckpointData): string {
  if (cp.toolDescriptions && cp.toolDescriptions.length > 0) {
    return cp.toolDescriptions.map((tool) => truncate(tool, 70)).join(", ");
  }

  const legacy = legacyDescriptionParts(cp.description);
  if (legacy.tools) return truncate(legacy.tools, 180);
  if (cp.toolName) return cp.toolName;
  return "no recorded file/tool activity";
}

function checkpointToolLines(cp: CheckpointData): string[] {
  if (cp.toolDescriptions && cp.toolDescriptions.length > 0) {
    return cp.toolDescriptions.map((tool) => `  - ${truncate(tool, 140)}`);
  }

  const legacy = legacyDescriptionParts(cp.description);
  if (legacy.tools) return [`  - ${truncate(legacy.tools, 220)}`];
  if (cp.toolName) return [`  - ${cp.toolName}`];
  return ["  - No recorded file/tool activity"];
}

export function formatCheckpointLabel(cp: CheckpointData, index: number, _state: RewindState, currentBranch?: string, nowMs = Date.now()): string {
  const time = formatCheckpointTime(cp.timestamp, nowMs);
  const branchTag = (cp.branch && currentBranch && cp.branch !== currentBranch)
    ? ` ⚠️ ${cp.branch}`
    : (cp.branch ? ` [${cp.branch}]` : "");

  return `#${index + 1} ${time}${branchTag} | Conversation: ${checkpointConversation(cp)} | Files/tools: ${checkpointToolSummary(cp)}`;
}

type RestoreMode = "all" | "files" | "conversation" | "cancel";

const RESTORE_OPTIONS: { label: string; value: RestoreMode }[] = [
  { label: "Restore all (files + conversation)", value: "all" },
  { label: "Files only (keep conversation)", value: "files" },
  { label: "Conversation only (keep files)", value: "conversation" },
  { label: "Cancel", value: "cancel" },
];

function findConversationTarget(
  ctx: import("@mariozechner/pi-coding-agent").ExtensionCommandContext,
  target: CheckpointData,
): any | null {
  const branch = ctx.sessionManager.getBranch();
  return branch.reduce((best: any, entry: any) => {
    if (!entry.timestamp) return best;
    const entryTs = new Date(entry.timestamp).getTime();
    if (!best) return entryTs <= target.timestamp ? entry : best;
    const bestTs = new Date(best.timestamp).getTime();
    if (entryTs <= target.timestamp && entryTs > bestTs) return entry;
    return best;
  }, null);
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content.map((part) => {
    if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
      return part.text;
    }
    return "";
  }).filter(Boolean).join(" ");
}

function summarizeConversationEntry(entry: any): string {
  if (!entry) return "No matching conversation entry found";
  if (entry.type !== "message" || !entry.message) {
    return `${entry.type || "entry"} at ${entry.timestamp || "unknown time"}`;
  }

  const role = entry.message.role || "message";
  const text = truncate(contentText(entry.message.content), 180);
  return text ? `${role}: ${text}` : `${role}: (no text content)`;
}

function formatDiffPreview(diff: string): string {
  if (!diff || diff === "(diff unavailable)") return "  No file diff from checkpoint to current HEAD.";
  const maxLen = 2000;
  if (diff.length <= maxLen) return diff;
  return `${diff.slice(0, maxLen)}\n… diff truncated to ${maxLen} characters`;
}

export function formatCheckpointPreview(
  cp: CheckpointData,
  index: number,
  conversationTarget: any,
  diffText: string,
  nowMs = Date.now(),
): string {
  return [
    `Checkpoint #${index + 1} — ${formatCheckpointTime(cp.timestamp, nowMs)}`,
    "",
    "Conversation checkpoint:",
    `  - ${checkpointConversation(cp)}`,
    `  - Restore target: ${summarizeConversationEntry(conversationTarget)}`,
    "",
    "File checkpoint:",
    ...checkpointToolLines(cp),
    "",
    "Diff from checkpoint to current files:",
    formatDiffPreview(diffText),
  ].join("\n");
}

async function diffCheckpointToCurrent(state: RewindState, target: CheckpointData): Promise<string> {
  if (!state.repoRoot || !state.sessionId) return "(diff unavailable)";

  const previewId = `preview-${state.sessionId}-${Date.now()}`;
  let previewCheckpoint: CheckpointData | null = null;

  try {
    previewCheckpoint = await createCheckpoint({
      root: state.repoRoot,
      id: previewId,
      sessionId: state.sessionId,
      trigger: "turn",
      turnIndex: state.currentTurnIndex,
      description: "Preview current files",
    });
    return await diffCheckpoints(state.repoRoot, target.worktreeTreeSha, previewCheckpoint.worktreeTreeSha);
  } finally {
    if (previewCheckpoint) {
      await deleteCheckpoint(state.repoRoot, previewCheckpoint.id).catch(() => {});
    }
  }
}

// ============================================================================
// Rewind flow
// ============================================================================

async function runRewindFlow(
  state: RewindState,
  ctx: import("@mariozechner/pi-coding-agent").ExtensionCommandContext,
): Promise<void> {
  if (!state.gitAvailable || !state.repoRoot || !state.sessionId) {
    ctx.ui.notify("Rewind not available (no git repo or session)", "warning");
    return;
  }

  // Collect checkpoints sorted newest-first (limit to 25 most recent)
  const MAX_DISPLAY = 25;
  const checkpoints = [...state.checkpoints.values()]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_DISPLAY);

  if (checkpoints.length === 0) {
    ctx.ui.notify("No checkpoints available", "warning");
    return;
  }

  // Build picker items
  const items: string[] = [];
  const currentBranch = await git("rev-parse --abbrev-ref HEAD", state.repoRoot).catch(() => "unknown");
  const undoRef = state.redoStack.length > 0 ? state.redoStack[state.redoStack.length - 1] : null;
  if (undoRef) {
    items.push("↩ Undo last rewind");
  }
  for (let i = 0; i < checkpoints.length; i++) {
    items.push(formatCheckpointLabel(checkpoints[i], i, state, currentBranch));
  }

  const choice = await ctx.ui.select("Rewind to checkpoint (newest first):", items);
  if (!choice) {
    ctx.ui.notify("Rewind cancelled", "info");
    return;
  }

  // Handle undo
  if (choice === "↩ Undo last rewind" && undoRef) {
    await performRestore(state, ctx, undoRef, "files");
    state.redoStack.pop();
    ctx.ui.notify("Undo successful — files restored to before last rewind", "info");
    return;
  }

  // Find selected checkpoint
  const idx = items.indexOf(choice) - (undoRef ? 1 : 0);
  if (idx < 0 || idx >= checkpoints.length) return;
  const target = checkpoints[idx];

  // Show an explicit preview before choosing restore mode.
  let diffText = "";
  try {
    diffText = await diffCheckpointToCurrent(state, target);
  } catch {
    diffText = "(diff unavailable)";
  }

  const targetEntry = findConversationTarget(ctx, target);
  const proceed = await ctx.ui.confirm(
    formatCheckpointPreview(target, idx, targetEntry, diffText),
    "Proceed to restore mode?",
  );
  if (!proceed) {
    ctx.ui.notify("Rewind cancelled", "info");
    return;
  }

  // Ask restore mode
  const modeChoice = await ctx.ui.select(
    "Restore mode:",
    RESTORE_OPTIONS.map((o) => o.label),
  );
  const mode = RESTORE_OPTIONS.find((o) => o.label === modeChoice)?.value ?? "cancel";
  if (mode === "cancel") {
    ctx.ui.notify("Rewind cancelled", "info");
    return;
  }

  if (mode === "files" || mode === "all") {
    await performRestore(state, ctx, target, "files");
  }

  if (mode === "conversation" || mode === "all") {
    // Navigate conversation tree to the checkpoint's point.
    if (targetEntry) {
      try {
        await ctx.navigateTree(targetEntry.id, { summarize: true });
      } catch {
        ctx.ui.notify("Conversation rewind partially failed", "warning");
      }
    }
  }

  const what = mode === "all" ? "files + conversation"
    : mode === "files" ? "files" : "conversation";
  ctx.ui.notify(`Rewound ${what} to checkpoint #${idx + 1}`, "info");
}

async function performRestore(
  state: RewindState,
  ctx: { ui: { notify: (msg: string, level: "info" | "warning" | "error") => void } },
  target: CheckpointData,
  _mode: "files",
): Promise<void> {
  if (!state.repoRoot || !state.sessionId) return;

  // Create before-restore checkpoint (safety net)
  try {
    const beforeId = `before-restore-${state.sessionId}-${Date.now()}`;
    const beforeCp = await createCheckpoint({
      root: state.repoRoot,
      id: beforeId,
      sessionId: state.sessionId,
      trigger: "before-restore",
      turnIndex: 0,
    });
    state.redoStack.push(beforeCp);
  } catch {
    // Continue anyway — we tried
  }

  // Restore files
  try {
    await restoreCheckpoint(state.repoRoot, target);
  } catch (err) {
    ctx.ui.notify(`Restore failed: ${err instanceof Error ? err.message : err}`, "error");
  }
}

// ============================================================================
// Handle fork/tree restore prompts
// ============================================================================

export async function handleForkRestore(
  state: RewindState,
  event: { entryId: string },
  ctx: any,
): Promise<{ cancel: true } | { skipConversationRestore: true } | undefined> {
  if (!state.gitAvailable || !state.repoRoot || !state.sessionId) return undefined;
  if (!ctx.hasUI) return undefined;

  const entry = ctx.sessionManager.getEntry(event.entryId);
  const targetTs = entry?.timestamp ? new Date(entry.timestamp).getTime() : Date.now();

  // Find best checkpoint
  const sorted = [...state.checkpoints.values()].sort((a, b) => b.timestamp - a.timestamp);
  const target = sorted.find((cp) => cp.timestamp <= targetTs) ?? sorted[sorted.length - 1];

  if (!target && state.resumeCheckpoint) {
    // Use resume checkpoint as fallback
  }

  const cp = target || state.resumeCheckpoint;

  const options: string[] = ["Conversation only (keep files)"];
  if (cp) {
    options.push("Restore all (files + conversation)");
    options.push("Code only (restore files, keep conversation)");
  }
  if (state.redoStack.length > 0) {
    options.push("↩ Undo last rewind");
  }
  options.push("Cancel");

  const choice = await ctx.ui.select("Restore Options", options);

  if (!choice || choice === "Cancel") return { cancel: true };
  if (choice === "Conversation only (keep files)") return undefined;

  if (choice === "↩ Undo last rewind" && state.redoStack.length > 0) {
    const undoCp = state.redoStack.pop()!;
    await performRestore(state, ctx, undoCp, "files");
    ctx.ui.notify("Files restored to before last rewind", "info");
    return { cancel: true };
  }

  if (!cp) {
    ctx.ui.notify("No checkpoint available", "warning");
    return undefined;
  }

  await performRestore(state, ctx, cp, "files");
  ctx.ui.notify("Files restored from checkpoint", "info");

  if (choice === "Code only (restore files, keep conversation)") {
    return { skipConversationRestore: true };
  }

  return undefined;
}

export async function handleTreeRestore(
  state: RewindState,
  event: { preparation: { targetId: string } },
  ctx: any,
): Promise<{ cancel: true } | undefined> {
  if (!state.gitAvailable || !state.repoRoot || !state.sessionId) return undefined;
  if (!ctx.hasUI) return undefined;

  const entry = ctx.sessionManager.getEntry(event.preparation.targetId);
  const targetTs = entry?.timestamp ? new Date(entry.timestamp).getTime() : Date.now();

  const sorted = [...state.checkpoints.values()].sort((a, b) => b.timestamp - a.timestamp);
  const cp = sorted.find((c) => c.timestamp <= targetTs) ?? state.resumeCheckpoint;

  const options: string[] = ["Keep current files"];
  if (cp) options.push("Restore files to that point");
  if (state.redoStack.length > 0) options.push("↩ Undo last rewind");
  options.push("Cancel navigation");

  const choice = await ctx.ui.select("Restore Options", options);

  if (!choice || choice === "Cancel navigation") return { cancel: true };
  if (choice === "Keep current files") return undefined;

  if (choice === "↩ Undo last rewind" && state.redoStack.length > 0) {
    const undoCp = state.redoStack.pop()!;
    await performRestore(state, ctx, undoCp, "files");
    ctx.ui.notify("Files restored to before last rewind", "info");
    return { cancel: true };
  }

  if (cp) {
    await performRestore(state, ctx, cp, "files");
    ctx.ui.notify("Files restored to checkpoint", "info");
  }

  return undefined;
}

// ============================================================================
// Registration
// ============================================================================

export function registerCommands(pi: ExtensionAPI, state: RewindState): void {
  pi.registerCommand("rewind", {
    description: "Rewind file changes and/or conversation to a checkpoint",
    handler: async (_args, ctx) => {
      await runRewindFlow(state, ctx);
    },
  });

  // Esc+Esc shortcut — register as double-escape
  pi.registerShortcut("escape escape" as Parameters<ExtensionAPI["registerShortcut"]>[0], {
    description: "Rewind (same as /rewind)",
    handler: async (ctx) => {
      // Shortcut handler gets ExtensionContext, not CommandContext.
      // We can't call navigateTree from here, so do files-only quick rewind.
      if (!state.gitAvailable || !state.repoRoot || !state.sessionId) {
        ctx.ui.notify("Rewind not available", "warning");
        return;
      }

      const checkpoints = [...state.checkpoints.values()]
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 25);

      if (checkpoints.length === 0) {
        ctx.ui.notify("No checkpoints available", "warning");
        return;
      }

      const currentBranch = await git("rev-parse --abbrev-ref HEAD", state.repoRoot).catch(() => "unknown");
      const items = checkpoints.map((cp, i) => formatCheckpointLabel(cp, i, state, currentBranch));
      const choice = await ctx.ui.select("Quick rewind (files only, newest first):", items);
      if (!choice) return;

      const idx = items.indexOf(choice);
      if (idx < 0) return;

      await performRestore(state, { ui: ctx.ui }, checkpoints[idx], "files");
      ctx.ui.notify(`Files rewound to checkpoint #${idx + 1}`, "info");
    },
  });
}
