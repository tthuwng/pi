import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type BridgeCommand = string | readonly string[];

export type BridgePathResult =
	| { ok: true; path: string }
	| { ok: false; reason: "empty" }
	| { ok: false; reason: "timeout" }
	| { ok: false; reason: "spawn-error"; error: string }
	| { ok: false; reason: "command-failed"; status: number | null }
	| { ok: false; reason: "missing" | "not-file"; path: string };

export interface ReadBridgePathOptions {
	command: BridgeCommand;
	cwd: string;
	timeoutMs: number;
}

const MAX_BRIDGE_OUTPUT_BYTES = 1024 * 1024;

export function readBridgePath(options: ReadBridgePathOptions): BridgePathResult {
	if (typeof options.command === "string") {
		return readBridgePathFromResult(
			spawnSync(options.command, {
				cwd: options.cwd,
				encoding: "utf8",
				maxBuffer: MAX_BRIDGE_OUTPUT_BYTES,
				shell: true,
				timeout: options.timeoutMs,
			}),
			options.cwd,
		);
	}

	const [command, ...args] = options.command;
	if (!command) return { ok: false, reason: "spawn-error", error: "empty command" };
	return readBridgePathFromResult(
		spawnSync(command, args, {
			cwd: options.cwd,
			encoding: "utf8",
			maxBuffer: MAX_BRIDGE_OUTPUT_BYTES,
			timeout: options.timeoutMs,
		}),
		options.cwd,
	);
}

function readBridgePathFromResult(result: SpawnSyncReturns<string>, cwd: string): BridgePathResult {
	if (result.error) {
		const error = result.error as NodeJS.ErrnoException;
		if (error.code === "ETIMEDOUT") return { ok: false, reason: "timeout" };
		return { ok: false, reason: "spawn-error", error: error.message };
	}
	if (result.signal) return { ok: false, reason: "timeout" };
	if (result.status !== 0) return { ok: false, reason: "command-failed", status: result.status };

	const outputPath = firstNonEmptyLine(result.stdout);
	if (!outputPath) return { ok: false, reason: "empty" };

	const path = resolveBridgePath(stripWrappingQuotes(outputPath), cwd);
	if (!existsSync(path)) return { ok: false, reason: "missing", path };
	try {
		if (!statSync(path).isFile()) return { ok: false, reason: "not-file", path };
	} catch {
		return { ok: false, reason: "missing", path };
	}
	return { ok: true, path };
}

function firstNonEmptyLine(output: string): string | undefined {
	for (const line of output.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed) return trimmed;
	}
	return undefined;
}

function stripWrappingQuotes(value: string): string {
	if (value.length < 2) return value;
	const first = value[0];
	const last = value[value.length - 1];
	if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
		return value.slice(1, -1);
	}
	return value;
}

function resolveBridgePath(path: string, cwd: string): string {
	if (path.startsWith("file://")) return fileURLToPath(path);
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
	if (isAbsolute(path)) return path;
	return resolve(cwd, path);
}

export function quotePathForPaste(path: string): string {
	return /\s|['"]/.test(path) ? JSON.stringify(path) : path;
}
