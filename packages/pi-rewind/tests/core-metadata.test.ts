import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCheckpoint, git, loadCheckpointFromRef } from "../src/core.js";

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "pi-rewind-metadata-test-"));

  try {
    await git("init", root);
    await writeFile(join(root, "file.txt"), "hello\n");
    await git("add file.txt", root);

    const cp = await createCheckpoint({
      root,
      id: "metadata-1",
      sessionId: "session-1",
      trigger: "tool",
      turnIndex: 3,
      description: "\"fix rewind\" → edit → src/commands.ts",
      prompt: "fix rewind UI\nplease",
      toolDescriptions: ["edit → src/commands.ts", "bash: npx tsx tests/commands-ui.test.ts"],
    });

    assert.equal(cp.prompt, "fix rewind UI\nplease");
    assert.deepEqual(cp.toolDescriptions, [
      "edit → src/commands.ts",
      "bash: npx tsx tests/commands-ui.test.ts",
    ]);

    const loaded = await loadCheckpointFromRef(root, "metadata-1");
    assert.ok(loaded);
    assert.equal(loaded.prompt, "fix rewind UI\nplease");
    assert.deepEqual(loaded.toolDescriptions, [
      "edit → src/commands.ts",
      "bash: npx tsx tests/commands-ui.test.ts",
    ]);
    assert.equal(loaded.description, "\"fix rewind\" → edit → src/commands.ts");
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  console.log("core metadata tests passed");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
