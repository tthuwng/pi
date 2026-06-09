import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
  ANSI_FG_RESET,
  EDITOR_RULE_ACCENT,
  USER_MESSAGE_ACCENT,
  fitLine,
  stripAnsi,
} from "./ansi.js";
import { rememberBoundedEntry } from "./bounded-cache.js";
import {
  type AgentToolResult,
  AssistantMessageComponent,
  type BashSpawnContext,
  CompactionSummaryMessageComponent,
  type BashToolDetails,
  CustomEditor,
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  type EditToolDetails,
  type ExtensionAPI,
  type ExtensionContext,
  type FindToolDetails,
  type GrepToolDetails,
  getMarkdownTheme,
  type KeybindingsManager,
  type LsToolDetails,
  type ReadToolDetails,
  type SessionEntry,
  type Theme,
  type ThemeColor,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@mariozechner/pi-coding-agent";
import type {
  Component,
  EditorTheme,
  ImageDimensions,
  MarkdownTheme,
  TUI,
} from "@mariozechner/pi-tui";
import {
  getImageDimensions,
  Image,
  imageFallback,
  Markdown,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";

type RenderFn = (width: number) => string[];
type WorkingState = "inactive" | "working" | "streaming";
type WorkingStateSnapshot = { state: WorkingState; elapsedSeconds: number };
type GetWorkingState = () => WorkingStateSnapshot;
type SessionCostCacheEntry = {
  length: number;
  lastEntry: SessionEntry | undefined;
  total: number;
  hasCost: boolean;
};

type PatchableUserMessagePrototype = {
  render: RenderFn;
  children?: unknown[];
  __claudeUserMessageOriginalRender?: RenderFn;
  __claudeUserMessagePatched?: boolean;
};

type PatchableAssistantMessagePrototype = {
  render: RenderFn;
  updateContent: (message: unknown) => void;
  markdownTheme?: MarkdownTheme;
  __claudeAssistantMessageOriginalRender?: RenderFn;
  __claudeAssistantMessageOriginalUpdateContent?: (message: unknown) => void;
  __claudeAssistantMessagePatched?: boolean;
};

type PatchableCompactionSummaryPrototype = {
  render: RenderFn;
  children?: Component[];
  __claudeCompactionSummaryOriginalRender?: RenderFn;
  __claudeCompactionSummaryPatched?: boolean;
};

type PatchedToolExecutionPrototype = {
  render: RenderFn;
  updateDisplay: () => void;
  getCallRenderer: () => unknown;
  getResultRenderer: () => unknown;
  getRenderShell: () => unknown;
  setExpanded: (expanded: boolean) => void;
  toolCallId?: string;
  result?: unknown;
  __claudeToolExecutionOriginalRender?: RenderFn;
  __claudeToolExecutionOriginalUpdateDisplay?: () => void;
  __claudeToolExecutionOriginalSetExpanded?: (expanded: boolean) => void;
  __claudeToolExecutionOriginalGetCallRenderer?: () => unknown;
  __claudeToolExecutionOriginalGetResultRenderer?: () => unknown;
  __claudeToolExecutionOriginalGetRenderShell?: () => unknown;
  __claudeToolExecutionPatched?: boolean;
};

const assistantMessageRenderCache = new WeakMap<
  object,
  { version: number; width: number; lines: string[] }
>();
const assistantMessageRenderVersion = new WeakMap<object, number>();
const toolExecutionRenderCache = new WeakMap<
  object,
  { version: number; width: number; lines: string[] }
>();
const toolExecutionRenderVersion = new WeakMap<object, number>();
const toolExecutionExpandedById = new Map<string, boolean>();

function bumpRenderVersion(
  store: WeakMap<object, number>,
  key: object,
): number {
  const version = (store.get(key) ?? 0) + 1;
  store.set(key, version);
  return version;
}

type MarkdownLike = {
  text?: unknown;
};

const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;
const CLIPBOARD_IMAGE_LIST_TIMEOUT_MS = 1000;
const CLIPBOARD_IMAGE_READ_TIMEOUT_MS = 3000;
const CLIPBOARD_IMAGE_MAX_BYTES = 50 * 1024 * 1024;
const execFileAsync = promisify(execFile);

const CLIPBOARD_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function isWaylandSession(): boolean {
  return (
    Boolean(process.env.WAYLAND_DISPLAY) ||
    process.env.XDG_SESSION_TYPE === "wayland"
  );
}

function baseMimeType(mimeType: string): string {
  return (
    mimeType.split(";", 1)[0]?.trim().toLowerCase() || mimeType.toLowerCase()
  );
}

function selectClipboardImageType(types: string[]): string | undefined {
  const normalized = types
    .map((type) => ({ raw: type, base: baseMimeType(type) }))
    .filter((type) => type.raw.length > 0);
  for (const supported of Object.keys(CLIPBOARD_IMAGE_EXTENSIONS)) {
    const match = normalized.find((type) => type.base === supported);
    if (match) return match.raw;
  }
  return normalized.find((type) => type.base.startsWith("image/"))?.raw;
}

async function readWaylandClipboardImage(): Promise<
  { bytes: Uint8Array; mimeType: string } | undefined
> {
  if (!isWaylandSession()) return undefined;
  let listStdout: string;
  try {
    const result = await execFileAsync("wl-paste", ["--list-types"], {
      timeout: CLIPBOARD_IMAGE_LIST_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    });
    listStdout = result.stdout;
  } catch {
    return undefined;
  }
  const selectedType = selectClipboardImageType(listStdout.split(/\r?\n/));
  if (!selectedType) return undefined;
  try {
    const result = await execFileAsync(
      "wl-paste",
      ["--type", selectedType, "--no-newline"],
      {
        timeout: CLIPBOARD_IMAGE_READ_TIMEOUT_MS,
        maxBuffer: CLIPBOARD_IMAGE_MAX_BYTES,
        encoding: "buffer",
      },
    );
    const stdout = result.stdout;
    const bytes = stdout instanceof Uint8Array ? stdout : Buffer.from(stdout);
    if (bytes.byteLength === 0) return undefined;
    return { bytes, mimeType: baseMimeType(selectedType) };
  } catch {
    return undefined;
  }
}

async function pasteWaylandClipboardImage(
  insert: (path: string) => void,
): Promise<boolean> {
  const image = await readWaylandClipboardImage();
  if (!image) return false;
  const ext = CLIPBOARD_IMAGE_EXTENSIONS[image.mimeType] ?? "png";
  const filePath = resolve(tmpdir(), `pi-clipboard-${randomUUID()}.${ext}`);
  await writeFile(filePath, image.bytes);
  insert(filePath);
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findMarkdownText(value: unknown): string | undefined {
  if (isRecord(value) && typeof (value as MarkdownLike).text === "string") {
    return (value as { text: string }).text;
  }

  if (!isRecord(value)) return undefined;

  const children = Array.isArray(value.children) ? value.children : [];
  for (const child of children) {
    const text = findMarkdownText(child);
    if (text !== undefined) return text;
  }

  return undefined;
}

function isEditorRule(line: string): boolean {
  const plain = stripAnsi(line).trim();
  return (
    plain.includes("─") &&
    [...plain].every((char) => "─↑↓ 0123456789more".includes(char))
  );
}

function splitEditorRender(lines: string[]): {
  editorLines: string[];
  popupLines: string[];
} {
  const withoutTop = lines.slice(1);
  const bottomRuleIndex = withoutTop.findIndex(isEditorRule);

  if (bottomRuleIndex === -1) {
    return { editorLines: withoutTop, popupLines: [] };
  }

  return {
    editorLines: withoutTop.slice(0, bottomRuleIndex),
    popupLines: withoutTop.slice(bottomRuleIndex + 1),
  };
}

function formatCost(value: number): string {
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

function formatTokenCount(value: number | null | undefined): string {
  if (value == null) return "?";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

const sessionCostCache = new WeakMap<ExtensionContext, SessionCostCacheEntry>();

function getSessionCost(ctx: ExtensionContext): {
  total: number;
  hasCost: boolean;
  usingSubscription: boolean;
} {
  const entries = ctx.sessionManager.getEntries();
  const lastEntry = entries.at(-1);
  let cache = sessionCostCache.get(ctx);
  if (
    !cache ||
    cache.length !== entries.length ||
    cache.lastEntry !== lastEntry
  ) {
    let total = 0;
    let hasCost = false;

    for (const entry of entries) {
      if (entry.type !== "message" || entry.message.role !== "assistant") {
        continue;
      }
      const cost = entry.message.usage?.cost?.total;
      if (typeof cost === "number" && Number.isFinite(cost)) {
        if (cost > 0) hasCost = true;
        total += cost;
      }
    }

    cache = { length: entries.length, lastEntry, total, hasCost };
    sessionCostCache.set(ctx, cache);
  }

  const usingSubscription = ctx.model
    ? ctx.modelRegistry.isUsingOAuth(ctx.model)
    : false;
  return { total: cache.total, hasCost: cache.hasCost, usingSubscription };
}

function formatSessionCost(ctx: ExtensionContext): string | undefined {
  const cost = getSessionCost(ctx);
  if (cost.usingSubscription) return `${formatCost(cost.total)} sub`;
  return cost.hasCost ? formatCost(cost.total) : undefined;
}

function formatContextUsage(ctx: ExtensionContext): string {
  const usage = ctx.getContextUsage();
  const contextWindow =
    usage?.contextWindow ?? ctx.model?.contextWindow ?? null;
  const percent =
    usage?.percent == null
      ? "?%"
      : `${Math.max(0, Math.floor(usage.percent))}%`;
  return `${percent} ${formatTokenCount(usage?.tokens)}/${formatTokenCount(contextWindow)}`;
}

function contextUsageColor(ctx: ExtensionContext): ThemeColor {
  const percent = ctx.getContextUsage()?.percent;
  if (percent == null) return "muted";
  if (percent >= 80) return "error";
  if (percent >= 50) return "warning";
  return "muted";
}

type ContextContributor = {
  label: string;
  chars: number;
  preview?: string;
};

type ContextStats = {
  usage: ReturnType<ExtensionContext["getContextUsage"]>;
  branch: SessionEntry[];
  activeEntries: SessionEntry[];
  byRole: Map<string, number>;
  byTool: Map<string, number>;
  contributors: ContextContributor[];
  totalChars: number;
  reportedTokens: number;
  contextWindow?: number;
  freeTokens?: number;
  conversationTokens: number;
  overheadTokens: number;
};

type ContextCategory = {
  label: string;
  tokens: number;
  color: ThemeColor;
  symbol: "●" | "○";
};

const HIDDEN_SLASH_COMPLETIONS = new Set([
  "gather-context-and-clarify",
  "parallel-context-build",
]);

function contentTextLength(content: unknown): number {
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const part of content) {
    if (!isRecord(part)) continue;
    for (const key of ["text", "thinking"] as const) {
      const value = part[key];
      if (typeof value === "string") total += value.length;
    }
    if (part.type === "toolCall") {
      const name = typeof part.name === "string" ? part.name : "";
      total += name.length;
      if (part.arguments !== undefined) {
        try {
          total += JSON.stringify(part.arguments).length;
        } catch {
          // Ignore unserializable tool arguments.
        }
      }
    }
  }
  return total;
}

function firstContentPreview(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const part of content) {
    if (!isRecord(part) || typeof part.text !== "string") continue;
    return compactOneLine(part.text, 90);
  }
  return undefined;
}

function contextEntries(branch: SessionEntry[]): SessionEntry[] {
  let compactionIndex = -1;
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    if (branch[index]?.type === "compaction") {
      compactionIndex = index;
      break;
    }
  }
  if (compactionIndex === -1) return branch;

  const compaction = branch[compactionIndex];
  if (!compaction || compaction.type !== "compaction") return branch;

  const firstKeptIndex = branch.findIndex(
    (entry) => entry.id === compaction.firstKeptEntryId,
  );
  const keptBeforeCompaction =
    firstKeptIndex === -1 ? [] : branch.slice(firstKeptIndex, compactionIndex);
  return [
    compaction,
    ...keptBeforeCompaction,
    ...branch.slice(compactionIndex + 1),
  ];
}

function addContributor(
  contributors: ContextContributor[],
  label: string,
  chars: number,
  preview?: string,
): void {
  if (chars <= 0) return;
  contributors.push({ label, chars, preview });
}

function collectContextStats(ctx: ExtensionContext): ContextStats {
  const usage = ctx.getContextUsage();
  const branch = ctx.sessionManager.getBranch();
  const activeEntries = contextEntries(branch);
  const byRole = new Map<string, number>();
  const byTool = new Map<string, number>();
  const contributors: ContextContributor[] = [];

  for (const entry of activeEntries) {
    if (entry.type === "message") {
      const message = entry.message as unknown;
      if (!isRecord(message)) continue;
      const role = typeof message.role === "string" ? message.role : "message";
      const chars = contentTextLength(message.content);
      byRole.set(role, (byRole.get(role) ?? 0) + chars);

      if (role === "toolResult") {
        const toolName =
          typeof message.toolName === "string" ? message.toolName : "tool";
        byTool.set(toolName, (byTool.get(toolName) ?? 0) + chars);
        addContributor(
          contributors,
          `tool:${toolName}`,
          chars,
          firstContentPreview(message.content),
        );
      } else {
        addContributor(
          contributors,
          role,
          chars,
          firstContentPreview(message.content),
        );
      }
      continue;
    }

    if (entry.type === "custom_message") {
      const chars =
        typeof entry.content === "string"
          ? entry.content.length
          : contentTextLength(entry.content);
      byRole.set("custom_message", (byRole.get("custom_message") ?? 0) + chars);
      addContributor(
        contributors,
        `custom:${entry.customType}`,
        chars,
        typeof entry.content === "string"
          ? compactOneLine(entry.content, 90)
          : firstContentPreview(entry.content),
      );
      continue;
    }

    if (entry.type === "compaction") {
      const chars = entry.summary.length;
      byRole.set("compaction", (byRole.get("compaction") ?? 0) + chars);
      addContributor(
        contributors,
        "compaction summary",
        chars,
        compactOneLine(entry.summary, 90),
      );
    }
  }

  contributors.sort((left, right) => right.chars - left.chars);
  const totalChars = [...byRole.values()].reduce(
    (sum, chars) => sum + chars,
    0,
  );
  const reportedTokens = usage?.tokens ?? Math.ceil(totalChars / 4);
  const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
  const freeTokens = contextWindow
    ? Math.max(0, contextWindow - reportedTokens)
    : undefined;
  const conversationTokens = Math.ceil(totalChars / 4);
  const overheadTokens = Math.max(0, reportedTokens - conversationTokens);

  return {
    usage,
    branch,
    activeEntries,
    byRole,
    byTool,
    contributors,
    totalChars,
    reportedTokens,
    contextWindow,
    freeTokens,
    conversationTokens,
    overheadTokens,
  };
}

function charsToTokens(chars: number | undefined): number {
  return Math.ceil((chars ?? 0) / 4);
}

function contextPercent(
  tokens: number | undefined,
  contextWindow: number | undefined,
): string {
  if (!tokens || !contextWindow) return "0.0%";
  return `${((tokens / contextWindow) * 100).toFixed(1)}%`;
}

function contextCategories(stats: ContextStats): ContextCategory[] {
  return [
    {
      label: "Estimated overhead",
      tokens: stats.overheadTokens,
      color: "muted",
      symbol: "●",
    },
    {
      label: "Tool results",
      tokens: charsToTokens(stats.byRole.get("toolResult")),
      color: "accent",
      symbol: "●",
    },
    {
      label: "Assistant",
      tokens: charsToTokens(stats.byRole.get("assistant")),
      color: "success",
      symbol: "●",
    },
    {
      label: "User",
      tokens: charsToTokens(stats.byRole.get("user")),
      color: "warning",
      symbol: "●",
    },
    {
      label: "Compaction",
      tokens: charsToTokens(stats.byRole.get("compaction")),
      color: "dim",
      symbol: "●",
    },
    {
      label: "Custom entries",
      tokens: charsToTokens(stats.byRole.get("custom_message")),
      color: "error",
      symbol: "●",
    },
    {
      label: "Free space",
      tokens: stats.freeTokens ?? 0,
      color: "muted",
      symbol: "○",
    },
  ];
}

function contextGrid(
  categories: ContextCategory[],
  totalTokens: number,
  theme: Theme,
  columns = 20,
  rows = 10,
): string[] {
  const cellCount = columns * rows;
  const cells: string[] = [];
  let cumulative = 0;
  let categoryIndex = 0;
  for (let cell = 0; cell < cellCount; cell += 1) {
    const midpoint = ((cell + 0.5) / cellCount) * totalTokens;
    while (
      categoryIndex < categories.length - 1 &&
      midpoint > cumulative + categories[categoryIndex].tokens
    ) {
      cumulative += categories[categoryIndex].tokens;
      categoryIndex += 1;
    }
    const category = categories[categoryIndex];
    cells.push(theme.fg(category.color, category.symbol));
  }

  const gridRows: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    gridRows.push(
      cells.slice(row * columns, row * columns + columns).join(" "),
    );
  }
  return gridRows;
}

function padVisible(value: string, width: number): string {
  return `${value}${" ".repeat(Math.max(0, width - visibleWidth(value)))}`;
}

function padStartVisible(value: string, width: number): string {
  return `${" ".repeat(Math.max(0, width - visibleWidth(value)))}${value}`;
}

function contextLegendLine(
  category: ContextCategory,
  contextWindow: number | undefined,
  theme: Theme,
): string {
  return `${theme.fg(category.color, category.symbol)} ${padVisible(category.label, 20)} ${padStartVisible(formatTokenCount(category.tokens), 6)} ${padStartVisible(contextPercent(category.tokens, contextWindow), 7)}`;
}

function renderContextPopup(
  ctx: ExtensionContext,
  theme: Theme,
  width: number,
): string[] {
  const stats = collectContextStats(ctx);
  const categories = contextCategories(stats).filter(
    (category) => category.tokens > 0 || category.label === "Free space",
  );
  const totalTokens = stats.contextWindow ?? Math.max(1, stats.reportedTokens);
  const gridColumns = 20;
  const grid = contextGrid(categories, totalTokens, theme, gridColumns, 10);
  const percent =
    stats.usage?.percent == null
      ? "?"
      : String(Math.round(stats.usage.percent));
  const topTools = [...stats.byTool.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([tool, chars]) => ({ tool, tokens: charsToTokens(chars) }));
  const topEntries = stats.contributors.slice(0, 6).map((contributor) => ({
    label: contributor.label.replace(/^tool:/, ""),
    tokens: charsToTokens(contributor.chars),
  }));

  const popupWidth = Math.max(110, Math.min(132, width));
  const bodyWidth = popupWidth - 4;
  const gridWidth = gridColumns * 2 - 1;
  const gapWidth = 4;
  const rightWidth = bodyWidth - gridWidth - gapWidth;
  const summaryWidth = 40;
  const detailWidth = rightWidth - summaryWidth - 3;
  const title = " Context Usage ";
  const topBorder = `╭─${title}${"─".repeat(Math.max(0, popupWidth - visibleWidth(title) - 3))}╮`;
  const bottomLabel = " Esc/Enter/q close ";
  const bottomBorder = `╰─${bottomLabel}${"─".repeat(Math.max(0, popupWidth - visibleWidth(bottomLabel) - 3))}╯`;
  const headerLines = [
    theme.bold(
      `${ctx.model?.id ?? "model"} · ${formatTokenCount(stats.reportedTokens)}/${formatTokenCount(stats.contextWindow)} tokens · ${percent}% used`,
    ),
    `Free ${formatTokenCount(stats.freeTokens)} · Conversation ${formatTokenCount(stats.conversationTokens)} · Estimated overhead ${formatTokenCount(stats.overheadTokens)}`,
    `Entries ${stats.activeEntries.length}/${stats.branch.length} active after compaction`,
  ];
  const categoryLines = [
    theme.fg("muted", "Breakdown"),
    ...categories.map((category) =>
      contextLegendLine(category, stats.contextWindow, theme),
    ),
  ];
  const toolLines = [
    theme.fg("muted", "Top tools"),
    ...(topTools.length > 0
      ? topTools.map(
          (item) =>
            `${padVisible(item.tool, 16)} ${padStartVisible(formatTokenCount(item.tokens), 6)} ${padStartVisible(contextPercent(item.tokens, stats.contextWindow), 7)}`,
        )
      : ["none"]),
  ];
  const entryLines = [
    theme.fg("muted", "Largest entries"),
    ...(topEntries.length > 0
      ? topEntries.map((item) => {
          const size = `${padStartVisible(formatTokenCount(item.tokens), 6)} ${padStartVisible(contextPercent(item.tokens, stats.contextWindow), 7)}`;
          const labelWidth = Math.max(10, detailWidth - visibleWidth(size) - 1);
          return `${padVisible(truncateToWidth(item.label, labelWidth, "…"), labelWidth)} ${size}`;
        })
      : ["none"]),
  ];
  const rightRows = [
    ...headerLines,
    "",
    ...Array.from(
      { length: Math.max(categoryLines.length, toolLines.length) },
      (_, index) =>
        `${padVisible(categoryLines[index] ?? "", summaryWidth)}   ${toolLines[index] ?? ""}`,
    ),
    "",
    ...entryLines,
  ];
  const bodyRows = Math.max(grid.length, rightRows.length);
  const lines = [theme.fg("borderAccent", topBorder)];
  for (let index = 0; index < bodyRows; index += 1) {
    const left = grid[index]
      ? padVisible(grid[index], gridWidth)
      : " ".repeat(gridWidth);
    const right = rightRows[index] ?? "";
    const body = `${left}${" ".repeat(gapWidth)}${right}`;
    lines.push(`│ ${fitLine(body, bodyWidth)} │`);
  }
  lines.push(theme.fg("borderAccent", bottomBorder));
  return lines;
}

function registerContextCommand(pi: ExtensionAPI): void {
  pi.registerCommand("context", {
    description: "Show active context usage contributors",
    handler: async (_args, ctx) => {
      ctx.ui.setWidget("claude-ui-context", undefined);

      await ctx.ui.custom<void>(
        (tui, theme, _keybindings, done) => ({
          render: (width: number) => renderContextPopup(ctx, theme, width),
          handleInput: (data: string) => {
            if (["\u001b", "\r", "\n", "q", "Q", "\u0003"].includes(data)) {
              done();
              return;
            }
            tui.requestRender();
          },
          invalidate: () => undefined,
        }),
        {
          overlay: true,
          overlayOptions: {
            width: 122,
            minWidth: 88,
            maxHeight: "90%",
            anchor: "center",
            margin: 2,
          },
        },
      );
    },
  });
}

function compactPath(cwd: string): string {
  const home = homedir();
  if (cwd === home) return "~";
  if (cwd.startsWith(`${home}/`)) return `~/${relative(home, cwd)}`;
  return cwd;
}

function footerLine(
  ctx: ExtensionContext,
  width: number,
  branch: string | undefined,
  theme: Theme,
  thinkingLevel: string | undefined,
): string | undefined {
  const model = theme.fg("text", ctx.model?.id ?? "model");
  const context = theme.fg(contextUsageColor(ctx), formatContextUsage(ctx));
  const cost = formatSessionCost(ctx);
  const thinking =
    thinkingLevel && thinkingLevel !== "off"
      ? theme.fg("accent", `● ${thinkingLevel}`)
      : undefined;
  const parts = [
    model,
    thinking,
    context,
    cost ? theme.fg("muted", cost) : undefined,
    theme.fg("dim", "/ commands"),
  ].filter((part): part is string => Boolean(part));
  const left = `  ${parts.join(theme.fg("dim", " · "))}`;
  const right = theme.fg(
    "muted",
    `${compactPath(ctx.cwd)}${branch ? ` (${branch})` : ""}`,
  );

  if (!left && !right) return undefined;
  if (!right) return truncateToWidth(left, width, "…");
  if (!left) return truncateToWidth(right, width, "…");

  const maxLeft = Math.max(0, Math.floor(width * 0.55));
  const clippedLeft = truncateToWidth(left, maxLeft, "…");
  const remainingRightWidth = Math.max(
    0,
    width - visibleWidth(clippedLeft) - 1,
  );
  const clippedRight = truncateToWidth(right, remainingRightWidth, "…");
  const gap = " ".repeat(
    Math.max(1, width - visibleWidth(clippedLeft) - visibleWidth(clippedRight)),
  );
  return truncateToWidth(`${clippedLeft}${gap}${clippedRight}`, width, "…");
}

function userMessageAccent(value: string): string {
  return `${USER_MESSAGE_ACCENT}${value}${ANSI_FG_RESET}`;
}

const userMessageRenderCache = new WeakMap<
  object,
  { text: string; width: number; lines: string[] }
>();

function withOscZone(lines: string[]): string[] {
  if (lines.length === 0) return lines;
  const zoned = [...lines];
  zoned[0] = `${OSC133_ZONE_START}${zoned[0]}`;
  zoned[zoned.length - 1] =
    `${zoned[zoned.length - 1]}${OSC133_ZONE_END}${OSC133_ZONE_FINAL}`;
  return zoned;
}

function patchUserMessageRender(): void {
  const prototype =
    UserMessageComponent.prototype as unknown as PatchableUserMessagePrototype;
  if (prototype.__claudeUserMessagePatched) return;

  prototype.__claudeUserMessageOriginalRender = prototype.render;
  prototype.render = function renderWithClaudeUserMessage(
    width: number,
  ): string[] {
    const original =
      prototype.__claudeUserMessageOriginalRender ?? prototype.render;
    const text = findMarkdownText(this);
    if (text === undefined) return original.call(this, width);

    const cacheKey = this as object;
    const cached = userMessageRenderCache.get(cacheKey);
    if (cached && cached.text === text && cached.width === width) {
      return cached.lines;
    }

    const contentWidth = Math.max(1, width - 2);
    const renderer = new Markdown(text, 0, 0, getMarkdownTheme());
    const lines = renderer.render(contentWidth);
    const body = lines.length > 0 ? lines : [""];
    const rendered = withOscZone([
      "",
      fitLine(userMessageAccent("╭─ You"), width),
      ...body.map((line) =>
        fitLine(`${userMessageAccent("│")} ${line}`, width),
      ),
      fitLine(userMessageAccent("╰─"), width),
    ]);
    userMessageRenderCache.set(cacheKey, { text, width, lines: rendered });
    return rendered;
  };
  prototype.__claudeUserMessagePatched = true;
}

function dimText(value: string): string {
  return `\x1b[2m${value}\x1b[0m`;
}

function createClaudeMarkdownTheme(): MarkdownTheme {
  const base = getMarkdownTheme();
  let codeBlockOpen = false;
  let codeBlockLabel = "code";

  return {
    ...base,
    codeBlockIndent: "",
    codeBlockBorder: (text: string) => {
      const fenceInfo = text.startsWith("```") ? text.slice(3).trim() : "";
      const isOpeningFence = text !== "```" || !codeBlockOpen;
      if (isOpeningFence) {
        codeBlockOpen = true;
        codeBlockLabel = fenceInfo || "code";
        return dimText(`--- ${codeBlockLabel} ---`);
      }

      const label = codeBlockLabel;
      codeBlockOpen = false;
      codeBlockLabel = "code";
      return dimText(`--- ${label} ---`);
    },
    highlightCode: base.highlightCode,
  };
}

function rewriteMarkdownImagesOutsideFences(text: string): string {
  let inFence = false;
  let fenceMarker: "```" | "~~~" | undefined;

  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      const openingFence = trimmed.startsWith("```")
        ? "```"
        : trimmed.startsWith("~~~")
          ? "~~~"
          : undefined;

      if (openingFence) {
        if (!inFence) {
          inFence = true;
          fenceMarker = openingFence;
        } else if (openingFence === fenceMarker) {
          inFence = false;
          fenceMarker = undefined;
        }
        return line;
      }

      if (inFence) return line;
      return line.replace(
        /!\[[^\]]*\]\((\/[^\s)]+\.(?:png|jpe?g|gif|webp))\)/gi,
        "$1",
      );
    })
    .join("\n");
}

