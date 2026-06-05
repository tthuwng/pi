import * as path from "node:path";
import { canonicalizeOutputPathForCollision } from "./path-collision.ts";

export interface ChainOutputPathOwner {
	stepIndex: number;
	taskIndex?: number;
	agent: string;
}

export function resolveChainOutputPath(
	output: string | false | undefined,
	chainDir: string,
): string | undefined {
	if (typeof output !== "string" || !output) return undefined;
	return path.isAbsolute(output)
		? path.resolve(output)
		: path.resolve(chainDir, output);
}

function formatChainOutputPathOwner(owner: ChainOutputPathOwner): string {
	if (owner.taskIndex === undefined) {
		return `Chain step ${owner.stepIndex + 1} (${owner.agent})`;
	}
	return `Parallel chain step ${owner.stepIndex + 1} task ${owner.taskIndex + 1} (${owner.agent})`;
}

export function validateUniqueChainOutputPath(
	seen: Map<string, ChainOutputPathOwner>,
	outputPath: string | undefined,
	owner: ChainOutputPathOwner,
): string | undefined {
	if (!outputPath) return undefined;
	const outputKey = canonicalizeOutputPathForCollision(outputPath);
	const previous = seen.get(outputKey);
	if (previous) {
		return `${formatChainOutputPathOwner(previous)} and ${formatChainOutputPathOwner(owner)} resolve output to the same path: ${outputPath}. Use distinct output paths.`;
	}
	seen.set(outputKey, owner);
	return undefined;
}
