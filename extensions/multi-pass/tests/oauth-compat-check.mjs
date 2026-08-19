import assert from "node:assert/strict";
import { createLegacyOAuthAdapter } from "../lib/oauth-compat.mjs";

const events = [];
const native = {
	name: "Native Codex",
	isSubscription: true,
	async login(interaction) {
		interaction.notify({ type: "auth_url", url: "https://example.test/login", instructions: "open it" });
		const method = await interaction.prompt({
			type: "select",
			message: "Choose login",
			options: [{ id: "browser", label: "Browser" }],
		});
		assert.equal(method, "browser");
		return { type: "oauth", access: "access", refresh: "refresh", expires: 123 };
	},
	async refresh(credential, signal) {
		assert.equal(signal, "signal");
		return { ...credential, access: "refreshed" };
	},
	async toAuth(credential) {
		return { apiKey: credential.access };
	},
};

const adapter = createLegacyOAuthAdapter(native, { name: "ChatGPT Codex #2" });
const credential = await adapter.login({
	onAuth: (info) => events.push(["auth", info.url]),
	onDeviceCode: () => {},
	onPrompt: async () => "unused",
	onSelect: async (prompt) => {
		assert.equal(prompt.message, "Choose login");
		return prompt.options[0].id;
	},
	onProgress: () => {},
});

assert.equal(adapter.name, "ChatGPT Codex #2");
assert.equal(adapter.isSubscription, true);
assert.deepEqual(credential, { type: "oauth", access: "access", refresh: "refresh", expires: 123 });
assert.deepEqual(events, [["auth", "https://example.test/login"]]);
assert.equal((await adapter.refreshToken(credential, "signal")).access, "refreshed");
assert.equal(adapter.getApiKey(credential), "access");

console.log("oauth compatibility checks passed");
