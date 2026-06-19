import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "typebox";
import path from "node:path";

const SUPPORTED_LANGUAGES = [
	"bash",
	"c",
	"cpp",
	"csharp",
	"css",
	"go",
	"html",
	"java",
	"javascript",
	"json",
	"kotlin",
	"lua",
	"php",
	"python",
	"ruby",
	"rust",
	"swift",
	"tsx",
	"typescript",
	"yaml",
] as const;

const DEFAULT_MAX_APPLY_MATCHES = 200;
const MAX_PREVIEW_MATCHES = 40;
const MAX_OUTPUT_CHARS = 20_000;

const CodemodPreviewParams = Type.Object({
	lang: StringEnum(SUPPORTED_LANGUAGES, {
		description: "ast-grep language, for example typescript, tsx, python, rust",
	}),
	pattern: Type.String({ description: "ast-grep pattern to match" }),
	rewrite: Type.String({
		description: "replacement using ast-grep metavariables",
	}),
	paths: Type.Array(Type.String(), {
		minItems: 1,
		description:
			"Files or directories to search. Required; no implicit repo-wide default.",
	}),
	apply: Type.Optional(
		Type.Boolean({
			description: "Apply the rewrite after preview and confirmation",
		}),
	),
	allowBroad: Type.Optional(
		Type.Boolean({
			description: "Allow apply against . or the current repo root",
		}),
	),
	maxApplyMatches: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: 5000,
			description: "Refuse apply when preview has more matches than this limit",
		}),
	),
});

type CodemodPreviewParams = {
	lang: (typeof SUPPORTED_LANGUAGES)[number];
	pattern: string;
	rewrite: string;
	paths: string[];
	apply?: boolean;
	allowBroad?: boolean;
	maxApplyMatches?: number;
};

type PreviewMatch = {
	file?: string;
	replacement?: string;
	range?: {
		start?: { line?: number; column?: number };
		end?: { line?: number; column?: number };
	};
	text?: string;
};

type PreviewResult = {
	matches: PreviewMatch[];
	raw: string;
};

type CodemodPreviewDetails = {
	applied: boolean;
	command: string;
	matchCount: number;
	files: string[];
	truncated: boolean;
};

type ExecResult = {
	stdout: string;
	stderr: string;
	code: number;
};

type RunMode = "preview" | "apply";

function normalizeParams(input: CodemodPreviewParams): CodemodPreviewParams {
	return {
		...input,
		paths: input.paths.map((entry) => entry.trim()).filter(Boolean),
		apply: input.apply ?? false,
		allowBroad: input.allowBroad ?? false,
		maxApplyMatches: input.maxApplyMatches ?? DEFAULT_MAX_APPLY_MATCHES,
	};
}

function validateParams(params: CodemodPreviewParams): string | undefined {
	if (!params.pattern.trim()) return "pattern is required";
	if (!params.rewrite.trim()) return "rewrite is required";
	if (params.paths.length === 0)
		return "paths must include at least one file or directory";
	if (params.paths.some((entry) => entry.includes("\0")))
		return "paths must not contain NUL bytes";
	return undefined;
}

function isBroadPath(cwd: string, target: string): boolean {
	const resolved = path.resolve(cwd, target);
	return (
		target === "." ||
		target === "./" ||
		resolved === path.resolve(cwd) ||
		resolved === path.parse(resolved).root
	);
}

function commandForDisplay(
	params: CodemodPreviewParams,
	mode: RunMode,
): string {
	const pieces = [
		"sg",
		"run",
		"-p",
		JSON.stringify(params.pattern),
		"-r",
		JSON.stringify(params.rewrite),
		"-l",
		params.lang,
	];
	if (mode === "apply") pieces.push("-U");
	else pieces.push("--json=pretty");
	pieces.push("--", ...params.paths.map((entry) => JSON.stringify(entry)));
	return pieces.join(" ");
}

function buildArgs(params: CodemodPreviewParams, mode: RunMode): string[] {
	const args = [
		"run",
		"-p",
		params.pattern,
		"-r",
		params.rewrite,
		"-l",
		params.lang,
	];
	if (mode === "apply") args.push("-U");
	else args.push("--json=pretty");
	args.push("--", ...params.paths);
	return args;
}

function parsePreview(stdout: string): PreviewMatch[] {
	const trimmed = stdout.trim();
	if (!trimmed) return [];
	const parsed: unknown = JSON.parse(trimmed);
	if (!Array.isArray(parsed)) return [];
	return parsed.filter(
		(item): item is PreviewMatch => Boolean(item) && typeof item === "object",
	);
}

function formatLocation(match: PreviewMatch): string {
	const file = match.file ?? "<unknown>";
	const line = match.range?.start?.line;
	const column = match.range?.start?.column;
	if (typeof line !== "number") return file;
	if (typeof column !== "number") return `${file}:${line + 1}`;
	return `${file}:${line + 1}:${column + 1}`;
}

function summarizePreview(
	params: CodemodPreviewParams,
	preview: PreviewResult,
	mode: RunMode,
): string {
	const files = new Set(
		preview.matches
			.map((match) => match.file)
			.filter((file): file is string => Boolean(file)),
	);
	const lines = [
		`${mode === "apply" ? "Applied" : "Previewed"} ${preview.matches.length} match(es) across ${files.size} file(s).`,
		"",
		commandForDisplay(params, mode),
	];

	if (preview.matches.length > 0) {
		lines.push("", "Matches:");
		for (const match of preview.matches.slice(0, MAX_PREVIEW_MATCHES)) {
			const replacement = match.replacement ? ` -> ${match.replacement}` : "";
			lines.push(`- ${formatLocation(match)}${replacement}`);
		}
		if (preview.matches.length > MAX_PREVIEW_MATCHES) {
			lines.push(
				`- ... ${preview.matches.length - MAX_PREVIEW_MATCHES} more match(es) omitted`,
			);
		}
	}

	const text = lines.join("\n");
	if (text.length <= MAX_OUTPUT_CHARS) return text;
	return `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n[Output truncated to ${MAX_OUTPUT_CHARS} characters]`;
}

