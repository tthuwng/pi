import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { formatCodexSessionStatus, formatCodexWeeklyStatus } from "../lib/statusline.mjs";

const now = Date.parse("2026-08-14T12:00:00Z");

assert.equal(
	formatCodexWeeklyStatus(
		{
			weekly: {
				usedPercent: 35,
				windowSeconds: 7 * 24 * 60 * 60,
				resetAt: Math.floor(Date.parse("2026-08-20T12:00:00Z") / 1000),
			},
		},
		now,
	),
	"Codex 35% used",
);

assert.equal(
	formatCodexWeeklyStatus({ weekly: undefined }, now),
	"Codex unavailable",
);

assert.equal(
	formatCodexWeeklyStatus(
		{
			weekly: {
				usedPercent: 100,
				windowSeconds: 7 * 24 * 60 * 60,
			},
		},
		now,
	),
	"Codex 100% used",
);

assert.equal(
	formatCodexSessionStatus({
		mode: "normal",
		account: "Codex #2",
		session: "weekly review",
	}),
	"normal · Codex #2 · weekly review",
);

const sourcePath = fileURLToPath(new URL("../extensions/multi-sub.ts", import.meta.url));
const source = await readFile(sourcePath, "utf8");
assert.match(source, /formatCodexSessionStatus/);
assert.match(source, /getSessionName\(\)/);
assert.match(source, /getStatusMode/);
assert.match(source, /setStatus\("pi-lens-lsp", undefined\)/);
assert.doesNotMatch(source, /formatCodexSessionStatus,\s*formatCodexWeeklyStatus/);

console.log("statusline checks passed");
