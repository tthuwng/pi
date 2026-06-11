interface TimerApi {
	setTimeout(handler: () => void, delayMs: number): unknown;
	clearTimeout(handle: unknown): void;
}

interface FileCoalescer {
	schedule(file: string, delayMs?: number): boolean;
	clear(): void;
}

const defaultTimerApi: TimerApi = {
	setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
	clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createFileCoalescer(
	handler: (file: string) => void,
	defaultDelayMs: number,
	timerApi: TimerApi = defaultTimerApi,
): FileCoalescer {
	let nextId = 0;
	const pending = new Map<string, { timer: unknown; delayMs: number; id: number }>();

	return {
		schedule(file: string, delayMs = defaultDelayMs): boolean {
			const existing = pending.get(file);
			if (existing) {
				if (delayMs >= existing.delayMs) return false;
				timerApi.clearTimeout(existing.timer);
			}
			const id = nextId++;
			const timer = timerApi.setTimeout(() => {
				if (pending.get(file)?.id !== id) return;
				pending.delete(file);
				handler(file);
			}, delayMs);
			pending.set(file, { timer, delayMs, id });
			return true;
		},
		clear(): void {
			for (const { timer } of pending.values()) {
				timerApi.clearTimeout(timer);
			}
			pending.clear();
		},
	};
}
