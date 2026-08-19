/**
 * Adapt Pi 0.84+'s native OAuth interface to the legacy extension callback
 * interface used by the vendored multi-pass implementation.
 */
export function createLegacyOAuthAdapter(nativeOAuth, { name } = {}) {
	if (!nativeOAuth || typeof nativeOAuth.login !== "function") {
		throw new Error("Native OAuth provider is unavailable");
	}

	return {
		name: name ?? nativeOAuth.name,
		isSubscription: nativeOAuth.isSubscription,
		async login(callbacks) {
			const credential = await nativeOAuth.login({
				signal: callbacks.signal ?? new AbortController().signal,
				prompt: async (prompt) => {
					if (prompt.type === "select") {
						const selected = await callbacks.onSelect({
							message: prompt.message,
							options: prompt.options.map(({ id, label }) => ({ id, label })),
						});
						if (selected === undefined) throw new Error("Login cancelled");
						return selected;
					}
					if (prompt.type === "manual_code" && callbacks.onManualCodeInput) {
						return callbacks.onManualCodeInput();
					}
					return callbacks.onPrompt({
						message: prompt.message,
						placeholder: prompt.placeholder,
					});
				},
				notify: (event) => {
					switch (event.type) {
						case "auth_url":
							callbacks.onAuth({ url: event.url, instructions: event.instructions });
							break;
						case "device_code":
							callbacks.onDeviceCode(event);
							break;
						case "info":
						case "progress":
							callbacks.onProgress?.(event.message);
							break;
					}
				},
			});
			return credential;
		},
		async refreshToken(credentials, signal) {
			return nativeOAuth.refresh(credentials, signal);
		},
		getApiKey(credentials) {
			return credentials.access;
		},
	};
}