async function runSg(
	pi: ExtensionAPI,
	cwd: string,
	params: CodemodPreviewParams,
	mode: RunMode,
): Promise<ExecResult> {
	const result = await pi.exec("sg", buildArgs(params, mode), {
		cwd,
		timeout: 30_000,
	});
	return { stdout: result.stdout, stderr: result.stderr, code: result.code };
}

async function preview(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	params: CodemodPreviewParams,
): Promise<PreviewResult> {
	const result = await runSg(pi, ctx.cwd, params, "preview");
	if (result.code !== 0) {
		const details =
			result.stderr.trim() ||
			result.stdout.trim() ||
			`exit code ${result.code}`;
		throw new Error(`ast-grep preview failed: ${details}`);
	}
	return { matches: parsePreview(result.stdout), raw: result.stdout };
}

async function confirmApply(
	ctx: ExtensionContext,
	params: CodemodPreviewParams,
	previewResult: PreviewResult,
): Promise<boolean> {
	if (!params.apply) return false;
	if (!ctx.hasUI) {
		throw new Error(
			"apply requires interactive confirmation; rerun from the TUI",
		);
	}
	const files = new Set(
		previewResult.matches.map((match) => match.file).filter(Boolean),
	);
	const confirmed = await ctx.ui.confirm(
		"Apply codemod?",
		`Apply ${previewResult.matches.length} replacement(s) across ${files.size} file(s)?`,
	);
	return confirmed;
}

async function runCodemod(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	rawParams: CodemodPreviewParams,
) {
	const params = normalizeParams(rawParams);
	const validationError = validateParams(params);
	if (validationError) throw new Error(validationError);

	const previewResult = await preview(pi, ctx, params);
	const files = Array.from(
		new Set(
			previewResult.matches
				.map((match) => match.file)
				.filter((file): file is string => Boolean(file)),
		),
	);
	const details: CodemodPreviewDetails = {
		applied: false,
		command: commandForDisplay(params, "preview"),
		matchCount: previewResult.matches.length,
		files,
		truncated: previewResult.raw.length > MAX_OUTPUT_CHARS,
	};

	if (!params.apply || previewResult.matches.length === 0) {
		return {
			content: [
				{
					type: "text" as const,
					text: summarizePreview(params, previewResult, "preview"),
				},
			],
			details,
		};
	}

	if (
		!params.allowBroad &&
		params.paths.some((target) => isBroadPath(ctx.cwd, target))
	) {
		throw new Error(
			"refusing to apply against . or the repo root without allowBroad: true",
		);
	}

	if (
		previewResult.matches.length >
		(params.maxApplyMatches ?? DEFAULT_MAX_APPLY_MATCHES)
	) {
		throw new Error(
			`refusing to apply ${previewResult.matches.length} matches; maxApplyMatches is ${params.maxApplyMatches}`,
		);
	}

	const confirmed = await confirmApply(ctx, params, previewResult);
	if (!confirmed) {
		return {
			content: [
				{
					type: "text" as const,
					text: `${summarizePreview(params, previewResult, "preview")}\n\nApply cancelled.`,
				},
			],
			details,
		};
	}

	const applyResult = await runSg(pi, ctx.cwd, params, "apply");
	if (applyResult.code !== 0) {
		const error =
			applyResult.stderr.trim() ||
			applyResult.stdout.trim() ||
			`exit code ${applyResult.code}`;
		throw new Error(`ast-grep apply failed: ${error}`);
	}

	return {
		content: [
			{
				type: "text" as const,
				text: summarizePreview(params, previewResult, "apply"),
			},
		],
		details: {
			...details,
			applied: true,
			command: commandForDisplay(params, "apply"),
		},
	};
}

function parseCommandArgs(args: string): CodemodPreviewParams {
	const trimmed = args.trim();
	if (!trimmed) {
		throw new Error(
			'usage: /codemod-preview {"lang":"typescript","pattern":"console.log($X)","rewrite":"logger.info($X)","paths":["src"]}',
		);
	}
	const parsed: unknown = JSON.parse(trimmed);
	if (!parsed || typeof parsed !== "object")
		throw new Error("codemod-preview arguments must be a JSON object");
	return parsed as CodemodPreviewParams;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "codemod_preview",
		label: "Codemod Preview",
		description:
			"Preview an ast-grep structural replacement, optionally applying it only after interactive confirmation. Paths are required; apply refuses broad repo-root rewrites unless allowBroad is true.",
		promptSnippet:
			"Preview ast-grep structural replacements before applying them with explicit confirmation.",
		promptGuidelines: [
			"Use codemod_preview for structural find-and-replace only after inspecting the target files or patterns.",
			"Use codemod_preview with apply false first unless the user explicitly approved applying the exact codemod scope.",
			"Do not use codemod_preview for broad repo-root rewrites unless the user approved that scope and allowBroad is true.",
		],
		parameters: CodemodPreviewParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return runCodemod(pi, ctx, params as CodemodPreviewParams);
		},
	});

	pi.registerCommand("codemod-preview", {
		description:
			"Preview/apply an ast-grep codemod from a JSON argument object",
		handler: async (args, ctx) => {
			const result = await runCodemod(pi, ctx, parseCommandArgs(args));
			const text = result.content[0]?.text ?? "Done";
			if (ctx.hasUI) await ctx.ui.editor("codemod-preview", text);
			else process.stdout.write(`${text}\n`);
		},
	});
}
