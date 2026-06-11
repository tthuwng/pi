import test from "node:test";
import assert from "node:assert/strict";

import { loadTs } from "../support/load-ts.mjs";

const { createFileCoalescer } = await loadTs("../../src/shared/file-coalescer.ts");

test("shorter-delay reschedule ignores already-queued stale callbacks", () => {
	const callbacks = [];
	const calls = [];
	const timers = {
		setTimeout(handler, delayMs) {
			const timer = { handler, delayMs, cleared: false };
			callbacks.push(timer);
			return timer;
		},
		clearTimeout(timer) {
			timer.cleared = true;
		},
	};
	const coalescer = createFileCoalescer((file) => calls.push(file), 50, timers);

	assert.equal(coalescer.schedule("a.json", 50), true);
	assert.equal(coalescer.schedule("a.json", 10), true);
	assert.equal(callbacks.length, 2);

	callbacks[0].handler();
	callbacks[1].handler();

	assert.deepEqual(calls, ["a.json"]);
});