function preprocessAssistantMessage(message: unknown): unknown {
  if (!isRecord(message) || !Array.isArray(message.content)) return message;

  let changed = false;
  const content = message.content.map((part) => {
    if (!isRecord(part) || typeof part.text !== "string") return part;
    const text = rewriteMarkdownImagesOutsideFences(part.text);
    if (text === part.text) return part;
    changed = true;
    return { ...part, text };
  });

  return changed ? { ...message, content } : message;
}

function imageMimeType(path: string): string | undefined {
  switch (extname(path).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return undefined;
  }
}

function extractLocalImagePath(line: string): string | undefined {
  const path = stripAnsi(line).trim();
  if (!/^\/[^\s"'`<>|]+\.(?:png|jpe?g|gif|webp)$/i.test(path)) {
    return undefined;
  }
  if (!isAbsolute(path) || !imageMimeType(path)) return undefined;
  return path;
}

function imageFallbackLine(
  path: string,
  mime: string,
  dimensions?: ImageDimensions,
): string {
  return dimText(`${imageFallback(mime, dimensions, basename(path))} ${path}`);
}

type DetachedLineMarkers = {
  line: string;
  prefix: string;
  suffix: string;
};

function detachImageLineMarkers(line: string): DetachedLineMarkers {
  let remaining = line;
  let prefix = "";
  let suffix = "";

  if (remaining.startsWith(OSC133_ZONE_START)) {
    prefix = OSC133_ZONE_START;
    remaining = remaining.slice(OSC133_ZONE_START.length);
  }

  let foundTrailingMarker = true;
  while (foundTrailingMarker) {
    foundTrailingMarker = false;
    for (const marker of [OSC133_ZONE_END, OSC133_ZONE_FINAL]) {
      if (remaining.endsWith(marker)) {
        suffix = `${marker}${suffix}`;
        remaining = remaining.slice(0, -marker.length);
        foundTrailingMarker = true;
      }
    }
  }

  return { line: remaining, prefix, suffix };
}

function attachImageLineMarkers(
  lines: string[],
  { prefix, suffix }: Pick<DetachedLineMarkers, "prefix" | "suffix">,
): string[] {
  if (lines.length === 0) return lines;
  return lines.map((renderedLine, index) => {
    const leading = index === 0 ? prefix : "";
    const trailing = index === lines.length - 1 ? suffix : "";
    return `${leading}${renderedLine}${trailing}`;
  });
}

const inlineImageCache = new Map<string, string[]>();

function rememberInlineImage(cacheKey: string, lines: string[]): void {
  rememberBoundedEntry(
    inlineImageCache,
    cacheKey,
    lines,
    MAX_INLINE_IMAGE_CACHE_ENTRIES,
  );
}

function expandLocalImageLine(line: string, width: number): string[] {
  const detached = detachImageLineMarkers(line);
  const path = extractLocalImagePath(detached.line);
  const mime = path ? imageMimeType(path) : undefined;
  if (!path || !mime) return [line];

  let stat;
  try {
    stat = statSync(path);
  } catch {
    return [line];
  }
  if (!stat.isFile() || stat.size > MAX_INLINE_IMAGE_BYTES) return [line];

  const maxWidthCells = Math.max(1, Math.min(80, width - 4));
  const cacheKey = `${path}:${stat.mtimeMs}:${stat.size}:${width}`;
  const cached = inlineImageCache.get(cacheKey);
  if (cached) {
    rememberInlineImage(cacheKey, cached);
    return attachImageLineMarkers(cached, detached);
  }

  let base64: string;
  try {
    base64 = readFileSync(path).toString("base64");
  } catch {
    rememberInlineImage(cacheKey, [detached.line]);
    return [line];
  }

  const dimensions = getImageDimensions(base64, mime) ?? undefined;
  const rendered = dimensions
    ? new Image(
        base64,
        mime,
        { fallbackColor: dimText },
        { maxWidthCells, filename: basename(path) },
        dimensions,
      ).render(width)
    : [imageFallbackLine(path, mime)];
  const expanded =
    rendered.length > 0
      ? rendered
      : [imageFallbackLine(path, mime, dimensions)];
  rememberInlineImage(cacheKey, expanded);
  return attachImageLineMarkers(expanded, detached);
}

function expandLocalImageLines(lines: string[], width: number): string[] {
  return lines.flatMap((line) => expandLocalImageLine(line, width));
}

function addAssistantPrefix(line: string): string {
  if (!ASSISTANT_RESPONSE_PREFIX) {
    return line.startsWith(OSC133_ZONE_START)
      ? `${OSC133_ZONE_START}${line.slice(OSC133_ZONE_START.length).trimStart()}`
      : line.trimStart();
  }
  if (line.startsWith(`${OSC133_ZONE_START}${ASSISTANT_RESPONSE_PREFIX}`)) {
    return line;
  }
  if (line.startsWith(OSC133_ZONE_START)) {
    return `${OSC133_ZONE_START}${ASSISTANT_RESPONSE_PREFIX}${line
      .slice(OSC133_ZONE_START.length)
      .trimStart()}`;
  }
  if (line.startsWith(ASSISTANT_RESPONSE_PREFIX)) return line;
  return `${ASSISTANT_RESPONSE_PREFIX}${line.trimStart()}`;
}

function patchAssistantMessageRender(): void {
  const prototype =
    AssistantMessageComponent.prototype as unknown as PatchableAssistantMessagePrototype;
  if (prototype.__claudeAssistantMessagePatched) return;

  prototype.__claudeAssistantMessageOriginalRender = prototype.render;
  prototype.__claudeAssistantMessageOriginalUpdateContent =
    prototype.updateContent;
  prototype.updateContent = function updateContentWithClaudeMarkdown(
    message: unknown,
  ): void {
    const cacheKey = this as object;
    assistantMessageRenderCache.delete(cacheKey);
    bumpRenderVersion(assistantMessageRenderVersion, cacheKey);
    this.markdownTheme = createClaudeMarkdownTheme();
    const original =
      prototype.__claudeAssistantMessageOriginalUpdateContent ??
      prototype.updateContent;
    original.call(this, preprocessAssistantMessage(message));
  };
  prototype.render = function renderWithClaudeAssistantMessage(
    width: number,
  ): string[] {
    const original =
      prototype.__claudeAssistantMessageOriginalRender ?? prototype.render;
    const cacheKey = this as object;
    const version = assistantMessageRenderVersion.get(cacheKey) ?? 0;
    const cached = assistantMessageRenderCache.get(cacheKey);
    if (cached && cached.version === version && cached.width === width) {
      return cached.lines;
    }

    const originalLines = original.call(this, width);
    const lines = expandLocalImageLines(originalLines, width);
    let rendered: string[];
    if (
      lines.length === 0 ||
      (this as { hasToolCalls?: boolean }).hasToolCalls
    ) {
      rendered = lines;
    } else {
      const prefixIndex = lines.findIndex(
        (line) => visibleWidth(line.trim()) > 0,
      );
      rendered =
        prefixIndex === -1
          ? lines
          : lines.map((line, index) =>
              index === prefixIndex
                ? fitLine(addAssistantPrefix(line), width)
                : line,
            );
    }

    if (
      !originalLines.some((line) =>
        Boolean(extractLocalImagePath(detachImageLineMarkers(line).line)),
      )
    ) {
      assistantMessageRenderCache.set(cacheKey, {
        version,
        width,
        lines: rendered,
      });
    }
    return rendered;
  };
  prototype.__claudeAssistantMessagePatched = true;
}

function patchCompactionSummaryRender(): void {
  const prototype =
    CompactionSummaryMessageComponent.prototype as unknown as PatchableCompactionSummaryPrototype;
  if (prototype.__claudeCompactionSummaryPatched) return;

  prototype.__claudeCompactionSummaryOriginalRender = prototype.render;
  prototype.render = function renderClaudeCompactionSummary(
    width: number,
  ): string[] {
    const children = this.children;
    if (!children || children.length === 0) {
      const original =
        prototype.__claudeCompactionSummaryOriginalRender ?? prototype.render;
      return original.call(this, width);
    }

    return children.flatMap((child) => child.render(width));
  };
  prototype.__claudeCompactionSummaryPatched = true;
}

function patchToolExecutionRenderers(): void {
  const prototype =
    ToolExecutionComponent.prototype as unknown as PatchedToolExecutionPrototype;
  if (prototype.__claudeToolExecutionPatched) return;

  prototype.__claudeToolExecutionOriginalRender = prototype.render;
  prototype.__claudeToolExecutionOriginalUpdateDisplay =
    prototype.updateDisplay;
  prototype.__claudeToolExecutionOriginalSetExpanded = prototype.setExpanded;
  prototype.__claudeToolExecutionOriginalGetCallRenderer =
    prototype.getCallRenderer;
  prototype.__claudeToolExecutionOriginalGetResultRenderer =
    prototype.getResultRenderer;
  prototype.__claudeToolExecutionOriginalGetRenderShell =
    prototype.getRenderShell;

  prototype.updateDisplay =
    function updateDisplayWithClaudeRenderCache(): void {
      const original =
        prototype.__claudeToolExecutionOriginalUpdateDisplay ??
        prototype.updateDisplay;
      original.call(this);
      const cacheKey = this as object;
      toolExecutionRenderCache.delete(cacheKey);
      bumpRenderVersion(toolExecutionRenderVersion, cacheKey);
    };

  prototype.setExpanded = function setExpandedWithClaudeState(
    expanded: boolean,
  ): void {
    const original =
      prototype.__claudeToolExecutionOriginalSetExpanded ??
      prototype.setExpanded;
    if (typeof this.toolCallId === "string") {
      if (this.result === undefined) {
        toolExecutionExpandedById.delete(this.toolCallId);
      } else {
        toolExecutionExpandedById.set(this.toolCallId, expanded);
      }
    }
    original.call(this, expanded);
    const cacheKey = this as object;
    toolExecutionRenderCache.delete(cacheKey);
    bumpRenderVersion(toolExecutionRenderVersion, cacheKey);
  };

  prototype.render = function renderWithClaudeToolCache(
    width: number,
  ): string[] {
    const original =
      prototype.__claudeToolExecutionOriginalRender ?? prototype.render;
    const cacheKey = this as object;
    const version = toolExecutionRenderVersion.get(cacheKey) ?? 0;
    const cached = toolExecutionRenderCache.get(cacheKey);
    if (cached && cached.version === version && cached.width === width) {
      return cached.lines;
    }
    const lines = original.call(this, width);
    toolExecutionRenderCache.set(cacheKey, { version, width, lines });
    return lines;
  };

  prototype.getCallRenderer = function getClaudeToolCallRenderer(this: {
    toolName?: string;
  }) {
    const toolName = this.toolName;
    if (
      typeof toolName === "string" &&
      EXTENSION_TOOL_WRAPPER_ALLOWLIST.has(toolName)
    ) {
      const original =
        prototype.__claudeToolExecutionOriginalGetCallRenderer?.call(this) as
          | ((
              args: unknown,
              theme: Theme,
              context: ToolRenderContextLike,
            ) => Text)
          | undefined;

      const title = toolName === "Agent" ? "Agent" : webToolTitle(toolName);
      return (args: unknown, theme: Theme, context: ToolRenderContextLike) => {
        if (
          PRESERVE_ORIGINAL_TOOL_RENDERERS.has(toolName) &&
          shouldUseOriginalToolRenderer(toolName, args) &&
          original
        ) {
          return original(args, theme, context);
        }

        return setText(
          context.lastComponent,
          genericToolCall(
            title,
            toolName === "Agent"
              ? agentToolCallBody(args, theme)
              : webToolCallBody(toolName, args, theme),
            theme,
            isToolPending(context),
          ),
        );
      };
    }
    return prototype.__claudeToolExecutionOriginalGetCallRenderer?.call(this);
  };

  prototype.getResultRenderer = function getClaudeToolResultRenderer(this: {
    toolName?: string;
  }) {
    const toolName = this.toolName;
    if (
      typeof toolName === "string" &&
      EXTENSION_TOOL_WRAPPER_ALLOWLIST.has(toolName)
    ) {
      const original =
        prototype.__claudeToolExecutionOriginalGetResultRenderer?.call(this) as
          | ((
              result: AgentToolResult<unknown>,
              options: ToolRenderOptions,
              theme: Theme,
              context: ToolRenderContextLike,
            ) => Text)
          | undefined;

      const title = toolName === "Agent" ? "Agent" : webToolTitle(toolName);
      return (
        result: AgentToolResult<unknown>,
        options: ToolRenderOptions,
        theme: Theme,
        context: ToolRenderContextLike,
      ) => {
        if (toolName === "subagent") {
          const rendered = renderSubagentToolResult(
            result,
            options,
            theme,
            context,
            title,
          );
          if (rendered) return rendered;
        }
        if (
          PRESERVE_ORIGINAL_TOOL_RENDERERS.has(toolName) &&
          shouldUseOriginalToolRenderer(toolName, context.args) &&
          original
        ) {
          return original(result, options, theme, context);
        }

        return wrappedToolResult(
          toolName,
          result,
          options,
          theme,
          context,
          title,
        );
      };
    }
    return prototype.__claudeToolExecutionOriginalGetResultRenderer?.call(this);
  };

  prototype.getRenderShell = function getClaudeToolRenderShell(this: {
    toolName?: string;
  }) {
    const toolName = this.toolName;
    if (
      typeof toolName === "string" &&
      EXTENSION_TOOL_WRAPPER_ALLOWLIST.has(toolName)
    ) {
      return "self";
    }
    return prototype.__claudeToolExecutionOriginalGetRenderShell?.call(this);
  };

  prototype.__claudeToolExecutionPatched = true;
}

function statusLabel(label: string, elapsedSeconds?: number): string {
  return elapsedSeconds === undefined ? label : `${label} (${elapsedSeconds}s)`;
}

class ClaudeEditor extends CustomEditor {
  private readonly ruleColor: (value: string) => string;
  private readonly getWorkingState: GetWorkingState;
  private readonly appKeybindings: KeybindingsManager;
  private readonly onQuitCommand: () => void;
  private readonly tuiRef: TUI;
  private clipboardPasteInFlight = false;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    getWorkingState: GetWorkingState,
    onQuitCommand: () => void,
  ) {
    super(tui, theme, keybindings, { paddingX: 0 });
    this.ruleColor = theme.borderColor;
    this.getWorkingState = getWorkingState;
    this.appKeybindings = keybindings;
    this.onQuitCommand = onQuitCommand;
    this.tuiRef = tui;
    if (isWaylandSession()) {
      this.onPasteImage = () => {
        void this.pasteClipboardImage();
      };
    }
  }

  private async pasteClipboardImage(): Promise<void> {
    if (this.clipboardPasteInFlight) return;
    this.clipboardPasteInFlight = true;
    try {
      await pasteWaylandClipboardImage((filePath) => {
        this.insertTextAtCursor?.(filePath);
        this.tuiRef.requestRender();
      });
    } finally {
      this.clipboardPasteInFlight = false;
    }
  }

  private workingLine(width: number): string | undefined {
    const { state, elapsedSeconds } = this.getWorkingState();
    switch (state) {
      case "working":
        return fitLine(this.ruleColor(`⏺ ${statusLabel("Thinking")}`), width);
      case "streaming":
        return fitLine(
          this.ruleColor(statusLabel("Streaming", elapsedSeconds)),
          width,
        );
      case "inactive":
        return undefined;
    }
  }

  handleInput(data: string): void {
    if (
      this.appKeybindings.matches(data, "tui.input.submit") &&
      this.getText().trim() === ":q"
    ) {
      this.onQuitCommand();
      return;
    }
    super.handleInput(data);
  }

  render(width: number): string[] {
    if (width < 3) return super.render(width);

    const contentWidth = Math.max(1, width - 2);
    const base = super.render(contentWidth);
    const { editorLines, popupLines } = splitEditorRender(base);
    const prompt = "> ";
    const continuation = "  ";
    const renderedEditorLines = (
      editorLines.length > 0 ? editorLines : [""]
    ).map((line, index) => {
      const prefix = index === 0 ? prompt : continuation;
      return fitLine(`${prefix}${line}`, width);
    });
    const renderedPopupLines = popupLines.map((line) => fitLine(line, width));
    const rule = fitLine(
      `${EDITOR_RULE_ACCENT}${"─".repeat(width)}${ANSI_FG_RESET}`,
      width,
    );
    const workingLine = this.workingLine(width);
    return workingLine
      ? [workingLine, rule, ...renderedEditorLines, rule, ...renderedPopupLines]
      : [rule, ...renderedEditorLines, rule, ...renderedPopupLines];
  }
}

