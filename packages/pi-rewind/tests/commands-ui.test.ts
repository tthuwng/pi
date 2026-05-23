import assert from "node:assert/strict";
import type { CheckpointData } from "../src/core.js";
import { formatCheckpointLabel, formatCheckpointPreview, formatCheckpointTime } from "../src/commands.js";
import { createInitialState } from "../src/state.js";

function checkpoint(overrides: Partial<CheckpointData> = {}): CheckpointData {
  return {
    id: "cp-1",
    sessionId: "session-1",
    trigger: "tool",
    turnIndex: 7,
    description: undefined,
    branch: "feature/rewrite",
    headSha: "head",
    indexTreeSha: "index-tree",
    worktreeTreeSha: "worktree-tree",
    timestamp: new Date(2026, 4, 20, 16, 34, 52).getTime(),
    ...overrides,
  };
}

const now = new Date(2026, 4, 20, 17, 0, 0).getTime();

assert.equal(
  formatCheckpointTime(new Date(2026, 4, 20, 16, 34, 52).getTime(), now),
  "Today 16:34:52",
);
assert.equal(
  formatCheckpointTime(new Date(2026, 4, 19, 23, 59, 1).getTime(), now),
  "Yesterday 23:59:01",
);
assert.equal(
  formatCheckpointTime(new Date(2026, 4, 18, 12, 0, 0).getTime(), now),
  "2026-05-18 12:00:00",
);

const state = createInitialState();

const structuredLabel = formatCheckpointLabel(
  checkpoint({
    prompt: "merge the 1620 PR into 1613 please",
    toolDescriptions: ["edit → benchmark-be/foo.py", "bash: uv run ruff check"],
  }),
  0,
  state,
  "feature/rewrite",
  now,
);
assert.match(structuredLabel, /#1 Today 16:34:52 \[feature\/rewrite\]/);
assert.match(structuredLabel, /Conversation: User: "merge the 1620 PR into 1613 please"/);
assert.match(structuredLabel, /Files\/tools: edit → benchmark-be\/foo\.py, bash: uv run ruff check/);

const legacyLabel = formatCheckpointLabel(
  checkpoint({ description: "\"fix it\" → edit → src/a.ts, bash: pnpm test" }),
  1,
  state,
  "other-branch",
  now,
);
assert.match(legacyLabel, /#2 Today 16:34:52 ⚠️ feature\/rewrite/);
assert.match(legacyLabel, /Conversation: User: "fix it"/);
assert.match(legacyLabel, /Files\/tools: edit → src\/a\.ts, bash: pnpm test/);

const preview = formatCheckpointPreview(
  checkpoint({
    prompt: "update rewind UI",
    toolDescriptions: ["write → tests/commands-ui.test.ts"],
  }),
  0,
  {
    type: "message",
    timestamp: new Date(2026, 4, 20, 16, 33, 0).toISOString(),
    message: { role: "user", content: "can you fix" },
  },
  "diff --git a/src/commands.ts b/src/commands.ts",
  now,
);
assert.match(preview, /Conversation checkpoint:\n  - User: "update rewind UI"\n  - Restore target: user: can you fix/);
assert.match(preview, /File checkpoint:\n  - write → tests\/commands-ui\.test\.ts/);
assert.match(preview, /Diff from checkpoint to current files:\ndiff --git/);

const noDiffPreview = formatCheckpointPreview(checkpoint({ trigger: "resume" }), 2, null, "", now);
assert.match(noDiffPreview, /No file diff from checkpoint to current HEAD/);

console.log("commands-ui tests passed");
