import {
	chmodSync,
	existsSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

function writePrivateJson(path, value, mode) {
	const temporaryPath = join(dirname(path), `.${path.split("/").at(-1)}.${process.pid}.tmp`);
	writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	chmodSync(temporaryPath, mode & 0o777);
	renameSync(temporaryPath, path);
}

/**
 * Adapt Pi 0.84+'s ModelRegistry to the legacy authStorage shape used by the
 * vendored multi-pass implementation.
 */
export function createAuthStorage(ctx, options = {}) {
	const readStoredCredential = options.readStoredCredential ?? (() => undefined);
	const authPath = options.authPath;
	const registry = ctx.modelRegistry;

	return {
		hasAuth(provider) {
			return Boolean(registry.getProviderAuthStatus(provider)?.configured);
		},
		get(provider) {
			return readStoredCredential(provider);
		},
		logout(provider) {
			if (!authPath || !existsSync(authPath)) return;
			try {
				const auth = JSON.parse(readFileSync(authPath, "utf8"));
				if (!auth || typeof auth !== "object" || !(provider in auth)) return;
				delete auth[provider];
				writePrivateJson(authPath, auth, statSync(authPath).mode);
			} catch {
				// Keep account management usable; Pi will surface later auth errors.
			}
		},
	};
}

/** Install the adapter once on Pi's per-session model registry. */
export function installAuthStorage(ctx, options = {}) {
	const registry = ctx.modelRegistry;
	if (registry.authStorage && typeof registry.authStorage.hasAuth === "function") {
		return registry.authStorage;
	}

	const authStorage = createAuthStorage(ctx, options);
	Object.defineProperty(registry, "authStorage", {
		configurable: true,
		enumerable: false,
		value: authStorage,
		writable: false,
	});
	return authStorage;
}