type ToolRenderOptions = { expanded: boolean; isPartial: boolean };

type ToolRenderContextLike = {
  args: unknown;
  toolCallId: string;
  lastComponent: unknown;
  isError: boolean;
  executionStarted?: boolean;
};

type SubagentProgress = {
  index?: number;
  agent?: string;
  status?: string;
  currentTool?: string;
  currentToolArgs?: string;
  currentToolStartedAt?: number;
  recentTools?: SubagentRecentTool[];
  toolCount?: number;
  tokens?: number;
  durationMs?: number;
};

type SubagentRecentTool = {
  tool: string;
  args: string;
  endMs?: number;
};

type SubagentSingleResult = {
  agent: string;
  task?: string;
  exitCode?: number;
  detached?: boolean;
  interrupted?: boolean;
  progress?: SubagentProgress;
  progressSummary?: SubagentProgress;
  artifactPaths?: { outputPath?: string };
  savedOutputPath?: string;
  outputReference?: { path?: string };
  toolCalls?: Array<{ text?: string; expandedText?: string }>;
};

type SubagentDetails = {
  mode: string;
  context?: string;
  results: SubagentSingleResult[];
  progress?: SubagentProgress[];
  progressSummary?: SubagentProgress;
  totalSteps?: number;
  artifacts?: { dir?: string };
};

type SubagentToolDisplayEntry = {
  rowLabel: string;
  agent: string;
  tool: string;
  args: string;
  endMs: number;
  current: boolean;
};

type BuiltInTools = {
  read: ReturnType<typeof createReadTool>;
  grep: ReturnType<typeof createGrepTool>;
  find: ReturnType<typeof createFindTool>;
  ls: ReturnType<typeof createLsTool>;
  bash: ReturnType<typeof createBashTool>;
  edit: ReturnType<typeof createEditTool>;
  write: ReturnType<typeof createWriteTool>;
};

type SpawnHookContributor = {
  id: string;
  priority?: number;
  spawnHook: (ctx: BashSpawnContext) => BashSpawnContext;
};

const BASH_SPAWN_HOOK_REQUEST_EVENT = "ad:bash:spawn-hook:request";
const COLLAPSED_PREVIEW_LINES = 4;
const READ_PREVIEW_LINES = 6;
const COLLAPSED_EDIT_DIFF_LINES = 80;
const COLLAPSED_WRITE_DIFF_LINES = 40;
const EXPANDED_PREVIEW_LINES = 20;
const SUBAGENT_RECENT_TOOL_LIMIT = 5;
const SUBAGENT_HIDDEN_TOOL_TYPE_LIMIT = 5;
const MAX_WRITE_SNAPSHOTS = 25;
const MAX_INLINE_IMAGE_CACHE_ENTRIES = 50;
const RESULT_INDENT = "  ";
const DETAIL_INDENT = "    ";
const DIFF_ADDITION_BG = "\x1b[48;2;0;70;0m";
const DIFF_REMOVAL_BG = "\x1b[48;2;80;35;25m";
const DIFF_BG_RESET = "\x1b[49m";
const ASSISTANT_RESPONSE_PREFIX = "";
const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

