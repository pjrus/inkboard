import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  BridgeServer,
  LiveBridgeBackend,
} from "../../../packages/mcp-server/src/index";
import { boardRepository } from "../../boards/BoardRepository";
import { BoardSession } from "../../boards/BoardSession";
import {
  bridgeWsUrl,
  generatePairingToken,
  isValidBridgePort,
} from "../../bridge/bridgeSettings";
import { McpBridgeClient } from "../../bridge/McpBridgeClient";
import { CanvasDocument, MCP_ORIGIN } from "../../document/crdt";
import { InkboardDB, setDB } from "../../storage/db";

describe("Browser MCP Bridge & Undo integration", () => {
  const cleanups: (() => Promise<void> | void)[] = [];

  beforeEach(() => {
    setDB(new InkboardDB(`mcp-bridge-test-${crypto.randomUUID()}`));
  });

  afterEach(async () => {
    while (cleanups.length) {
      await cleanups.pop()!();
    }
  });

  it("tracks MCP_ORIGIN edits in UndoManager so Cmd+Z undoes AI edits", () => {
    const doc = new CanvasDocument();
    const peer = new CanvasDocument();
    cleanups.push(() => {
      doc.destroy();
      peer.destroy();
    });

    const svBefore = Y.encodeStateVector(peer.ydoc);
    const created = peer.addText({
      x: 40,
      y: 50,
      width: 240,
      text: "AI Summary",
      fontFamily: "open-sans",
      fontSize: 20,
      color: "#1b1b1f",
    });
    const delta = Y.encodeStateAsUpdate(peer.ydoc, svBefore);

    let lastOrigin: unknown = null;
    doc.onChange((_changes, origin) => {
      lastOrigin = origin;
    });

    doc.applyMcpUpdate(delta);
    expect(lastOrigin).toBe(MCP_ORIGIN);
    expect(doc.get(created.id)).toBeDefined();
    expect(doc.canUndo()).toBe(true);

    doc.undo();
    expect(doc.get(created.id)).toBeUndefined();

    doc.redo();
    expect(doc.get(created.id)).toBeDefined();
  });

  it("validates bridge settings helpers", () => {
    const t1 = generatePairingToken();
    const t2 = generatePairingToken();
    expect(t1.length).toBeGreaterThanOrEqual(20);
    expect(t1).not.toBe(t2);
    expect(isValidBridgePort(4197)).toBe(true);
    expect(isValidBridgePort(0)).toBe(false);
    expect(isValidBridgePort(70000)).toBe(false);
    expect(bridgeWsUrl(4197)).toBe("ws://127.0.0.1:4197");
  });

  it("connects McpBridgeClient to BridgeServer and round-trips live BoardSession edits", async () => {
    const board = await boardRepository.create("Live Roundtrip");
    const session = await BoardSession.open(board.id);
    cleanups.push(() => session.close());

    const client = new McpBridgeClient();
    client.setActiveSession(session);
    const currentToken = client.getState().token;
    expect(currentToken.length).toBeGreaterThan(0);

    const matchedServer = new BridgeServer({ token: currentToken, port: 0 });
    const matchedPort = await matchedServer.start();
    cleanups.push(() => matchedServer.close());

    client.setPort(matchedPort);
    client.setEnabled(true);
    cleanups.push(() => client.setEnabled(false));

    // Wait for WebSocket handshake.
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error("Bridge did not connect in time")),
        3000,
      );
      const unsub = client.subscribe((s) => {
        if (s.status === "connected") {
          clearTimeout(deadline);
          unsub();
          resolve();
        }
      });
    });

    const backend = new LiveBridgeBackend({ bridge: matchedServer });
    const listed = await backend.listBoards();
    expect(listed.some((b) => b.id === board.id && b.isActive)).toBe(true);

    const added = await backend.addTextBox(board.id, {
      x: 120,
      y: 220,
      text: "Inserted over live bridge",
    });

    // Live BoardSession receives the object immediately and can undo it.
    const onCanvas = session.doc.get(added.id);
    expect(onCanvas).toMatchObject({
      type: "text",
      text: "Inserted over live bridge",
    });
    expect(session.doc.canUndo()).toBe(true);

    session.doc.undo();
    expect(session.doc.get(added.id)).toBeUndefined();
  });
});
