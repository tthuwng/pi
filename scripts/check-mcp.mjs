#!/usr/bin/env node
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { Client } from "../mcp-servers/tree-sitter/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "../mcp-servers/tree-sitter/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";

const config = JSON.parse(readFileSync(new URL("../mcp.json", import.meta.url), "utf8"));

for (const [name, server] of Object.entries(config.mcpServers)) {
  assert(server.command, `${name}: missing MCP command`);

  const client = new Client({ name: "pi-mcp-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    cwd: server.cwd,
    env: server.env ? { ...process.env, ...server.env } : undefined,
    stderr: "pipe",
  });

  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      void transport.close();
      reject(new Error(`${name}: MCP handshake timed out`));
    }, 10000);
  });

  try {
    const tools = await Promise.race([
      listTools(client, transport),
      timeout,
    ]);
    assert(tools.tools.length > 0, `${name}: MCP server returned no tools`);
    console.log(`ok: mcp ${name} (${tools.tools.length} tools)`);
  } catch (error) {
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
    throw error;
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => {});
  }
}

async function listTools(client, transport) {
  await client.connect(transport);
  return client.listTools();
}