const builtInToolCache = new WeakMap<ExtensionAPI, Map<string, BuiltInTools>>();
const wrappedExtensionTools = new WeakMap<ExtensionAPI, Set<string>>();
const toolRenderInterceptorInstalled = new WeakSet<ExtensionAPI>();
const EXTENSION_TOOL_WRAPPER_ALLOWLIST = new Set([
  "web_search",
  "code_search",
  "fetch_content",
  "get_search_content",
  "Agent",
  "mcp",
  "subagent",
  "subagent_list",
  "subagent_done",
  "todo",
  "ask_user",
  "tree_sitter_search_symbols",
  "tree_sitter_document_symbols",
  "tree_sitter_symbol_definition",
  "tree_sitter_pattern_search",
  "tree_sitter_codebase_overview",
  "tree_sitter_codebase_map",
  "ast_grep_search",
  "ast_grep_replace",
  "lsp_navigation",
  "lsp_diagnostics",
  "memory_search",
  "memory_write",
  "memory_list",
  "memory_check",
  "memory_sync",
]);

const PRESERVE_ORIGINAL_TOOL_RENDERERS = new Set(["subagent"]);

type WriteSnapshot = {
  absolutePath: string;
};

const writeSnapshots = new Map<string, WriteSnapshot>();
const pendingToolCalls = new Set<string>();

function resolveToolPath(filePath: string, cwd: string): string {
  if (filePath === "~") return homedir();
  if (filePath.startsWith("~/")) return resolve(homedir(), filePath.slice(2));
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

function rememberWriteSnapshot(
  toolCallId: string,
  snapshot: WriteSnapshot,
): void {
  rememberBoundedEntry(
    writeSnapshots,
    toolCallId,
    snapshot,
    MAX_WRITE_SNAPSHOTS,
  );
}

function rememberWriteTarget(
  toolCallId: string,
  args: unknown,
  cwd: string,
): void {
  writeSnapshots.delete(toolCallId);
  if (!isRecord(args) || typeof args.path !== "string" || args.path === "") {
    return;
  }

  rememberWriteSnapshot(toolCallId, {
    absolutePath: resolveToolPath(args.path, cwd),
  });
}

function createComposedSpawnHook(
  pi: ExtensionAPI,
): (ctx: BashSpawnContext) => BashSpawnContext {
  return (ctx) => {
    const contributors: SpawnHookContributor[] = [];

    pi.events.emit(BASH_SPAWN_HOOK_REQUEST_EVENT, {
      register: (contributor: SpawnHookContributor) => {
        contributors.push(contributor);
      },
    });

    return contributors
      .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0))
      .reduce(
        (currentCtx, contributor) => contributor.spawnHook(currentCtx),
        ctx,
      );
  };
}

function getBuiltInTools(cwd: string, pi: ExtensionAPI): BuiltInTools {
  let toolsByCwd = builtInToolCache.get(pi);
  if (!toolsByCwd) {
    toolsByCwd = new Map<string, BuiltInTools>();
    builtInToolCache.set(pi, toolsByCwd);
  }

  let tools = toolsByCwd.get(cwd);
  if (tools) return tools;

  tools = {
    read: createReadTool(cwd),
    grep: createGrepTool(cwd),
    find: createFindTool(cwd),
    ls: createLsTool(cwd),
    bash: createBashTool(cwd, { spawnHook: createComposedSpawnHook(pi) }),
    edit: createEditTool(cwd),
    write: createWriteTool(cwd),
  };
  toolsByCwd.set(cwd, tools);
  return tools;
}

function setText(lastComponent: unknown, content: string): Text {
  const text =
    lastComponent instanceof Text ? lastComponent : new Text("", 0, 0);
  text.setText(content);
  return text;
}

function argString(
  args: unknown,
  name: string,
  fallback = "…",
  allowEmpty = false,
): string {
  if (!isRecord(args)) return fallback;
  const value = args[name];
  if (typeof value !== "string") return fallback;
  if (!allowEmpty && value.length === 0) return fallback;
  return value;
}

