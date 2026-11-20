import {
  Client,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  ProtocolError,
  ProtocolErrorCode,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InkboardFileBackend } from "../backend/InkboardFileBackend.js";
import { BoardDoc } from "../crdt.js";
import { createInkboardHttpHandler } from "../server.js";

async function writeArchive(filePath: string): Promise<void> {
  const doc = new BoardDoc();
  doc.addTextBox({ x: 10, y: 20, text: "HTTP v2 Note" });
  const update = doc.encodeState();
  doc.destroy();

  const header = {
    version: 1,
    boards: [
      {
        name: "HTTP v2 Board",
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

describe("MCP v2 (2026-07-28) stateless Streamable HTTP handler", () => {
  const cleanups: (() => Promise<void> | void)[] = [];

  afterEach(async () => {
    while (cleanups.length) {
      await cleanups.pop()!();
    }
  });

  async function startHttpServer() {
    const dir = await mkdtemp(path.join(os.tmpdir(), "inkboard-httpv2-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    await writeArchive(path.join(dir, "boards.inkboard"));

    const backend = new InkboardFileBackend({ rootPath: dir });
    const handler = createInkboardHttpHandler({ backend });
    const nodeHandler = toNodeHandler(handler);
    const httpServer = createServer((req, res) => {
      void nodeHandler(req, res);
    });
    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = httpServer.address() as { port: number; };
    const url = new URL(`http://127.0.0.1:${addr.port}/mcp`);

    cleanups.push(async () => {
      await handler.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });

    return { url, handler };
  }

  it("serves stateless 2026-07-28 clients with server/discover, cache hints, and ProtocolError", async () => {
    const { url } = await startHttpServer();
    const client = new Client(
      { name: "v2-http-client", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    const transport = new StreamableHTTPClientTransport(url);
    await client.connect(transport);
    cleanups.push(() => client.close());

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("list_boards");
    expect(tools.ttlMs).toBe(300_000);
    expect(tools.cacheScope).toBe("private");

    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((p) => p.name)).toContain("summarize_board");
    expect(prompts.ttlMs).toBe(300_000);
    expect(prompts.cacheScope).toBe("private");

    const resources = await client.listResources();
    expect(resources.resources.map((r) => r.uri)).toContain(
      "inkboard://boards",
    );
    expect(resources.ttlMs).toBe(0);
    expect(resources.cacheScope).toBe("private");

    const boardsRead = await client.readResource({ uri: "inkboard://boards" });
    expect(boardsRead.ttlMs).toBe(0);
    expect(boardsRead.cacheScope).toBe("private");

    const callRes = await client.callTool({
      name: "list_boards",
      arguments: {},
    });
    const parsed = JSON.parse(
      (callRes.content as { text: string; }[])[0].text,
    );
    expect(parsed.boards[0].name).toBe("HTTP v2 Board");

    let missingErr: unknown;
    try {
      await client.readResource({
        uri: "inkboard://boards/boards.inkboard%230/objects/missing",
      });
    } catch (err) {
      missingErr = err;
    }
    expect(missingErr).toBeInstanceOf(ProtocolError);
    expect((missingErr as ProtocolError).code).toBe(
      ProtocolErrorCode.InvalidParams,
    );
  });

  it("enforces MCP-Protocol-Version, Mcp-Method, Mcp-Name, _meta, and rejects legacy handshakes", async () => {
    const { url } = await startHttpServer();

    const validDiscoverBody = {
      jsonrpc: "2.0",
      id: 1,
      method: "server/discover",
      params: {
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
          [CLIENT_INFO_META_KEY]: { name: "raw-probe", version: "1.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    };

    // Valid server/discover succeeds with no Mcp-Session-Id header.
    const okRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "server/discover",
      },
      body: JSON.stringify(validDiscoverBody),
    });
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get("mcp-session-id")).toBeNull();
    const discoverJson = (await okRes.json()) as {
      result: {
        supportedVersions: string[];
        ttlMs: number;
        cacheScope: string;
        instructions?: string;
      };
    };
    expect(discoverJson.result.supportedVersions).toContain("2026-07-28");
    expect(discoverJson.result.ttlMs).toBe(300_000);
    expect(discoverJson.result.cacheScope).toBe("private");
    expect(discoverJson.result.instructions).toContain("list_boards");

    // Mismatched Mcp-Method header is rejected.
    const badMethodRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/list",
      },
      body: JSON.stringify(validDiscoverBody),
    });
    expect(badMethodRes.status).toBe(400);

    // Mismatched Mcp-Name header on tools/call is rejected.
    const badNameRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": "wrong_tool",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "list_boards",
          arguments: {},
          _meta: {
            [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
            [CLIENT_INFO_META_KEY]: { name: "raw-probe", version: "1.0.0" },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
    expect(badNameRes.status).toBe(400);

    // Legacy 2025 initialize handshake is rejected.
    const legacyRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "legacy", version: "1.0.0" },
        },
      }),
    });
    expect(legacyRes.status).toBe(400);
  });
});
