import * as fs from "node:fs";
import * as path from "node:path";

function realpathIfAvailable(resolvedPath: string): string {
	try {
		return fs.realpathSync(resolvedPath);
	} catch {
		return resolvedPath;
	}
}

export function canonicalizeExistingPathForCollision(filePath: string): string {
	return realpathIfAvailable(path.resolve(filePath));
}

export function canonicalizeOutputPathForCollision(outputPath: string): string {
	const resolved = path.resolve(outputPath);
	try {
		return fs.realpathSync(resolved);
	} catch {
		const missingSegments: string[] = [];
		let current = resolved;
		while (true) {
			const parent = path.dirname(current);
			if (parent === current) {
				return path.join(parent, ...missingSegments.reverse());
			}
			missingSegments.push(path.basename(current));
			try {
				return path.join(fs.realpathSync(parent), ...missingSegments.reverse());
			} catch {
				current = parent;
			}
		}
	}
}