function argNumber(args: unknown, name: string): number | undefined {
  if (!isRecord(args)) return undefined;
  const value = args[name];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function contentLines(value: string): string[] {
  const normalized = value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trimEnd();
  return normalized ? normalized.split("\n") : [];
}

function countLines(value: string): number {
  return contentLines(value).length;
}

function plural(
  count: number,
  singular: string,
  pluralForm = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function textContent(result: AgentToolResult<unknown>): string {
  return result.content
    .map((content) =>
      content.type === "text" && typeof content.text === "string"
        ? content.text
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

function extractToolText(result: AgentToolResult<unknown>): string {
  return textContent(result);
}

function firstTextLine(result: AgentToolResult<unknown>): string {
  return contentLines(textContent(result))[0]?.trim() || "Error";
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function shouldUseOriginalToolRenderer(
  toolName: string,
  args: unknown,
): boolean {
  if (toolName !== "subagent") return false;
  return !isRecord(args) || typeof args.action !== "string";
}

function argStringArray(args: unknown, name: string): string[] {
  if (!isRecord(args)) return [];
  const value = args[name];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function argValueLabel(args: unknown, name: string): string | undefined {
  if (!isRecord(args)) return undefined;
  const value = args[name];
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return undefined;
}

function argArrayCount(args: unknown, name: string): number | undefined {
  if (!isRecord(args)) return undefined;
  const value = args[name];
  return Array.isArray(value) ? value.length : undefined;
}

function compactPathList(args: unknown, theme: Theme): string | undefined {
  const paths = argStringArray(args, "paths");
  if (paths.length > 0) {
    return pathText(
      theme,
      paths.length === 1
        ? compactOneLine(paths[0] ?? "…", 70)
        : plural(paths.length, "path"),
    );
  }

  const path =
    argValueLabel(args, "path") ??
    argValueLabel(args, "filePath") ??
    argValueLabel(args, "file_path") ??
    argValueLabel(args, "cwd");
  return path ? pathText(theme, compactOneLine(path, 70)) : undefined;
}

function joinBodyParts(theme: Theme, parts: Array<string | undefined>): string {
  const present = parts.filter((part): part is string => Boolean(part));
  return present.length > 0
    ? present.join(muted(theme, " · "))
    : muted(theme, "…");
}

function truncateVisible(value: string, maxWidth = 80): string {
  return truncateToWidth(value.replace(/\t/g, "  "), maxWidth, "…");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildGrepHighlightRegex(args: unknown): RegExp | undefined {
  const pattern = argString(args, "pattern", "", true);
  if (pattern.length === 0) return undefined;

  const ignoreCase = isRecord(args) && args.ignoreCase === true;
  const flags = ignoreCase ? "gi" : "g";
  const source =
    isRecord(args) && args.literal === true ? escapeRegex(pattern) : pattern;

  try {
    return new RegExp(source, flags);
  } catch {
    return new RegExp(escapeRegex(pattern), flags);
  }
}

function compactOneLine(value: string, maxWidth = 80): string {
  return truncateVisible(value.replace(/\s+/g, " ").trim(), maxWidth);
}

function label(theme: Theme, value: string): string {
  return theme.fg("toolTitle", theme.bold(value));
}

function muted(theme: Theme, value: string): string {
  return theme.fg("muted", value);
}

function pathText(theme: Theme, value: string): string {
  return theme.fg("accent", value);
}

function callLine(
  theme: Theme,
  title: string,
  body: string,
  pending = false,
): string {
  const marker = pending ? "◦" : "●";
  return `${theme.fg("accent", marker)} ${label(theme, title)}${muted(
    theme,
    "(",
  )}${body}${muted(theme, ")")}`;
}

function genericToolCall(
  title: string,
  body: string,
  theme: Theme,
  pending = false,
): string {
  return callLine(theme, title, body || muted(theme, "…"), pending);
}

function isToolPending(context: ToolRenderContextLike): boolean {
  return pendingToolCalls.has(context.toolCallId);
}

function webToolCallBody(name: string, args: unknown, theme: Theme): string {
  switch (name) {
    case "web_search": {
      const queries = argStringArray(args, "queries");
      const query = argValueLabel(args, "query");
      return pathText(
        theme,
        compactOneLine(
          queries.length > 0 ? `${queries.length} queries` : (query ?? "…"),
          90,
        ),
      );
    }
    case "code_search":
      return pathText(
        theme,
        compactOneLine(argValueLabel(args, "query") ?? "…", 90),
      );
    case "fetch_content": {
      const urls = argStringArray(args, "urls");
      const url = argValueLabel(args, "url");
      const target = urls.length > 0 ? `${urls.length} urls` : (url ?? "…");
      const extras = [
        argValueLabel(args, "timestamp"),
        argValueLabel(args, "frames")
          ? `${argValueLabel(args, "frames")} frames`
          : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
      return `${pathText(theme, compactOneLine(target, 90))}${extras ? muted(theme, ` · ${extras}`) : ""}`;
    }
    case "get_search_content": {
      const responseId = argValueLabel(args, "responseId") ?? "…";
      const selector =
        argValueLabel(args, "query") ??
        argValueLabel(args, "url") ??
        (argValueLabel(args, "queryIndex")
          ? `query #${argValueLabel(args, "queryIndex")}`
          : undefined) ??
        (argValueLabel(args, "urlIndex")
          ? `url #${argValueLabel(args, "urlIndex")}`
          : undefined);
      return `${pathText(theme, compactOneLine(responseId, 40))}${selector ? muted(theme, ` · ${compactOneLine(selector, 60)}`) : ""}`;
    }
    case "mcp":
      return joinBodyParts(theme, [
        argValueLabel(args, "tool")
          ? pathText(
              theme,
              compactOneLine(argValueLabel(args, "tool") ?? "…", 60),
            )
          : undefined,
        argValueLabel(args, "server"),
        argValueLabel(args, "connect")
          ? `connect ${argValueLabel(args, "connect")}`
          : undefined,
        argValueLabel(args, "describe")
          ? `describe ${argValueLabel(args, "describe")}`
          : undefined,
        argValueLabel(args, "search")
          ? `search ${argValueLabel(args, "search")}`
          : undefined,
        argValueLabel(args, "action"),
      ]);
    case "subagent":
      return joinBodyParts(theme, [
        argValueLabel(args, "action") ?? "run",
        argValueLabel(args, "agent") ?? argValueLabel(args, "chainName"),
        argValueLabel(args, "id"),
      ]);
    case "todo":
      return joinBodyParts(theme, [
        argValueLabel(args, "action"),
        argValueLabel(args, "id"),
        argValueLabel(args, "title")
          ? pathText(
              theme,
              compactOneLine(argValueLabel(args, "title") ?? "…", 70),
            )
          : undefined,
        argValueLabel(args, "status"),
      ]);
    case "ask_user": {
      const optionCount = argArrayCount(args, "options");
      return joinBodyParts(theme, [
        pathText(
          theme,
          compactOneLine(argValueLabel(args, "question") ?? "…", 90),
        ),
        optionCount !== undefined ? plural(optionCount, "option") : undefined,
      ]);
    }
    case "subagent_list":
    case "subagent_done":
      return joinBodyParts(theme, [
        argValueLabel(args, "agent"),
        argValueLabel(args, "task")
          ? compactOneLine(argValueLabel(args, "task") ?? "…", 90)
          : undefined,
        argValueLabel(args, "status"),
      ]);
    case "tree_sitter_search_symbols":
      return joinBodyParts(theme, [
        pathText(
          theme,
          compactOneLine(argValueLabel(args, "query") ?? "…", 60),
        ),
        compactPathList(args, theme),
        argValueLabel(args, "language"),
        argValueLabel(args, "max_results")
          ? `${argValueLabel(args, "max_results")} max`
          : undefined,
      ]);
    case "tree_sitter_document_symbols":
      return compactPathList(args, theme) ?? muted(theme, "…");
    case "tree_sitter_symbol_definition":
      return joinBodyParts(theme, [
        pathText(
          theme,
          compactOneLine(argValueLabel(args, "symbol_name") ?? "…", 50),
        ),
        compactPathList(args, theme),
      ]);
    case "tree_sitter_pattern_search":
      return joinBodyParts(theme, [
        argValueLabel(args, "language"),
        pathText(
          theme,
          compactOneLine(argValueLabel(args, "pattern") ?? "…", 70),
        ),
        compactPathList(args, theme),
        argValueLabel(args, "max_results")
          ? `${argValueLabel(args, "max_results")} max`
          : undefined,
      ]);
    case "tree_sitter_codebase_overview":
    case "tree_sitter_codebase_map":
      return joinBodyParts(theme, [
        compactPathList(args, theme),
        argValueLabel(args, "depth")
          ? `depth ${argValueLabel(args, "depth")}`
          : undefined,
      ]);
    case "ast_grep_search":
      return joinBodyParts(theme, [
        argValueLabel(args, "lang"),
        pathText(
          theme,
          compactOneLine(argValueLabel(args, "pattern") ?? "…", 70),
        ),
        compactPathList(args, theme),
        argValueLabel(args, "selector")
          ? `selector ${argValueLabel(args, "selector")}`
          : undefined,
      ]);
    case "ast_grep_replace":
      return joinBodyParts(theme, [
        argValueLabel(args, "apply") === "true" ? "apply" : "dry run",
        argValueLabel(args, "lang"),
        `${pathText(theme, compactOneLine(argValueLabel(args, "pattern") ?? "…", 45))}${muted(theme, " → ")}${pathText(theme, compactOneLine(argValueLabel(args, "rewrite") ?? "", 45))}`,
        compactPathList(args, theme),
      ]);
    case "lsp_navigation": {
      const line = argValueLabel(args, "line");
      const character = argValueLabel(args, "character");
      return joinBodyParts(theme, [
        argValueLabel(args, "operation"),
        compactPathList(args, theme),
        line ? `${line}:${character ?? 1}` : undefined,
        argValueLabel(args, "query")
          ? `query ${argValueLabel(args, "query")}`
          : undefined,
        argValueLabel(args, "newName")
          ? `→ ${argValueLabel(args, "newName")}`
          : undefined,
      ]);
    }
    case "lsp_diagnostics":
      return joinBodyParts(theme, [
        compactPathList(args, theme),
        argValueLabel(args, "severity"),
        argArrayCount(args, "filePaths") !== undefined
          ? plural(argArrayCount(args, "filePaths") ?? 0, "file")
          : undefined,
      ]);
    case "memory_search":
      return joinBodyParts(theme, [
        argValueLabel(args, "query")
          ? pathText(
              theme,
              compactOneLine(argValueLabel(args, "query") ?? "…", 70),
            )
          : undefined,
        argValueLabel(args, "grep")
          ? `grep ${argValueLabel(args, "grep")}`
          : undefined,
        argValueLabel(args, "rg")
          ? `rg ${argValueLabel(args, "rg")}`
          : undefined,
      ]);
    case "memory_write":
      return joinBodyParts(theme, [
        compactPathList(args, theme),
        argValueLabel(args, "description"),
      ]);
    case "memory_list": {
      const directory = argValueLabel(args, "directory");
      return directory
        ? pathText(theme, compactOneLine(directory, 70))
        : (compactPathList(args, theme) ?? muted(theme, "all"));
    }
    case "memory_check":
      return muted(theme, "project");
    case "memory_sync":
      return pathText(theme, argValueLabel(args, "action") ?? "status");
    default:
      return muted(theme, "…");
  }
}

function webToolTitle(name: string): string {
  switch (name) {
    case "web_search":
      return "Web Search";
    case "code_search":
      return "Code Search";
    case "fetch_content":
      return "Fetch";
    case "get_search_content":
      return "Get Content";
    case "mcp":
      return "MCP";
    case "subagent":
      return "Subagent";
    case "todo":
      return "Todo";
    case "ask_user":
      return "Ask User";
    case "subagent_list":
      return "Subagent List";
    case "subagent_done":
      return "Subagent Done";
    case "tree_sitter_search_symbols":
      return "Tree Symbols";
    case "tree_sitter_document_symbols":
      return "Document Symbols";
    case "tree_sitter_symbol_definition":
      return "Symbol Definition";
    case "tree_sitter_pattern_search":
      return "Tree Pattern";
    case "tree_sitter_codebase_overview":
      return "Codebase Overview";
    case "tree_sitter_codebase_map":
      return "Codebase Map";
    case "ast_grep_search":
      return "AST Search";
    case "ast_grep_replace":
      return "AST Replace";
    case "lsp_navigation":
      return "LSP";
    case "lsp_diagnostics":
      return "LSP Diagnostics";
    case "memory_search":
      return "Memory Search";
    case "memory_write":
      return "Memory Write";
    case "memory_list":
      return "Memory List";
    case "memory_check":
      return "Memory Check";
    case "memory_sync":
      return "Memory Sync";
    default:
      return name;
  }
}

function agentToolCallBody(args: unknown, theme: Theme): string {
  const subagentType = argValueLabel(args, "subagent_type") ?? "agent";
  const description = argValueLabel(args, "description");
  return `${pathText(theme, compactOneLine(subagentType, 40))}${
    description ? muted(theme, ` · ${compactOneLine(description, 80)}`) : ""
  }`;
}

function detailNumber(details: unknown, name: string): number | undefined {
  if (!isRecord(details)) return undefined;
  const value = details[name];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function detailString(details: unknown, name: string): string | undefined {
  if (!isRecord(details)) return undefined;
  const value = details[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function detailBoolean(details: unknown, name: string): boolean | undefined {
  if (!isRecord(details)) return undefined;
  const value = details[name];
  return typeof value === "boolean" ? value : undefined;
}

function recordArray(value: Record<string, unknown>, name: string): unknown[] {
  const array = value[name];
  return Array.isArray(array) ? array : [];
}

function todoListSummary(output: string): string | undefined {
  const parsed = parseJsonRecord(output);
  if (!parsed) return undefined;
  const assigned = recordArray(parsed, "assigned").length;
  const open = recordArray(parsed, "open").length;
  const closed = recordArray(parsed, "closed").length;
  return `${plural(open, "open todo", "open todos")} · ${assigned} assigned · ${closed} closed`;
}

function memoryListSummary(output: string): string | undefined {
  const firstLine = contentLines(output).find((line) => line.trim().length > 0);
  const match = firstLine?.match(/Memory files \((\d+)\):/);
  return match ? plural(Number(match[1]), "file") : undefined;
}

function subagentListSummary(output: string): string | undefined {
  const agentCount = contentLines(output).filter((line) =>
    line.startsWith("- "),
  ).length;
  return agentCount > 0 ? plural(agentCount, "agent") : undefined;
}

function pendingToolLabel(toolName: string, title: string): string {
  switch (toolName) {
    case "web_search":
    case "code_search":
    case "tree_sitter_search_symbols":
    case "tree_sitter_pattern_search":
    case "ast_grep_search":
      return "Searching";
    case "fetch_content":
      return "Fetching";
    case "get_search_content":
      return "Loading";
    case "tree_sitter_document_symbols":
    case "tree_sitter_symbol_definition":
    case "lsp_navigation":
      return "Navigating";
    case "tree_sitter_codebase_overview":
    case "tree_sitter_codebase_map":
      return "Scanning";
    case "ast_grep_replace":
      return "Checking";
    case "memory_search":
      return "Searching Memory";
    case "memory_write":
      return "Writing Memory";
    case "memory_list":
      return "Listing Memory";
    case "memory_check":
      return "Checking Memory";
    case "memory_sync":
      return "Syncing Memory";
    case "ask_user":
      return "Asking User";
    default:
      return title;
  }
}

function previewLinesBlock(
  lines: string[],
  theme: Theme,
  expanded: boolean,
  expandedLines: number,
  maxWidth = 120,
  collapsedLines = COLLAPSED_PREVIEW_LINES,
): string {
  const maxLines = expanded ? expandedLines : collapsedLines;
  if (maxLines <= 0 || lines.length === 0) return "";

  const preview = lines
    .slice(0, maxLines)
    .map((line) =>
      muted(theme, `${DETAIL_INDENT}│ ${truncateVisible(line, maxWidth)}`),
    );
  if (lines.length > maxLines) {
    preview.push(
      muted(
        theme,
        `${DETAIL_INDENT}│ … ${plural(lines.length - maxLines, "more line")}`,
      ),
    );
  }
  return `\n${preview.join("\n")}`;
}

function todoPreviewLines(output: string): string[] | undefined {
  const parsed = parseJsonRecord(output);
  if (!parsed) return undefined;
  const lines = ["assigned", "open", "closed"].flatMap((section) =>
    recordArray(parsed, section).map((item) => {
      if (!isRecord(item)) return `${section}: ${String(item)}`;
      const id = typeof item.id === "string" ? item.id : undefined;
      const title = typeof item.title === "string" ? item.title : "(untitled)";
      return `${section}: ${id ? `${id} ` : ""}${title}`;
    }),
  );
  return lines;
}

function memoryListPreviewLines(output: string): string[] | undefined {
  const lines = contentLines(output)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2));
  return lines.length > 0 ? lines : undefined;
}

function subagentListPreviewLines(output: string): string[] | undefined {
  const lines = contentLines(output).filter((line) => line.startsWith("- "));
  return lines.length > 0 ? lines : undefined;
}

function parseSubagentProgress(value: unknown): SubagentProgress | undefined {
  if (!isRecord(value)) return undefined;
  const recentTools = recordArray(value, "recentTools")
    .map((item): SubagentRecentTool | undefined => {
      if (!isRecord(item)) return undefined;
      const tool = detailString(item, "tool");
      if (!tool) return undefined;
      const endMs = detailNumber(item, "endMs");
      return {
        tool,
        args: detailString(item, "args") ?? "",
        ...(endMs === undefined ? {} : { endMs }),
      };
    })
    .filter((item): item is SubagentRecentTool => item !== undefined);
  return {
    index: detailNumber(value, "index"),
    agent: detailString(value, "agent"),
    status: detailString(value, "status"),
    currentTool: detailString(value, "currentTool"),
    currentToolArgs: detailString(value, "currentToolArgs"),
    currentToolStartedAt: detailNumber(value, "currentToolStartedAt"),
    recentTools,
    toolCount: detailNumber(value, "toolCount"),
    tokens: detailNumber(value, "tokens"),
    durationMs: detailNumber(value, "durationMs"),
  };
}

function parseSubagentDetails(details: unknown): SubagentDetails | undefined {
  if (!isRecord(details)) return undefined;
  const mode = detailString(details, "mode");
  const rawResults = recordArray(details, "results");
  if (!mode || rawResults.length === 0) return undefined;
  const results = rawResults
    .map((item): SubagentSingleResult | undefined => {
      if (!isRecord(item)) return undefined;
      const agent = detailString(item, "agent");
      if (!agent) return undefined;
      const artifactPaths = isRecord(item.artifactPaths)
        ? { outputPath: detailString(item.artifactPaths, "outputPath") }
        : undefined;
      const outputReference = isRecord(item.outputReference)
        ? { path: detailString(item.outputReference, "path") }
        : undefined;
      const toolCalls = recordArray(item, "toolCalls")
        .map(
          (toolCall): { text?: string; expandedText?: string } | undefined => {
            if (!isRecord(toolCall)) return undefined;
            return {
              text: detailString(toolCall, "text"),
              expandedText: detailString(toolCall, "expandedText"),
            };
          },
        )
        .filter(
          (toolCall): toolCall is { text?: string; expandedText?: string } =>
            toolCall !== undefined,
        );
      return {
        agent,
        task: detailString(item, "task"),
        exitCode: detailNumber(item, "exitCode"),
        detached: detailBoolean(item, "detached"),
        interrupted: detailBoolean(item, "interrupted"),
        progress: parseSubagentProgress(item.progress),
        progressSummary: parseSubagentProgress(item.progressSummary),
        artifactPaths,
        savedOutputPath: detailString(item, "savedOutputPath"),
        outputReference,
        toolCalls,
      };
    })
    .filter((item): item is SubagentSingleResult => item !== undefined);
  if (results.length === 0) return undefined;
  return {
    mode,
    context: detailString(details, "context"),
    results,
    progress: recordArray(details, "progress")
      .map(parseSubagentProgress)
      .filter((item): item is SubagentProgress => item !== undefined),
    progressSummary: parseSubagentProgress(details.progressSummary),
    totalSteps: detailNumber(details, "totalSteps"),
    artifacts: isRecord(details.artifacts)
      ? { dir: detailString(details.artifacts, "dir") }
      : undefined,
  };
}

function formatSubagentDuration(ms: number | undefined): string | undefined {
  if (ms === undefined || ms <= 0) return undefined;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

function subagentProgressStats(progress: SubagentProgress | undefined): string {
  if (!progress) return "";
  return [
    progress.toolCount && progress.toolCount > 0
      ? plural(progress.toolCount, "tool use")
      : undefined,
    progress.tokens && progress.tokens > 0
      ? `${formatTokenCount(progress.tokens)} ${progress.tokens === 1 ? "token" : "tokens"}`
      : undefined,
    formatSubagentDuration(progress.durationMs),
  ]
    .filter((part): part is string => part !== undefined)
    .join(" · ");
}

function subagentOutputPath(result: SubagentSingleResult): string | undefined {
  return (
    result.savedOutputPath ??
    result.outputReference?.path ??
    result.artifactPaths?.outputPath
  );
}

function subagentProgressForResult(
  details: SubagentDetails,
  result: SubagentSingleResult,
  index: number,
): SubagentProgress | undefined {
  return (
    result.progress ??
    details.progress?.find((progress) => progress.index === index) ??
    details.progress?.find(
      (progress) =>
        progress.agent === result.agent && progress.status === "running",
    ) ??
    result.progressSummary
  );
}

function subagentResultDone(
  result: SubagentSingleResult,
  progress: SubagentProgress | undefined,
): boolean {
  if (progress?.status === "completed") return true;
  if (
    progress?.status === "running" ||
    progress?.status === "pending" ||
    progress?.status === "failed" ||
    progress?.status === "detached"
  )
    return false;
  if (result.detached || result.interrupted) return false;
  return result.exitCode === 0;
}

function subagentResultGlyph(
  result: SubagentSingleResult,
  progress: SubagentProgress | undefined,
  theme: Theme,
): string {
  if (progress?.status === "running") return theme.fg("accent", "●");
  if (progress?.status === "pending") return theme.fg("dim", "◦");
  if (result.detached || result.interrupted || progress?.status === "detached")
    return theme.fg("warning", "■");
  if (progress?.status === "completed" || result.exitCode === 0)
    return theme.fg("success", "✓");
  return theme.fg("error", "✗");
}

function toolNameFromSummary(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("$ ")) return "bash";
  return trimmed.split(/\s+|:/, 1)[0] || "tool";
}

function formatSubagentTool(
  tool: string,
  args: string,
  current = false,
): string {
  const text = args ? `${tool}: ${compactOneLine(args, 80)}` : tool;
  return current ? `${text} (running)` : text;
}

function hiddenSubagentToolSummary(
  entries: SubagentToolDisplayEntry[],
  unknownCount = 0,
): string {
  const totalHidden = entries.length + unknownCount;
  if (totalHidden === 0) return "";
  const counts = new Map<string, number>();
  for (const entry of entries)
    counts.set(entry.tool, (counts.get(entry.tool) ?? 0) + 1);
  const sorted = [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  const visible = sorted.slice(0, SUBAGENT_HIDDEN_TOOL_TYPE_LIMIT);
  const hiddenOther =
    sorted
      .slice(SUBAGENT_HIDDEN_TOOL_TYPE_LIMIT)
      .reduce((total, [, count]) => total + count, 0) + unknownCount;
  const parts = visible.map(([tool, count]) => `${tool} ${count}`);
  if (hiddenOther > 0) parts.push(`other ${hiddenOther}`);
  return `+${totalHidden} more: ${parts.join(" · ")}`;
}

function collectSubagentToolEntries(
  details: SubagentDetails,
  result: SubagentSingleResult,
  index: number,
): SubagentToolDisplayEntry[] {
  const progress = subagentProgressForResult(details, result, index);
  const rowLabel =
    details.mode === "parallel"
      ? `Agent ${index + 1}/${details.totalSteps ?? details.results.length}`
      : `Step ${index + 1}`;
  const entries = (progress?.recentTools ?? []).map(
    (tool, toolIndex): SubagentToolDisplayEntry => ({
      rowLabel,
      agent: result.agent,
      tool: tool.tool,
      args: tool.args,
      endMs: tool.endMs ?? toolIndex,
      current: false,
    }),
  );
  if (entries.length === 0) {
    for (
      let toolIndex = 0;
      toolIndex < (result.toolCalls?.length ?? 0);
      toolIndex++
    ) {
      const text =
        result.toolCalls?.[toolIndex]?.text ??
        result.toolCalls?.[toolIndex]?.expandedText ??
        "tool";
      const tool = toolNameFromSummary(text);
      const args = text.startsWith(`${tool} `)
        ? text.slice(tool.length + 1)
        : text;
      entries.push({
        rowLabel,
        agent: result.agent,
        tool,
        args,
        endMs: toolIndex,
        current: false,
      });
    }
  }
  if (progress?.currentTool) {
    entries.push({
      rowLabel,
      agent: result.agent,
      tool: progress.currentTool,
      args: progress.currentToolArgs ?? "",
      endMs: progress.currentToolStartedAt ?? Date.now(),
      current: true,
    });
  }
  return entries;
}

function subagentToolCount(
  result: SubagentSingleResult,
  progress: SubagentProgress | undefined,
  entries: SubagentToolDisplayEntry[],
): number {
  return Math.max(
    progress?.toolCount ?? 0,
    result.toolCalls?.length ?? 0,
    entries.length,
  );
}

function subagentAgentToolSummary(
  entries: SubagentToolDisplayEntry[],
  totalToolCount: number,
): string | undefined {
  const latest = [...entries].sort(
    (left, right) => right.endMs - left.endMs,
  )[0];
  if (!latest) return undefined;
  const hiddenCount = Math.max(0, totalToolCount - 1);
  return `last: ${formatSubagentTool(latest.tool, latest.args, latest.current)}${hiddenCount ? ` · +${hiddenCount} more` : ""}`;
}

function subagentSummaryLine(details: SubagentDetails): string {
  const total = details.totalSteps ?? details.results.length;
  const done = details.results.filter((result, index) =>
    subagentResultDone(
      result,
      subagentProgressForResult(details, result, index),
    ),
  ).length;
  const running = details.results.filter(
    (result, index) =>
      subagentProgressForResult(details, result, index)?.status === "running",
  ).length;
  const status =
    running > 0
      ? `${running} running · ${done}/${total} done`
      : `${done}/${total} done`;
  const stats = subagentProgressStats(
    details.progressSummary ?? {
      toolCount: details.results.reduce(
        (sum, result, index) =>
          sum +
          (subagentProgressForResult(details, result, index)?.toolCount ?? 0),
        0,
      ),
      tokens: details.results.reduce(
        (sum, result, index) =>
          sum +
          (subagentProgressForResult(details, result, index)?.tokens ?? 0),
        0,
      ),
      durationMs: details.results.reduce(
        (max, result, index) =>
          Math.max(
            max,
            subagentProgressForResult(details, result, index)?.durationMs ?? 0,
          ),
        0,
      ),
    },
  );
  return [
    details.mode,
    details.context === "fork" ? "[fork]" : undefined,
    status,
    stats,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

function renderSubagentToolResult(
  result: AgentToolResult<unknown>,
  options: ToolRenderOptions,
  theme: Theme,
  context: ToolRenderContextLike,
  title: string,
): Text | undefined {
  const details = parseSubagentDetails(result.details);
  if (!details) return undefined;
  if (context.isError)
    return setText(
      context.lastComponent,
      errorLine(theme, firstTextLine(result)),
    );

  const entriesByIndex = details.results.map((child, index) =>
    collectSubagentToolEntries(details, child, index),
  );
  const totalToolCount = details.results.reduce((sum, child, index) => {
    const progress = subagentProgressForResult(details, child, index);
    return (
      sum + subagentToolCount(child, progress, entriesByIndex[index] ?? [])
    );
  }, 0);
  const allEntries = entriesByIndex
    .flat()
    .sort((left, right) => right.endMs - left.endMs);
  const recentEntries = allEntries.slice(0, SUBAGENT_RECENT_TOOL_LIMIT);
  const hiddenEntries = allEntries.slice(SUBAGENT_RECENT_TOOL_LIMIT);
  const unknownHiddenCount = Math.max(0, totalToolCount - allEntries.length);
  const lines = [treeLine(theme, title, subagentSummaryLine(details))];
  if (recentEntries.length > 0) {
    lines.push(muted(theme, `${DETAIL_INDENT}│ recent activity:`));
    for (const entry of recentEntries) {
      lines.push(
        muted(
          theme,
          `${DETAIL_INDENT}│ ${entry.rowLabel} ${entry.agent} · ${formatSubagentTool(entry.tool, entry.args, entry.current)}`,
        ),
      );
    }
    const hiddenSummary = hiddenSubagentToolSummary(
      hiddenEntries,
      unknownHiddenCount,
    );
    if (hiddenSummary)
      lines.push(muted(theme, `${DETAIL_INDENT}│ ${hiddenSummary}`));
  }
  lines.push(muted(theme, `${DETAIL_INDENT}│ agents:`));
  for (let index = 0; index < details.results.length; index++) {
    const child = details.results[index];
    const progress = subagentProgressForResult(details, child, index);
    const rowLabel =
      details.mode === "parallel"
        ? `Agent ${index + 1}/${details.totalSteps ?? details.results.length}`
        : `Step ${index + 1}`;
    const entries = entriesByIndex[index] ?? [];
    const agentToolCount = subagentToolCount(child, progress, entries);
    const agentSummary = subagentAgentToolSummary(entries, agentToolCount);
    const stats = subagentProgressStats(progress);
    lines.push(
      muted(
        theme,
        `${DETAIL_INDENT}│ ${subagentResultGlyph(child, progress, theme)} ${rowLabel}: ${child.agent}${stats ? ` · ${stats}` : ""}${agentSummary ? ` · ${agentSummary}` : ""}`,
      ),
    );
    if (options.expanded && entries.length > 0) {
      const sortedEntries = [...entries].sort(
        (left, right) => right.endMs - left.endMs,
      );
      for (const entry of sortedEntries.slice(0, SUBAGENT_RECENT_TOOL_LIMIT)) {
        lines.push(
          muted(
            theme,
            `${DETAIL_INDENT}│   ${formatSubagentTool(entry.tool, entry.args, entry.current)}`,
          ),
        );
      }
      const hiddenSummary = hiddenSubagentToolSummary(
        sortedEntries.slice(SUBAGENT_RECENT_TOOL_LIMIT),
        Math.max(0, agentToolCount - sortedEntries.length),
      );
      if (hiddenSummary)
        lines.push(muted(theme, `${DETAIL_INDENT}│   ${hiddenSummary}`));
    }
    const outputPath = subagentOutputPath(child);
    if (outputPath)
      lines.push(
        muted(
          theme,
          `${DETAIL_INDENT}│   output: ${compactOneLine(outputPath, 110)}`,
        ),
      );
  }
  if (details.artifacts?.dir)
    lines.push(
      muted(
        theme,
        `${DETAIL_INDENT}│ artifacts: ${compactOneLine(details.artifacts.dir, 110)}`,
      ),
    );
  return setText(context.lastComponent, lines.join("\n"));
}

function toolPreviewBlock(
  toolName: string,
  output: string,
  theme: Theme,
  expanded: boolean,
): string {
  switch (toolName) {
    case "todo":
      return previewLinesBlock(
        todoPreviewLines(output) ?? [],
        theme,
        expanded,
        EXPANDED_PREVIEW_LINES,
      );
    case "memory_list":
      return previewLinesBlock(
        memoryListPreviewLines(output) ?? [],
        theme,
        expanded,
        EXPANDED_PREVIEW_LINES,
      );
    case "subagent":
      return previewLinesBlock(
        subagentListPreviewLines(output) ?? contentLines(output),
        theme,
        expanded,
        EXPANDED_PREVIEW_LINES,
      );
    default:
      return previewBlock(output, theme, expanded, EXPANDED_PREVIEW_LINES);
  }
}

function resultDetailSummary(
  toolName: string,
  result: AgentToolResult<unknown>,
  output: string,
): string {
  const details = result.details;
  const lines = countLines(output);

  switch (toolName) {
    case "todo":
      return (
        todoListSummary(output) ?? (lines > 0 ? plural(lines, "line") : "done")
      );
    case "memory_list":
      return (
        memoryListSummary(output) ??
        (lines > 0 ? plural(lines, "line") : "done")
      );
    case "subagent":
      return (
        subagentListSummary(output) ??
        (lines > 0 ? plural(lines, "line") : "done")
      );
    case "lsp_navigation": {
      const operation = detailString(details, "operation");
      const resultCount = detailNumber(details, "resultCount");
      const failureKind = detailString(details, "failureKind");
      const parts = [
        operation,
        resultCount !== undefined ? plural(resultCount, "result") : undefined,
        failureKind && failureKind !== "success" ? failureKind : undefined,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(" · ") : "done";
    }
    case "lsp_diagnostics": {
      const mode = detailString(details, "mode");
      const totalDiagnostics = detailNumber(details, "totalDiagnostics");
      const filesChecked = detailNumber(details, "filesChecked");
      const filesScanned = detailNumber(details, "filesScanned");
      const parts = [
        mode,
        totalDiagnostics !== undefined
          ? plural(totalDiagnostics, "diagnostic")
          : undefined,
        filesChecked !== undefined ? plural(filesChecked, "file") : undefined,
        filesScanned !== undefined ? plural(filesScanned, "file") : undefined,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(" · ") : "done";
    }
    case "ast_grep_search":
    case "ast_grep_replace": {
      const matchCount = detailNumber(details, "matchCount");
      const applied = detailBoolean(details, "applied");
      const mode =
        toolName === "ast_grep_replace"
          ? applied
            ? "applied"
            : "dry run"
          : undefined;
      const parts = [
        matchCount !== undefined ? plural(matchCount, "match") : undefined,
        mode,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(" · ") : "done";
    }
    default:
      return lines > 0 ? plural(lines, "line") : "done";
  }
}

function wrappedToolResult(
  toolName: string,
  result: AgentToolResult<unknown>,
  options: ToolRenderOptions,
  theme: Theme,
  context: ToolRenderContextLike,
  title: string,
): Text {
  if (options.isPartial) {
    return setText(
      context.lastComponent,
      treeLine(theme, pendingToolLabel(toolName, title), "..."),
    );
  }
  if (context.isError) {
    return setText(
      context.lastComponent,
      errorLine(theme, firstTextLine(result)),
    );
  }

  const output = extractToolText(result);
  const summary = treeLine(
    theme,
    title,
    resultDetailSummary(toolName, result, output),
  );
  return setText(
    context.lastComponent,
    `${summary}${toolPreviewBlock(toolName, output, theme, options.expanded)}`,
  );
}

function genericToolResult(
  result: AgentToolResult<unknown>,
  options: ToolRenderOptions,
  theme: Theme,
  context: ToolRenderContextLike,
  title: string,
): Text {
  return wrappedToolResult(title, result, options, theme, context, title);
}

function treeLine(theme: Theme, title: string, details: string): string {
  return `${muted(theme, `${RESULT_INDENT}└ `)}${label(theme, title)}${
    details ? muted(theme, ` ${details}`) : ""
  }`;
}

function errorLine(theme: Theme, message: string): string {
  return `${muted(theme, `${RESULT_INDENT}└ `)}${theme.fg(
    "error",
    truncateVisible(message, 120),
  )}`;
}

function previewBlock(
  value: string,
  theme: Theme,
  expanded: boolean,
  expandedLines: number,
  maxWidth = 120,
  collapsedLines = COLLAPSED_PREVIEW_LINES,
): string {
  return previewLinesBlock(
    contentLines(value),
    theme,
    expanded,
    expandedLines,
    maxWidth,
    collapsedLines,
  );
}

function highlightMatches(
  value: string,
  regex: RegExp | undefined,
  theme: Theme,
): string {
  if (regex === undefined) return muted(theme, value);

  const segments: string[] = [];
  let lastIndex = 0;
  regex.lastIndex = 0;

  for (const match of value.matchAll(regex)) {
    const matchText = match[0];
    if (matchText.length === 0) continue;
    const index = match.index ?? 0;
    if (index > lastIndex)
      segments.push(muted(theme, value.slice(lastIndex, index)));
    segments.push(theme.fg("mdHeading", theme.bold(matchText)));
    lastIndex = index + matchText.length;
  }

  if (lastIndex < value.length)
    segments.push(muted(theme, value.slice(lastIndex)));
  return segments.join("");
}

function grepPreviewBlock(
  value: string,
  theme: Theme,
  expanded: boolean,
  expandedLines: number,
  regex: RegExp | undefined,
  maxWidth = 120,
  collapsedLines = COLLAPSED_PREVIEW_LINES,
): string {
  const maxLines = expanded ? expandedLines : collapsedLines;
  if (maxLines <= 0) return "";
  const lines = contentLines(value);
  if (lines.length === 0) return "";

  const preview = lines.slice(0, maxLines).map((line) => {
    const truncatedLine = truncateVisible(line, maxWidth);
    return `${muted(theme, `${DETAIL_INDENT}│ `)}${highlightMatches(truncatedLine, regex, theme)}`;
  });
  if (lines.length > maxLines) {
    preview.push(
      muted(
        theme,
        `${DETAIL_INDENT}│ … ${plural(lines.length - maxLines, "more line")}`,
      ),
    );
  }
  return `\n${preview.join("\n")}`;
}

function lineCountFromOutput(value: string, emptyMessages: string[]): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  if (emptyMessages.some((message) => trimmed.startsWith(message))) return 0;
  return countLines(trimmed);
}

function formatReadCall(args: unknown, theme: Theme, pending = false): string {
  const path = argString(args, "path");
  // Collapse skill reads into a compact display
  const skillMatch = path?.match(/\/skills\/([^/]+)\/SKILL\.md$/);
  if (skillMatch) {
    return callLine(theme, "Skill", pathText(theme, skillMatch[1]), pending);
  }
  const offset = argNumber(args, "offset");
  const limit = argNumber(args, "limit");
  let body = pathText(theme, path);
  if (offset !== undefined || limit !== undefined) {
    const start = offset ?? 1;
    const end = limit !== undefined ? start + limit - 1 : undefined;
    body += muted(
      theme,
      ` · lines ${start}${end === undefined ? "+" : `-${end}`}`,
    );
  }
  return callLine(theme, "Read", body, pending);
}

function formatGrepCall(args: unknown, theme: Theme, pending = false): string {
  const pattern = argString(args, "pattern", "");
  const path = argString(args, "path", ".");
  return callLine(
    theme,
    "Grep",
    `${pathText(theme, `/${compactOneLine(pattern, 60)}/`)}${muted(
      theme,
      " in ",
    )}${pathText(theme, path)}`,
    pending,
  );
}

function formatFindCall(args: unknown, theme: Theme, pending = false): string {
  const pattern = argString(args, "pattern", "");
  const path = argString(args, "path", ".");
  return callLine(
    theme,
    "Find",
    `${pathText(theme, compactOneLine(pattern, 70))}${muted(theme, " in ")}${pathText(
      theme,
      path,
    )}`,
    pending,
  );
}

function formatLsCall(args: unknown, theme: Theme, pending = false): string {
  return callLine(
    theme,
    "List",
    pathText(theme, argString(args, "path", ".")),
    pending,
  );
}

function formatBashCall(args: unknown, theme: Theme, pending = false): string {
  return callLine(
    theme,
    "Bash",
    pathText(theme, argString(args, "command", "")),
    pending,
  );
}

function formatEditCall(args: unknown, theme: Theme, pending = false): string {
  return callLine(
    theme,
    "Update",
    pathText(theme, argString(args, "path")),
    pending,
  );
}

function formatWriteCall(args: unknown, theme: Theme, pending = false): string {
  const content = argString(args, "content", "", true);
  return callLine(
    theme,
    "Write",
    `${pathText(theme, argString(args, "path"))}${muted(
      theme,
      ` · ${plural(countLines(content), "line")}`,
    )}`,
    pending,
  );
}

function renderReadResult(
  result: AgentToolResult<ReadToolDetails | undefined>,
  options: ToolRenderOptions,
  theme: Theme,
  context: ToolRenderContextLike,
): Text {
  if (options.isPartial) {
    return setText(context.lastComponent, treeLine(theme, "Reading", "..."));
  }
  if (context.isError) {
    return setText(
      context.lastComponent,
      errorLine(theme, firstTextLine(result)),
    );
  }

  // Collapse skill reads — don't show line count
  const details = result.details;
  const filePath = detailString(details, "path") ?? "";
  if (/\/skills\/[^/]+\/SKILL\.md$/.test(filePath)) {
    return setText(context.lastComponent, "");
  }

  const output = textContent(result);
  const suffix = details?.truncation?.truncated ? " · truncated" : "";
  const summary = treeLine(
    theme,
    "Read",
    `${plural(countLines(output), "line")}${suffix}`,
  );
  const expanded = toolExecutionExpandedById.get(context.toolCallId) === true;
  return setText(
    context.lastComponent,
    `${summary}${previewBlock(output, theme, expanded, EXPANDED_PREVIEW_LINES, 120, READ_PREVIEW_LINES)}`,
  );
}

function renderGrepResult(
  result: AgentToolResult<GrepToolDetails | undefined>,
  options: ToolRenderOptions,
  theme: Theme,
  context: ToolRenderContextLike,
): Text {
  if (options.isPartial) {
    return setText(context.lastComponent, treeLine(theme, "Searching", "..."));
  }
  if (context.isError) {
    return setText(
      context.lastComponent,
      errorLine(theme, firstTextLine(result)),
    );
  }

  const output = textContent(result);
  const details = result.details;
  const extra = [
    details?.matchLimitReached
      ? `limit ${details.matchLimitReached}`
      : undefined,
    details?.truncation?.truncated ? "truncated" : undefined,
    details?.linesTruncated ? "long lines truncated" : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  const summary = treeLine(
    theme,
    "Grep",
    `${plural(lineCountFromOutput(output, ["No matches found"]), "line")}${
      extra ? ` · ${extra}` : ""
    }`,
  );
  return setText(
    context.lastComponent,
    `${summary}${grepPreviewBlock(
      output,
      theme,
      options.expanded,
      EXPANDED_PREVIEW_LINES,
      buildGrepHighlightRegex(context.args),
    )}`,
  );
}

function renderFindResult(
  result: AgentToolResult<FindToolDetails | undefined>,
  options: ToolRenderOptions,
  theme: Theme,
  context: ToolRenderContextLike,
): Text {
  if (options.isPartial) {
    return setText(context.lastComponent, treeLine(theme, "Finding", "..."));
  }
  if (context.isError) {
    return setText(
      context.lastComponent,
      errorLine(theme, firstTextLine(result)),
    );
  }

  const output = textContent(result);
  const details = result.details;
  const extra = [
    details?.resultLimitReached
      ? `limit ${details.resultLimitReached}`
      : undefined,
    details?.truncation?.truncated ? "truncated" : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  const summary = treeLine(
    theme,
    "Find",
    `${plural(
      lineCountFromOutput(output, ["No files found matching pattern"]),
      "result",
    )}${extra ? ` · ${extra}` : ""}`,
  );
  const previewOutput = output.includes("No files found matching pattern")
    ? `${output}\nRespects .gitignore; use an explicit non-ignored path or a different tool if needed.`
    : output;
  return setText(
    context.lastComponent,
    `${summary}${previewBlock(previewOutput, theme, options.expanded, 20)}`,
  );
}

function renderLsResult(
  result: AgentToolResult<LsToolDetails | undefined>,
  options: ToolRenderOptions,
  theme: Theme,
  context: ToolRenderContextLike,
): Text {
  if (options.isPartial) {
    return setText(context.lastComponent, treeLine(theme, "Listing", "..."));
  }
  if (context.isError) {
    return setText(
      context.lastComponent,
      errorLine(theme, firstTextLine(result)),
    );
  }

  const output = textContent(result);
  const details = result.details;
  const extra = [
    details?.entryLimitReached
      ? `limit ${details.entryLimitReached}`
      : undefined,
    details?.truncation?.truncated ? "truncated" : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  const summary = treeLine(
    theme,
    "List",
    `${plural(lineCountFromOutput(output, ["(empty directory)"]), "entry", "entries")}${
      extra ? ` · ${extra}` : ""
    }`,
  );
  return setText(
    context.lastComponent,
    `${summary}${previewBlock(output, theme, options.expanded, 20)}`,
  );
}

function renderBashResult(
  result: AgentToolResult<BashToolDetails | undefined>,
  options: ToolRenderOptions,
  theme: Theme,
  context: ToolRenderContextLike,
): Text {
  if (options.isPartial) {
    return setText(context.lastComponent, treeLine(theme, "Running", "..."));
  }

  const output = textContent(result);
  const lineCount = output.trim() === "(no output)" ? 0 : countLines(output);
  const status = context.isError
    ? theme.fg("error", "Failed")
    : label(theme, "Done");
  const firstLine = context.isError ? ` · ${firstTextLine(result)}` : "";
  const summary = `${muted(theme, `${RESULT_INDENT}└ `)}${status}${muted(
    theme,
    ` · ${plural(lineCount, "line")}${firstLine}`,
  )}`;
  return setText(
    context.lastComponent,
    `${summary}${previewBlock(output, theme, options.expanded, 20)}`,
  );
}

function countDiffLines(diff: string | undefined): {
  additions: number;
  removals: number;
} {
  if (!diff) return { additions: 0, removals: 0 };
  let additions = 0;
  let removals = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions++;
    if (line.startsWith("-")) removals++;
  }
  return { additions, removals };
}

function containsAnsi(value: string): boolean {
  return /\x1b\[[0-9;?]*[ -/]*[@-~]/.test(value);
}

function normalizeDiffTabs(line: string): string {
  return line.replace(/\t/g, "    ");
}

function renderEditResult(
  result: AgentToolResult<EditToolDetails | undefined>,
  options: ToolRenderOptions,
  theme: Theme,
  context: ToolRenderContextLike,
): Component {
  if (options.isPartial) {
    return setText(context.lastComponent, treeLine(theme, "Editing", "..."));
  }
  if (context.isError) {
    return setText(
      context.lastComponent,
      errorLine(theme, firstTextLine(result)),
    );
  }

  const diff = result.details?.diff ?? "";
  const { additions, removals } = countDiffLines(diff);
  const summaryTitle =
    additions > 0 || removals > 0
      ? `Added ${additions}, removed ${removals}`
      : "Updated";
  const summary = treeLine(theme, summaryTitle, "");
  return setDiffResult(
    context.lastComponent,
    summary,
    diff,
    theme,
    options.expanded,
    COLLAPSED_EDIT_DIFF_LINES,
  );
}

function isChangedDiffLine(line: string): boolean {
  return (
    (line.startsWith("+") && !line.startsWith("+++")) ||
    (line.startsWith("-") && !line.startsWith("---"))
  );
}

function selectCollapsedDiffLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines;

  const firstChangedIndex = lines.findIndex(isChangedDiffLine);
  if (firstChangedIndex === -1) return lines.slice(0, maxLines);

  const hasAddition = lines.some(
    (line) => line.startsWith("+") && !line.startsWith("+++"),
  );
  const hasRemoval = lines.some(
    (line) => line.startsWith("-") && !line.startsWith("---"),
  );
  let start =
    firstChangedIndex > 0 && !isChangedDiffLine(lines[firstChangedIndex - 1])
      ? firstChangedIndex - 1
      : firstChangedIndex;
  let end = Math.min(lines.length - 1, start + maxLines - 1);

  const windowHasAddition = () =>
    lines
      .slice(start, end + 1)
      .some((line) => line.startsWith("+") && !line.startsWith("+++"));
  const windowHasRemoval = () =>
    lines
      .slice(start, end + 1)
      .some((line) => line.startsWith("-") && !line.startsWith("---"));

  if (
    hasAddition &&
    hasRemoval &&
    !(windowHasAddition() && windowHasRemoval())
  ) {
    const firstAdditionIndex = lines.findIndex(
      (line, index) =>
        index >= firstChangedIndex &&
        line.startsWith("+") &&
        !line.startsWith("+++"),
    );
    const firstRemovalIndex = lines.findIndex(
      (line, index) =>
        index >= firstChangedIndex &&
        line.startsWith("-") &&
        !line.startsWith("---"),
    );
    const requiredEnd = Math.max(firstAdditionIndex, firstRemovalIndex);
    start = Math.max(firstChangedIndex, requiredEnd - maxLines + 1);
    end = Math.min(lines.length - 1, start + maxLines - 1);
  }

  if (
    end < lines.length - 1 &&
    end - start + 1 < maxLines &&
    !isChangedDiffLine(lines[end + 1])
  ) {
    end++;
  }

  return lines.slice(start, end + 1);
}

class DiffResultComponent implements Component {
  private summary = "";
  private warning: string | undefined;
  private diff = "";
  private diffLines: string[] = [];
  private diffContainsAnsi = false;
  private theme: Theme | undefined;
  private expanded = false;
  private collapsedLines = COLLAPSED_PREVIEW_LINES;

  set(
    summary: string,
    diff: string,
    theme: Theme,
    expanded: boolean,
    collapsedLines: number,
    warning?: string,
  ): void {
    this.summary = summary;
    if (this.diff !== diff) {
      this.diff = diff;
      this.diffLines = contentLines(diff);
      this.diffContainsAnsi = containsAnsi(diff);
    }
    this.theme = theme;
    this.expanded = expanded;
    this.collapsedLines = collapsedLines;
    this.warning = warning;
  }

  invalidate(): void {
    // Component content is derived from the latest stored diff at render time.
  }

  render(width: number): string[] {
    const lines = [fitLine(this.summary, width)];
    const theme = this.theme;
    if (!theme) return lines;

    if (this.warning) {
      lines.push(
        fitLine(muted(theme, `${DETAIL_INDENT}│ ${this.warning}`), width),
      );
    }

    const diffLines = this.diffLines;
    if (diffLines.length === 0) return lines;

    const isExternalAnsiDiff = this.diffContainsAnsi;
    const selectedLines = this.expanded
      ? diffLines
      : isExternalAnsiDiff
        ? diffLines.slice(0, this.collapsedLines)
        : selectCollapsedDiffLines(diffLines, this.collapsedLines);
    const gutterPlain = `${DETAIL_INDENT}│ `;
    const gutterPlainWidth = visibleWidth(gutterPlain);
    const gutter = muted(theme, gutterPlain);
    const availableWidth = Math.max(1, width - gutterPlainWidth);

    for (const line of selectedLines) {
      lines.push(
        isExternalAnsiDiff
          ? this.renderExternalDiffLine(line, gutter, availableWidth, width)
          : this.renderDiffLine(line, gutter, availableWidth, width, theme),
      );
    }

    const remaining = diffLines.length - selectedLines.length;
    if (remaining > 0) {
      lines.push(
        fitLine(
          muted(
            theme,
            `${DETAIL_INDENT}│ … ${plural(remaining, "more diff line")}`,
          ),
          width,
        ),
      );
    }

    return lines;
  }

  private renderExternalDiffLine(
    line: string,
    gutter: string,
    availableWidth: number,
    width: number,
  ): string {
    const clipped = truncateToWidth(line, availableWidth, "…");
    return fitLine(`${gutter}${clipped}`, width);
  }

  private renderDiffLine(
    line: string,
    gutter: string,
    availableWidth: number,
    width: number,
    theme: Theme,
  ): string {
    const normalizedLine = normalizeDiffTabs(line);
    const clipped = truncateToWidth(normalizedLine, availableWidth, "…");
    const padded = `${clipped}${" ".repeat(Math.max(0, availableWidth - visibleWidth(clipped)))}`;

    if (normalizedLine.startsWith("+") && !normalizedLine.startsWith("+++")) {
      return `${gutter}${DIFF_ADDITION_BG}${theme.fg("text", padded)}${DIFF_BG_RESET}`;
    }
    if (normalizedLine.startsWith("-") && !normalizedLine.startsWith("---")) {
      return `${gutter}${DIFF_REMOVAL_BG}${theme.fg("text", padded)}${DIFF_BG_RESET}`;
    }

    const styled =
      normalizedLine.startsWith("@@") ||
      normalizedLine.startsWith("+++") ||
      normalizedLine.startsWith("---")
        ? muted(theme, clipped)
        : theme.fg("toolDiffContext", clipped);
    return fitLine(`${gutter}${styled}`, width);
  }
}

function setDiffResult(
  lastComponent: unknown,
  summary: string,
  diff: string,
  theme: Theme,
  expanded: boolean,
  collapsedLines: number,
  warning?: string,
): DiffResultComponent {
  const component =
    lastComponent instanceof DiffResultComponent
      ? lastComponent
      : new DiffResultComponent();
  component.set(summary, diff, theme, expanded, collapsedLines, warning);
  return component;
}

function renderWriteResult(
  result: AgentToolResult<undefined>,
  options: ToolRenderOptions,
  theme: Theme,
  context: ToolRenderContextLike,
): Component {
  if (options.isPartial) {
    return setText(context.lastComponent, treeLine(theme, "Writing", "..."));
  }
  if (context.isError) {
    return setText(
      context.lastComponent,
      errorLine(theme, firstTextLine(result)),
    );
  }

  const content = argString(context.args, "content", "", true);
  const snapshot = writeSnapshots.get(context.toolCallId);
  const path = argString(context.args, "path", snapshot?.absolutePath ?? "…");
  const summary = treeLine(
    theme,
    `Wrote ${plural(countLines(content), "line")}`,
    `to ${path} · diff unavailable`,
  );

  return setDiffResult(
    context.lastComponent,
    summary,
    "",
    theme,
    options.expanded,
    COLLAPSED_WRITE_DIFF_LINES,
    "diff unavailable because previous content was not captured",
  );
}

function registerClaudeToolRenderers(pi: ExtensionAPI): void {
  const bootstrap = getBuiltInTools(process.cwd(), pi);

  pi.registerTool({
    name: "read",
    label: bootstrap.read.label,
    description: bootstrap.read.description,
    parameters: bootstrap.read.parameters,
    prepareArguments: bootstrap.read.prepareArguments,
    executionMode: bootstrap.read.executionMode,
    renderShell: "self",
    execute: (toolCallId, params, signal, onUpdate, ctx) =>
      getBuiltInTools(ctx.cwd, pi).read.execute(
        toolCallId,
        params,
        signal,
        onUpdate,
      ),
    renderCall: (args, theme, context) =>
      setText(
        context.lastComponent,
        formatReadCall(args, theme, isToolPending(context)),
      ),
    renderResult: renderReadResult,
  });

  pi.registerTool({
    name: "grep",
    label: bootstrap.grep.label,
    description: bootstrap.grep.description,
    parameters: bootstrap.grep.parameters,
    prepareArguments: bootstrap.grep.prepareArguments,
    executionMode: bootstrap.grep.executionMode,
    renderShell: "self",
    execute: (toolCallId, params, signal, onUpdate, ctx) =>
      getBuiltInTools(ctx.cwd, pi).grep.execute(
        toolCallId,
        params,
        signal,
        onUpdate,
      ),
    renderCall: (args, theme, context) =>
      setText(
        context.lastComponent,
        formatGrepCall(args, theme, isToolPending(context)),
      ),
    renderResult: renderGrepResult,
  });

  pi.registerTool({
    name: "find",
    label: bootstrap.find.label,
    description: bootstrap.find.description,
    parameters: bootstrap.find.parameters,
    prepareArguments: bootstrap.find.prepareArguments,
    executionMode: bootstrap.find.executionMode,
    renderShell: "self",
    execute: (toolCallId, params, signal, onUpdate, ctx) =>
      getBuiltInTools(ctx.cwd, pi).find.execute(
        toolCallId,
        params,
        signal,
        onUpdate,
      ),
    renderCall: (args, theme, context) =>
      setText(
        context.lastComponent,
        formatFindCall(args, theme, isToolPending(context)),
      ),
    renderResult: renderFindResult,
  });

  pi.registerTool({
    name: "ls",
    label: bootstrap.ls.label,
    description: bootstrap.ls.description,
    parameters: bootstrap.ls.parameters,
    prepareArguments: bootstrap.ls.prepareArguments,
    executionMode: bootstrap.ls.executionMode,
    renderShell: "self",
    execute: (toolCallId, params, signal, onUpdate, ctx) =>
      getBuiltInTools(ctx.cwd, pi).ls.execute(
        toolCallId,
        params,
        signal,
        onUpdate,
      ),
    renderCall: (args, theme, context) =>
      setText(
        context.lastComponent,
        formatLsCall(args, theme, isToolPending(context)),
      ),
    renderResult: renderLsResult,
  });

  pi.registerTool({
    name: "bash",
    label: bootstrap.bash.label,
    description: bootstrap.bash.description,
    parameters: bootstrap.bash.parameters,
    prepareArguments: bootstrap.bash.prepareArguments,
    executionMode: bootstrap.bash.executionMode,
    renderShell: "self",
    execute: (toolCallId, params, signal, onUpdate, ctx) =>
      getBuiltInTools(ctx.cwd, pi).bash.execute(
        toolCallId,
        params,
        signal,
        onUpdate,
      ),
    renderCall: (args, theme, context) =>
      setText(
        context.lastComponent,
        formatBashCall(args, theme, isToolPending(context)),
      ),
    renderResult: renderBashResult,
  });

  pi.registerTool({
    name: "edit",
    label: bootstrap.edit.label,
    description: bootstrap.edit.description,
    parameters: bootstrap.edit.parameters,
    prepareArguments: bootstrap.edit.prepareArguments,
    executionMode: bootstrap.edit.executionMode,
    renderShell: "self",
    execute: async (toolCallId, params, signal, onUpdate, ctx) =>
      getBuiltInTools(ctx.cwd, pi).edit.execute(
        toolCallId,
        params,
        signal,
        onUpdate,
      ),
    renderCall: (args, theme, context) =>
      setText(
        context.lastComponent,
        formatEditCall(args, theme, isToolPending(context)),
      ),
    renderResult: renderEditResult,
  });

  pi.registerTool({
    name: "write",
    label: bootstrap.write.label,
    description: bootstrap.write.description,
    parameters: bootstrap.write.parameters,
    prepareArguments: bootstrap.write.prepareArguments,
    executionMode: bootstrap.write.executionMode,
    renderShell: "self",
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      const result = await getBuiltInTools(ctx.cwd, pi).write.execute(
        toolCallId,
        params,
        signal,
        onUpdate,
      );
      rememberWriteTarget(toolCallId, params, ctx.cwd);
      return result;
    },
    renderCall: (args, theme, context) =>
      setText(
        context.lastComponent,
        formatWriteCall(args, theme, isToolPending(context)),
      ),
    renderResult: renderWriteResult,
  });
}

function installToolRenderInterceptor(pi: ExtensionAPI): void {
  if (toolRenderInterceptorInstalled.has(pi)) return;

  const originalRegisterTool = pi.registerTool.bind(
    pi,
  ) as ExtensionAPI["registerTool"];
  (
    pi as unknown as { registerTool: ExtensionAPI["registerTool"] }
  ).registerTool = (tool) => {
    const name = tool.name;
    let wrappedToolNames = wrappedExtensionTools.get(pi);
    if (!wrappedToolNames) {
      wrappedToolNames = new Set<string>();
      wrappedExtensionTools.set(pi, wrappedToolNames);
    }
    if (wrappedToolNames.has(name)) {
      return originalRegisterTool(tool);
    }

    // Always remove dark background, but only override rendering
    // for tools that don't already have custom renderers
    const hasCustomRender = tool.renderCall || tool.renderResult;
    const wrappedTool = {
      ...tool,
      execute: tool.execute,
      renderShell: "self" as const,
      ...(hasCustomRender
        ? {}
        : {
            renderCall: (args: any, theme: any, context: any) => {
              const title = name === "Agent" ? "Agent" : webToolTitle(name);
              const body =
                name === "Agent"
                  ? agentToolCallBody(args, theme)
                  : webToolCallBody(name, args, theme);
              return setText(
                context.lastComponent,
                genericToolCall(title, body, theme, isToolPending(context)),
              );
            },
            renderResult: (
              result: any,
              options: any,
              theme: any,
              context: any,
            ) =>
              genericToolResult(
                result,
                options,
                theme,
                context,
                name === "Agent" ? "Agent" : webToolTitle(name),
              ),
          }),
    };
    wrappedToolNames.add(name);
    return originalRegisterTool(wrappedTool);
  };
  toolRenderInterceptorInstalled.add(pi);
}

type WidgetPatchableUI = {
  setWidget?: (key: string, value: unknown, options?: unknown) => void;
  __claudeUiOriginalSetWidget?: (
    key: string,
    value: unknown,
    options?: unknown,
  ) => void;
  __claudeUiWidgetPatch?: boolean;
  __claudeUiSlashCompletionsPatch?: boolean;
};

const patchedWidgetUis = new Set<WidgetPatchableUI>();

function hideBuiltInWorking(ctx: ExtensionContext): void {
  (
    ctx.ui as typeof ctx.ui & { setWorkingVisible?: (visible: boolean) => void }
  ).setWorkingVisible?.(false);
}

function suppressSubagentWidget(ctx: ExtensionContext): void {
  const ui = ctx.ui as unknown as WidgetPatchableUI;
  if (!ui.setWidget || ui.__claudeUiWidgetPatch) return;

  const originalSetWidget = ui.setWidget;
  ui.__claudeUiOriginalSetWidget = originalSetWidget;
  ui.setWidget = (key, value, options) => {
    if (key === "agents" && value !== undefined) return;
    originalSetWidget.call(ui, key, value, options);
  };
  ui.__claudeUiWidgetPatch = true;
  patchedWidgetUis.add(ui);
  originalSetWidget.call(ui, "agents", undefined);
}

function restoreSubagentWidgetPatches(): void {
  for (const ui of patchedWidgetUis) {
    if (ui.__claudeUiOriginalSetWidget) {
      ui.setWidget = ui.__claudeUiOriginalSetWidget;
    }
    delete ui.__claudeUiOriginalSetWidget;
    delete ui.__claudeUiWidgetPatch;
  }
  patchedWidgetUis.clear();
}

function hideSlashCompletions(ctx: ExtensionContext): void {
  const ui = ctx.ui as unknown as WidgetPatchableUI;
  if (ui.__claudeUiSlashCompletionsPatch) return;
  ui.__claudeUiSlashCompletionsPatch = true;
  ctx.ui.addAutocompleteProvider((current) => ({
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const suggestions = await current.getSuggestions(
        lines,
        cursorLine,
        cursorCol,
        options,
      );
      if (!suggestions) return suggestions;
      return {
        ...suggestions,
        items: suggestions.items.filter(
          (item) => !HIDDEN_SLASH_COMPLETIONS.has(item.value),
        ),
      };
    },
    applyCompletion: (lines, cursorLine, cursorCol, item, prefix) =>
      current.applyCompletion(lines, cursorLine, cursorCol, item, prefix),
    shouldTriggerFileCompletion: (lines, cursorLine, cursorCol) =>
      current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ??
      true,
  }));
}

type IntercomMessageDetails = {
  from?: { id?: string; name?: string; cwd?: string };
  message?: { content?: { text?: string } };
  bodyText?: string;
  replyCommand?: string;
};

function compactSubagentResultMessage(text: string): string | undefined {
  if (!/^Run:/m.test(text) || !/^Status:/m.test(text)) return undefined;
  const run = text.match(/^Run:\s*(.+)$/m)?.[1]?.trim();
  const status = text.match(/^Status:\s*(.+)$/m)?.[1]?.trim();
  const children = text.match(/^Children:\s*(.+)$/m)?.[1]?.trim();
  const child = text.match(/^1\.\s+(.+)$/m)?.[1]?.trim();
  const summary = text
    .match(/^Summary:\s*\n([\s\S]*?)(?:\n\n|$)/m)?.[1]
    ?.trim();
  return [
    `subagent result${status ? ` · ${status}` : ""}${children ? ` · ${children}` : ""}`,
    run ? `run: ${run}` : undefined,
    child,
    summary
      ? `summary: ${compactOneLine(summary.split("\n", 1)[0] ?? "", 100)}`
      : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function renderIntercomMessage(
  message: { content?: unknown; details?: unknown },
  _options: { expanded: boolean },
  theme: Theme,
): Component | undefined {
  const details = message.details as IntercomMessageDetails | undefined;
  const from = details?.from;
  const sender = from?.name || from?.id?.slice(0, 8) || "intercom";
  const cwd = from?.cwd ?? "";
  const rawText =
    details?.bodyText ??
    details?.message?.content?.text ??
    (typeof message.content === "string" ? message.content : "");
  const body =
    sender === "subagent-result"
      ? (compactSubagentResultMessage(rawText) ?? rawText)
      : rawText;

  return {
    invalidate() {},
    render(width: number): string[] {
      if (width < 3) return [truncateToWidth(`From ${sender}`, width)];
      const bodyWidth = Math.max(1, width - 2);
      const header = ` 📨 From: ${sender}${cwd ? ` (${cwd})` : ""} `;
      const headerText = truncateToWidth(header, bodyWidth, "");
      const headerPadding = Math.max(0, bodyWidth - visibleWidth(headerText));
      const lines = [
        theme.fg("accent", `╭${headerText}${"─".repeat(headerPadding)}╮`),
      ];
      for (const line of wrapTextWithAnsi(body, bodyWidth)) {
        const text = truncateToWidth(line, bodyWidth, "");
        const padding = Math.max(0, bodyWidth - visibleWidth(text));
        lines.push(theme.fg("accent", `│${text}${" ".repeat(padding)}│`));
      }
      if (details?.replyCommand) {
        lines.push(theme.fg("accent", `│${" ".repeat(bodyWidth)}│`));
        for (const line of wrapTextWithAnsi(
          theme.fg("dim", ` ↩ To reply: ${details.replyCommand}`),
          bodyWidth,
        )) {
          const text = truncateToWidth(line, bodyWidth, "");
          const padding = Math.max(0, bodyWidth - visibleWidth(text));
          lines.push(theme.fg("accent", `│${text}${" ".repeat(padding)}│`));
        }
      }
      lines.push(theme.fg("accent", `╰${"─".repeat(bodyWidth)}╯`));
      return lines;
    },
  };
}

export default function (pi: ExtensionAPI) {
  let activeCtx: ExtensionContext | undefined;
  let activeTui: TUI | undefined;
  let workingState: WorkingState = "inactive";
  let workingStateStartedAt: number | undefined;
  let statusAnimationTimer: ReturnType<typeof setInterval> | undefined;
  let idleReconcileTimer: ReturnType<typeof setTimeout> | undefined;
  let footerRenderRevision = 0;
  const footerDisposers = new Set<() => void>();

  const getWorkingState = (): WorkingStateSnapshot => {
    const elapsedSeconds =
      workingStateStartedAt === undefined
        ? 0
        : Math.max(0, Math.floor((Date.now() - workingStateStartedAt) / 1000));

    return { state: workingState, elapsedSeconds };
  };
  const bumpFooterRenderRevision = () => {
    footerRenderRevision += 1;
  };
  const requestRender = () => activeTui?.requestRender();
  const stopStatusAnimation = () => {
    if (!statusAnimationTimer) return;
    clearInterval(statusAnimationTimer);
    statusAnimationTimer = undefined;
  };
  const startStatusAnimation = () => {
    if (statusAnimationTimer) return;
    statusAnimationTimer = setInterval(requestRender, 1000);
    (statusAnimationTimer as { unref?: () => void }).unref?.();
  };
  const clearIdleReconcile = () => {
    if (!idleReconcileTimer) return;
    clearTimeout(idleReconcileTimer);
    idleReconcileTimer = undefined;
  };
  const isStaleContextError = (error: unknown) =>
    error instanceof Error &&
    error.message.includes(
      "extension ctx is stale after session replacement or reload",
    );
  const clearStaleContext = (ctx: ExtensionContext) => {
    if (activeCtx === ctx) activeCtx = undefined;
  };
  const safeHasUI = (ctx: ExtensionContext): boolean => {
    try {
      return ctx.hasUI;
    } catch (error) {
      if (!isStaleContextError(error)) throw error;
      const wasActive = activeCtx === ctx;
      clearStaleContext(ctx);
      if (wasActive) setWorkingState("inactive");
      return false;
    }
  };
  const safeIdleState = (ctx: ExtensionContext): "idle" | "busy" | "stale" => {
    try {
      return ctx.isIdle() ? "idle" : "busy";
    } catch (error) {
      if (isStaleContextError(error)) {
        clearStaleContext(ctx);
        return "stale";
      }
      throw error;
    }
  };
  const setWorkingState = (state: WorkingState, ctx?: ExtensionContext) => {
    if (ctx && safeHasUI(ctx)) hideBuiltInWorking(ctx);
    if (state === "inactive") clearIdleReconcile();
    if (workingState === state) return;
    workingState = state;
    workingStateStartedAt = state === "inactive" ? undefined : Date.now();
    if (state === "streaming") startStatusAnimation();
    else stopStatusAnimation();
    requestRender();
  };
  const reconcileIdleState = () => {
    const ctx = activeCtx;
    if (!ctx) return;
    if (pendingToolCalls.size === 0 && safeIdleState(ctx) === "idle") {
      setWorkingState("inactive", ctx);
    }
  };
  const scheduleIdleReconcile = () => {
    if (idleReconcileTimer) return;
    idleReconcileTimer = setTimeout(() => {
      idleReconcileTimer = undefined;
      reconcileIdleState();
    }, 50);
    (idleReconcileTimer as { unref?: () => void }).unref?.();
  };

  patchToolExecutionRenderers();
  patchAssistantMessageRender();
  patchUserMessageRender();
  patchCompactionSummaryRender();
  installToolRenderInterceptor(pi);
  registerClaudeToolRenderers(pi);
  registerContextCommand(pi);
  pi.registerMessageRenderer("intercom_message", renderIntercomMessage);

  pi.on("session_start", (_event, ctx) => {
    try {
      bumpFooterRenderRevision();
      writeSnapshots.clear();
      inlineImageCache.clear();
      toolExecutionExpandedById.clear();
      pendingToolCalls.clear();
      setWorkingState("inactive");
      if (!safeHasUI(ctx)) return;

      activeCtx = ctx;
      hideBuiltInWorking(ctx);
      suppressSubagentWidget(ctx);
      hideSlashCompletions(ctx);
      patchUserMessageRender();

      ctx.ui.setEditorComponent((tui, theme, keybindings) => {
        activeTui = tui;
        return new ClaudeEditor(
          tui,
          theme,
          keybindings,
          getWorkingState,
          () => {
            try {
              ctx.shutdown();
            } catch (error) {
              if (!isStaleContextError(error)) throw error;
              clearStaleContext(ctx);
            }
          },
        );
      });

      ctx.ui.setFooter((tui, theme, footerData) => {
        activeTui = tui;
        let footerCache:
          | {
              revision: number;
              ctx: ExtensionContext;
              width: number;
              branch: string | undefined;
              thinkingLevel: string;
              lines: string[];
            }
          | undefined;
        const disposeBranch = footerData.onBranchChange(() => {
          bumpFooterRenderRevision();
          tui.requestRender();
        });
        const dispose = () => {
          footerDisposers.delete(dispose);
          disposeBranch();
        };
        footerDisposers.add(dispose);
        return {
          dispose,
          invalidate() {
            footerCache = undefined;
            bumpFooterRenderRevision();
            tui.requestRender();
          },
          render(width: number): string[] {
            const currentCtx = activeCtx ?? ctx;
            const branch = footerData.getGitBranch() ?? undefined;
            const thinkingLevel = pi.getThinkingLevel();
            if (
              footerCache &&
              footerCache.revision === footerRenderRevision &&
              footerCache.ctx === currentCtx &&
              footerCache.width === width &&
              footerCache.branch === branch &&
              footerCache.thinkingLevel === thinkingLevel
            ) {
              return footerCache.lines;
            }

            let raw: string | undefined;
            try {
              raw = footerLine(currentCtx, width, branch, theme, thinkingLevel);
            } catch (error) {
              if (!isStaleContextError(error)) throw error;
              clearStaleContext(currentCtx);
              raw = undefined;
            }
            const lines = raw ? [fitLine(raw, width), fitLine("", width)] : [];
            footerCache = {
              revision: footerRenderRevision,
              ctx: currentCtx,
              width,
              branch,
              thinkingLevel,
              lines,
            };
            return lines;
          },
        };
      });
    } catch (error) {
      if (!isStaleContextError(error)) throw error;
      clearStaleContext(ctx);
    }
  });

  pi.on("before_agent_start", (_event, ctx) => {
    if (!safeHasUI(ctx)) return;
    activeCtx = ctx;
    bumpFooterRenderRevision();
    setWorkingState("working", ctx);
    patchUserMessageRender();
  });

  pi.on("agent_start", (_event, ctx) => {
    if (!safeHasUI(ctx)) return;
    activeCtx = ctx;
    bumpFooterRenderRevision();
    setWorkingState("working", ctx);
  });

  pi.on("message_update", (event, ctx) => {
    if (!safeHasUI(ctx)) return;
    activeCtx = ctx;
    // Keep footer context/cost stable during assistant streaming. Recomputing
    // context usage on every message_update makes keystroke-triggered renders
    // scale with transcript size in long sessions; turn boundaries refresh it.
    if (event.message.role === "assistant") {
      const idleState = safeIdleState(ctx);
      if (idleState === "stale") {
        setWorkingState("inactive");
        return;
      }
      if (idleState === "idle" && pendingToolCalls.size === 0) {
        setWorkingState("inactive", ctx);
      } else {
        setWorkingState("streaming", ctx);
        scheduleIdleReconcile();
      }
    }
  });

  pi.on("tool_execution_start", (event, ctx) => {
    if (!safeHasUI(ctx)) return;
    pendingToolCalls.add(event.toolCallId);
    activeCtx = ctx;
    setWorkingState("working", ctx);
  });

  pi.on("tool_execution_update", (event, ctx) => {
    if (!safeHasUI(ctx)) return;
    pendingToolCalls.add(event.toolCallId);
    activeCtx = ctx;
    setWorkingState("working", ctx);
  });

  pi.on("tool_execution_end", (event, ctx) => {
    pendingToolCalls.delete(event.toolCallId);
    if (!safeHasUI(ctx)) return;
    activeCtx = ctx;
    const idleState = safeIdleState(ctx);
    if (idleState === "stale") {
      setWorkingState("inactive");
      return;
    }
    if (pendingToolCalls.size === 0 && idleState === "idle") {
      setWorkingState("inactive", ctx);
    } else {
      setWorkingState("working", ctx);
      scheduleIdleReconcile();
    }
  });

  pi.on("agent_end", (_event, ctx) => {
    if (!safeHasUI(ctx)) return;
    activeCtx = ctx;
    bumpFooterRenderRevision();
    sessionCostCache.delete(ctx);
    setWorkingState("inactive", ctx);
  });

  pi.on("session_shutdown", () => {
    stopStatusAnimation();
    clearIdleReconcile();
    toolExecutionExpandedById.clear();
    for (const dispose of footerDisposers) dispose();
    footerDisposers.clear();
    restoreSubagentWidgetPatches();
    writeSnapshots.clear();
    inlineImageCache.clear();
    activeTui = undefined;
    activeCtx = undefined;
    pendingToolCalls.clear();
    workingState = "inactive";
    workingStateStartedAt = undefined;
  });
}
