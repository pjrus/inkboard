import {
  Client,
  InMemoryTransport,
  ProtocolError,
  ProtocolErrorCode,
} from "@modelcontextprotocol/client";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { LiveBridgeBackend } from "../backend/LiveBridgeBackend.js";
import { BridgeServer } from "../bridge/BridgeServer.js";
import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeRequestMessage,
} from "../bridge/protocol.js";
import { BoardDoc } from "../crdt.js";
import { createInkboardMcpServer } from "../server.js";

interface MockBoard {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  doc: BoardDoc;
}

class MockBrowserTab {
  ws!: WebSocket;
  readonly boards = new Map<string, MockBoard>();
  activeBoardId: string | null = null;
  lastCreatedId = 1;

  constructor(
    private readonly tabId: string,
    seedBoards: MockBoard[] = [],
  ) {
    for (const b of seedBoards) {
      this.boards.set(b.id, b);
    }
  }

  async connect(
    port: number,
    token: string,
    origin = "http://localhost:5173",
  ): Promise<void> {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`, {
      headers: { origin },
    });
    await new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => {
        this.ws.send(
          JSON.stringify({
            type: "hello",
            protocolVersion: BRIDGE_PROTOCOL_VERSION,
            token,
            tabId: this.tabId,
            activeBoardId: this.activeBoardId,
          }),
        );
      });
      this.ws.once("error", reject);
      this.ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString("utf8"));
        if (msg.type === "hello_ack") {
          resolve();
          return;
        }
        if (msg.type === "request") {
          this.handleRequest(msg);
        }
      });
      this.ws.once("close", (code, reason) => {
        reject(new Error(`WS closed (${code}): ${reason.toString()}`));
      });
    });
  }

  close(): void {
    this.ws?.close();
  }

  private handleRequest(req: BridgeRequestMessage): void {
    try {
      const reply = (result: unknown) => {
        this.ws.send(
          JSON.stringify({
            type: "response",
            requestId: req.requestId,
            ok: true,
            result,
          }),
        );
      };

      switch (req.method) {
        case "list_boards": {
          const boards = Array.from(this.boards.values()).map((b) => ({
            id: b.id,
            name: b.name,
            createdAt: b.createdAt,
            updatedAt: b.updatedAt,
            isActive: this.activeBoardId === b.id,
            background: b.doc.getBackground(),
            objectCounts: b.doc.getObjectCounts(),
          }));
          reply({ boards });
          return;
        }
        case "get_board_state": {
          const b = this.boards.get(
            (req.params as { boardId: string; }).boardId,
          );
          if (!b) throw new Error("Board not found");
          reply({
            board: {
              id: b.id,
              name: b.name,
              createdAt: b.createdAt,
              updatedAt: b.updatedAt,
              isActive: this.activeBoardId === b.id,
            },
            stateUpdateBase64: Buffer.from(b.doc.encodeState()).toString(
              "base64",
            ),
          });
          return;
        }
        case "create_board": {
          const p = req.params as { name?: string; background?: string; };
          const id = `board-${this.lastCreatedId++}`;
          const now = Date.now();
          const doc = new BoardDoc();
          if (p.background) doc.setBackground(p.background);
          const board: MockBoard = {
            id,
            name: p.name ?? "Untitled board",
            createdAt: now,
            updatedAt: now,
            doc,
          };
          this.boards.set(id, board);
          reply({
            board: {
              id,
              name: board.name,
              createdAt: now,
              updatedAt: now,
              isActive: false,
              background: doc.getBackground(),
              objectCounts: doc.getObjectCounts(),
            },
          });
          return;
        }
        case "apply_yjs_update": {
          const p = req.params as { boardId: string; updateBase64: string; };
          const b = this.boards.get(p.boardId);
          if (!b) throw new Error("Board not found");
          Y.applyUpdate(
            b.doc.ydoc,
            new Uint8Array(Buffer.from(p.updateBase64, "base64")),
          );
          b.updatedAt = Date.now();
          reply({
            stateUpdateBase64: Buffer.from(b.doc.encodeState()).toString(
              "base64",
            ),
            updatedAt: b.updatedAt,
          });
          return;
        }
        case "export_board_pdf": {
          const p = req.params as { boardId: string; };
          const b = this.boards.get(p.boardId);
          if (!b) throw new Error("Board not found");
          const fakePdf = Buffer.from("%PDF-1.4\n%%EOF\n", "ascii");
          reply({
            bytesBase64: fakePdf.toString("base64"),
            fileName: `${b.name}.pdf`,
            pageCount: 1,
          });
          return;
        }
        case "export_board_preview": {
          const png1x1 =
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
          reply({
            dataBase64: png1x1,
            mimeType: "image/png",
            width: 1,
            height: 1,
          });
          return;
        }
      }
    } catch (err) {
      this.ws.send(
        JSON.stringify({
          type: "response",
          requestId: req.requestId,
          ok: false,
          error: {
            code: "ERR",
            message: err instanceof Error ? err.message : String(err),
          },
        }),
      );
    }
  }
}

describe("MCP Server + Local Live Bridge integration", () => {
  const cleanups: (() => Promise<void> | void)[] = [];

  afterEach(async () => {
    while (cleanups.length) {
      await cleanups.pop()!();
    }
  });

  it("rejects foreign origins and invalid pairing tokens", async () => {
    const bridge = new BridgeServer({ token: "good-token", port: 0 });
    const port = await bridge.start();
    cleanups.push(() => bridge.close());

    // Foreign origin rejected at HTTP upgrade (403).
    const foreignTab = new MockBrowserTab("tab-foreign");
    await expect(
      foreignTab.connect(port, "good-token", "https://evil.example"),
    ).rejects.toThrow();

    // Bad token closed with 4001.
    const badTokenTab = new MockBrowserTab("tab-bad");
    await expect(
      badTokenTab.connect(port, "wrong-token", "http://localhost:5173"),
    ).rejects.toThrow(/4001|Invalid pairing token/);
  });

  it("supports resources, read/write tools, prompts, and sandboxed PDF export", async () => {
    const exportDir = await mkdtemp(path.join(os.tmpdir(), "inkboard-exp-"));
    cleanups.push(() => rm(exportDir, { recursive: true, force: true }));

    const seedDoc = new BoardDoc();
    const { object: seedText } = seedDoc.addTextBox({
      x: 50,
      y: 60,
      text: "Distributed Systems Notes",
    });
    cleanups.push(() => seedDoc.destroy());

    const tab = new MockBrowserTab("tab-1", [
      {
        id: "b-seed",
        name: "Distributed Systems",
        createdAt: 1000,
        updatedAt: 2000,
        doc: seedDoc,
      },
    ]);
    tab.activeBoardId = "b-seed";

    const bridge = new BridgeServer({ token: "session-secret", port: 0 });
    const port = await bridge.start();
    cleanups.push(() => bridge.close());

    await tab.connect(port, "session-secret");
    cleanups.push(() => tab.close());

    const backend = new LiveBridgeBackend({
      bridge,
      exportDir,
    });
    const client = new Client(
      { name: "test-client", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    const [clientTransport, serverTransport] = InMemoryTransport
      .createLinkedPair();
    const serverHandle = serveStdio(
      () => createInkboardMcpServer({ backend }),
      {
        transport: serverTransport,
        legacy: "reject",
      },
    );
    await client.connect(clientTransport);
    cleanups.push(async () => {
      await client.close();
      await serverHandle.close();
    });

    // Tools list includes read & write tools.
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "list_boards",
        "get_board_summary",
        "query_objects",
        "export_board_pdf",
        "create_board",
        "add_text_box",
        "update_text_box",
        "add_stroke",
        "delete_objects",
      ]),
    );

    // Read resources.
    const boardsRes = await client.readResource({ uri: "inkboard://boards" });
    const boardsJson = JSON.parse(
      (boardsRes.contents[0] as { text: string; }).text,
    );
    expect(boardsJson.boards).toHaveLength(1);
    expect(boardsJson.boards[0].id).toBe("b-seed");

    const objectRes = await client.readResource({
      uri: `inkboard://boards/b-seed/objects/${seedText.id}`,
    });
    expect(
      JSON.parse((objectRes.contents[0] as { text: string; }).text).text,
    ).toBe("Distributed Systems Notes");

    const previewRes = await client.readResource({
      uri: "inkboard://boards/b-seed/preview",
    });
    expect((previewRes.contents[0] as { mimeType?: string; }).mimeType).toBe(
      "image/png",
    );

    // Create board & mutate via tools.
    const createRes = await client.callTool({
      name: "create_board",
      arguments: { name: "Event Pipeline", background: "#1c1d21" },
    });
    const createdBoard = JSON.parse(
      (createRes.content as { text: string; }[])[0].text,
    ).board;
    expect(createdBoard.name).toBe("Event Pipeline");

    const addTextRes = await client.callTool({
      name: "add_text_box",
      arguments: {
        boardId: createdBoard.id,
        x: 100,
        y: 120,
        text: "API Gateway",
      },
    });
    const textObj = JSON.parse(
      (addTextRes.content as { text: string; }[])[0].text,
    ).object;
    expect(textObj.color).toBe("#f2f1ee");

    const addStrokeRes = await client.callTool({
      name: "add_stroke",
      arguments: {
        boardId: createdBoard.id,
        tool: "pen",
        points: [{ x: 340, y: 140 }, { x: 480, y: 140 }],
      },
    });
    const strokeObj = JSON.parse(
      (addStrokeRes.content as { text: string; }[])[0].text,
    ).object;
    expect(strokeObj.pointCount).toBe(2);

    // Export PDF to sandboxed path.
    const exportRes = await client.callTool({
      name: "export_board_pdf",
      arguments: {
        boardId: "b-seed",
        outputPath: "handout.pdf",
      },
    });
    const exported = JSON.parse(
      (exportRes.content as { text: string; }[])[0].text,
    );
    expect(exported.outputPath).toBe(
      path.join(await realpath(exportDir), "handout.pdf"),
    );
    const written = await readFile(exported.outputPath, "ascii");
    expect(written).toContain("%PDF-1.4");

    // Path traversal blocked.
    const badExport = await client.callTool({
      name: "export_board_pdf",
      arguments: {
        boardId: "b-seed",
        outputPath: "../escape.pdf",
      },
    });
    expect(badExport.isError).toBe(true);

    // Missing resource raises a structured ProtocolError rather than a stringly error.
    let resourceErr: unknown;
    try {
      await client.readResource({
        uri: "inkboard://boards/b-seed/objects/does-not-exist",
      });
    } catch (err) {
      resourceErr = err;
    }
    expect(resourceErr).toBeInstanceOf(ProtocolError);
    expect((resourceErr as ProtocolError).code).toBe(
      ProtocolErrorCode.InvalidParams,
    );

    // Prompts work.
    const promptRes = await client.getPrompt({
      name: "summarize_board",
      arguments: { boardId: "b-seed" },
    });
    expect(promptRes.messages[0].content).toMatchObject({
      type: "text",
    });
  });

  it("hides mutation tools when readOnly is enabled", async () => {
    const bridge = new BridgeServer({
      token: "ro-secret",
      port: 0,
      readOnly: true,
    });
    await bridge.start();
    cleanups.push(() => bridge.close());

    const backend = new LiveBridgeBackend({ bridge, readOnly: true });
    const client = new Client(
      { name: "ro-client", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    const [clientTransport, serverTransport] = InMemoryTransport
      .createLinkedPair();
    const serverHandle = serveStdio(
      () => createInkboardMcpServer({ backend, readOnly: true }),
      {
        transport: serverTransport,
        legacy: "reject",
      },
    );
    await client.connect(clientTransport);
    cleanups.push(async () => {
      await client.close();
      await serverHandle.close();
    });

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toEqual([
      "list_boards",
      "get_board_summary",
      "query_objects",
      "export_board_pdf",
    ]);
  });
});
