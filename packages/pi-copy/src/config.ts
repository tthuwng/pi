import type { BridgeCommand } from "./bridge.js";

export interface PiCopyConfig {
	/** Command that uploads or fetches the local clipboard image and prints a remote path. */
	command?: BridgeCommand;
	/** Maximum time to wait for the bridge command. */
	timeoutMs?: number;
	/** Show a warning when the bridge command fails before falling back to Pi's normal image paste. */
	notifyOnFailure?: boolean;
}

export interface ResolvedPiCopyConfig {
	command: BridgeCommand;
	timeoutMs: number;
	notifyOnFailure: boolean;
}

export const DEFAULT_PI_COPY_CONFIG: ResolvedPiCopyConfig = {
	command: "clipaste-paste",
	timeoutMs: 5000,
	notifyOnFailure: true,
};

export function resolvePiCopyConfig(
	config: PiCopyConfig = {},
	env: NodeJS.ProcessEnv = process.env,
): ResolvedPiCopyConfig {
	return {
		command:
			config.command ??
			env.PI_COPY_COMMAND ??
			env.PI_PASTER_CLIPBOARD_COMMAND ??
			DEFAULT_PI_COPY_CONFIG.command,
		timeoutMs: config.timeoutMs ?? parsePositiveInt(env.PI_COPY_TIMEOUT_MS) ?? DEFAULT_PI_COPY_CONFIG.timeoutMs,
		notifyOnFailure:
			config.notifyOnFailure ?? parseBoolean(env.PI_COPY_NOTIFY_FAILURE) ?? DEFAULT_PI_COPY_CONFIG.notifyOnFailure,
	};
}

function parsePositiveInt(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
	if (!value) return undefined;
	if (/^(1|true|yes|on)$/i.test(value)) return true;
	if (/^(0|false|no|off)$/i.test(value)) return false;
	return undefined;
}
