import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuthStorage } from "../lib/auth-compat.mjs";

const agentDir = await mkdtemp(join(tmpdir(), "pi-multi-pass-auth-"));
const authPath = join(agentDir, "auth.json");
const stored = {
	"openai-codex": { type: "oauth", access: "redacted-test-token", refresh: "refresh" },
	"anthropic": { type: "oauth", access: "anthropic-token", refresh: "refresh" },
};
await writeFile(authPath, `${JSON.stringify(stored)}\n`, { mode: 0o600 });

const registry = {
	getProviderAuthStatus(provider) {
		return { configured: provider === "openai-codex" };
	},
};

const auth = createAuthStorage(
	{ modelRegistry: registry },
	{
		authPath,
		readStoredCredential: (provider) => stored[provider],
	},
);

assert.equal(auth.hasAuth("openai-codex"), true);
assert.equal(auth.hasAuth("anthropic"), false);
assert.deepEqual(auth.get("openai-codex"), stored["openai-codex"]);

auth.logout("openai-codex");
assert.deepEqual(JSON.parse(await readFile(authPath, "utf8")), {
	"anthropic": stored.anthropic,
});

console.log("auth compatibility checks passed");
