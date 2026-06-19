type ProviderPayload = {
	model?: unknown;
	service_tier?: unknown;
	[key: string]: unknown;
};

type ExtensionAPI = {
	on(
		event: "before_provider_request",
		handler: (event: { payload: unknown }) => ProviderPayload | undefined,
	): void;
};

const PRIORITY_MODELS = [/^gpt-/, /^o[0-9]/, /^openai\//];

function shouldUsePriority(payload: ProviderPayload): boolean {
	const model = payload.model;
	return (
		typeof model === "string" &&
		PRIORITY_MODELS.some((pattern) => pattern.test(model))
	);
}

export default function (pi: ExtensionAPI) {
	pi.on("before_provider_request", (event) => {
		if (
			!event.payload ||
			typeof event.payload !== "object" ||
			Array.isArray(event.payload)
		) {
			return undefined;
		}

		const payload = event.payload as ProviderPayload;
		if (!shouldUsePriority(payload)) {
			return undefined;
		}

		return {
			...payload,
			service_tier: "priority",
		};
	});
}
