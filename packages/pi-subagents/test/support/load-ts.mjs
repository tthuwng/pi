import { pathToFileURL } from "node:url";

const jitiSpecifier = process.env.PI_SUBAGENTS_TEST_JITI
	? pathToFileURL(process.env.PI_SUBAGENTS_TEST_JITI).href
	: "jiti";

const { createJiti } = await import(jitiSpecifier);
export const jiti = createJiti(import.meta.url, { moduleCache: false });

export function loadTs(path) {
	return jiti.import(path);
}
