import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	registerApiProvider,
	type Api,
	type Context,
	type Model,
	type SimpleStreamOptions,
	type StreamOptions,
} from "@mariozechner/pi-ai";

import {
	createCodexRetrySimpleStream,
	createCodexRetryStream,
} from "./retry.ts";

const MAX_ATTEMPTS_FLAG = "codex-retry-max-attempts";
const BASE_DELAY_FLAG = "codex-retry-base-delay-ms";
const MAX_ATTEMPTS_ENV = "PI_CODEX_RETRY_MAX_ATTEMPTS";
const BASE_DELAY_ENV = "PI_CODEX_RETRY_BASE_DELAY_MS";

function parseInteger(value: unknown): number | undefined {
	if (typeof value !== "string" || value.trim() === "") return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) return undefined;
	return Math.trunc(parsed);
}

export default function codexRetry(pi: ExtensionAPI) {
	pi.registerFlag(MAX_ATTEMPTS_FLAG, {
		description:
			"Total OpenAI Codex transport attempts before failing. Defaults to 3.",
		type: "string",
	});
	pi.registerFlag(BASE_DELAY_FLAG, {
		description:
			"Base exponential-backoff delay in ms for OpenAI Codex transport retry. Defaults to 1000.",
		type: "string",
	});

	const maxAttempts = () =>
		parseInteger(pi.getFlag(MAX_ATTEMPTS_FLAG)) ??
		parseInteger(process.env[MAX_ATTEMPTS_ENV]);
	const baseDelayMs = () =>
		parseInteger(pi.getFlag(BASE_DELAY_FLAG)) ??
		parseInteger(process.env[BASE_DELAY_ENV]);

	registerApiProvider(
		{
			api: "openai-codex-responses",
			stream: (model: Model<Api>, context: Context, options?: StreamOptions) =>
				createCodexRetryStream(
					model as Model<"openai-codex-responses">,
					context,
					options,
					{
						maxAttempts: maxAttempts(),
						baseDelayMs: baseDelayMs(),
					},
				),
			streamSimple: (
				model: Model<Api>,
				context: Context,
				options?: SimpleStreamOptions,
			) =>
				createCodexRetrySimpleStream(
					model as Model<"openai-codex-responses">,
					context,
					options,
					{
						maxAttempts: maxAttempts(),
						baseDelayMs: baseDelayMs(),
					},
				),
		},
		"pi-codex-retry",
	);
}
