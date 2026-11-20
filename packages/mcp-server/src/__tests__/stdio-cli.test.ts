import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BoardDoc } from "../crdt.js";

async function writeArchive(filePath: string): Promise<void> {
  const doc = new BoardDoc();
  doc.addTextBox({ x: 10, y: 20, text: "Stdio Smoke Note" });
  const update = doc.encodeState();
  doc.destroy();

  const header = {
    version: 1,
    boards: [
      {
        name: "Stdio Smoke Board",
        createdAt: 1000,
        updatedAt: 2000,
        updateSize: update.byteLength,
        assets: [],
      },
    ],
  };
  const jsonBuf = Buffer.from(JSON.stringify(header), "utf8");
  const preamble = Buffer.alloc(12);
  preamble.write("INKBOARD", 0, "ascii");
  preamble.writeUInt32LE(jsonBuf.byteLength, 8);
  await writeFile(filePath, Buffer.concat([preamble, jsonBuf, update]));
}

describe("inkboard-mcp CLI over stdio", () => {
  const cleanups: (() => Promise<void> | void)[] = [];

  afterEach(async () => {
    while (cleanups.length) {
      await cleanups.pop()!();
    }
  });

  it("serves MCP tools, resources, and prompts over stdio", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "inkboard-stdio-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const archivePath = path.join(dir, "smoke.inkboard");
    await writeArchive(archivePath);

    const cliPath = path.resolve(
      process.cwd(),
      "dist/cli.js",
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cliPath, "--inkboard-dir", dir],
      stderr: "pipe",
    });
    const client = new Client({ name: "stdio-test", version: "1.0.0" });
    await client.connect(transport);
    cleanups.push(async () => {
      await client.close();
    });

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("list_boards");

    const listed = await client.callTool({
      name: "list_boards",
      arguments: {},
    });
    const parsed = JSON.parse(
      (listed.content as { text: string; }[])[0].text,
    );
    expect(parsed.count).toBe(1);
    expect(parsed.boards[0].name).toBe("Stdio Smoke Board");
  });
});
