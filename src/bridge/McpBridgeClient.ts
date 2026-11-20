import * as Y from "yjs";
import { boardRepository } from "../boards/BoardRepository";
import type { BoardSession } from "../boards/BoardSession";
import { CanvasDocument } from "../document/crdt";
import { newId } from "../document/ids";
import { DocumentPersistence } from "../document/persistence";
import { getDB } from "../storage/db";
import {
  bridgeWsUrl,
  generatePairingToken,
  isValidBridgePort,
  loadBridgeSettings,
  saveBridgeSettings,
} from "./bridgeSettings";
import { bytesToBase64, renderBoardPreview } from "./previewRenderer";
import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeBoardMeta,
  type BridgeMethod,
  type BridgeMethodMap,
  type BridgeRequestMessage,
  type BridgeResponseMessage,
  type BridgeServerMessage,
} from "./protocol";

export type BridgeConnectionStatus =
  | "off"
  | "connecting"
  | "connected"
  | "auth_error"
  | "error";

export interface BridgeUIState {
  enabled: boolean;
  port: number;
  token: string;
  status: BridgeConnectionStatus;
  readOnly: boolean;
  lastError: string | null;
}

export type BridgeStateListener = (state: BridgeUIState) => void;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export class McpBridgeClient {
  private readonly tabId = newId(10);
  private settings = loadBridgeSettings();
  private status: BridgeConnectionStatus = "off";
  private readOnly = false;
  private lastError: string | null = null;
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private activeSession: BoardSession | null = null;

  private listeners = new Set<BridgeStateListener>();
  private boardsChangedListeners = new Set<() => void>();

  constructor() {
    if (this.settings.enabled && typeof WebSocket !== "undefined") {
      this.connect();
    }
  }

  getState(): BridgeUIState {
    return {
      enabled: this.settings.enabled,
      port: this.settings.port,
      token: this.settings.token,
      status: this.status,
      readOnly: this.readOnly,
      lastError: this.lastError,
    };
  }

  subscribe(listener: BridgeStateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  onBoardsChanged(listener: () => void): () => void {
    this.boardsChangedListeners.add(listener);
    return () => this.boardsChangedListeners.delete(listener);
  }

  setEnabled(enabled: boolean): void {
    if (this.settings.enabled === enabled) return;
    this.settings = { ...this.settings, enabled };
    saveBridgeSettings(this.settings);
    this.reconnectAttempt = 0;
    if (enabled) {
      this.lastError = null;
      this.connect();
    } else {
      this.disconnect();
    }
    this.emit();
  }

  setPort(port: number): void {
    if (!isValidBridgePort(port) || port === this.settings.port) return;
    this.settings = { ...this.settings, port };
    saveBridgeSettings(this.settings);
    this.reconnectAttempt = 0;
    if (this.settings.enabled) {
      this.disconnect(false);
      this.connect();
    }
    this.emit();
  }

  regenerateToken(): string {
    const token = generatePairingToken();
    this.settings = { ...this.settings, token };
    saveBridgeSettings(this.settings);
    this.reconnectAttempt = 0;
    if (this.settings.enabled) {
      this.disconnect(false);
      this.connect();
    }
    this.emit();
    return token;
  }

  setActiveSession(session: BoardSession | null): void {
    if (this.activeSession === session) return;
    this.activeSession = session;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendJson({
        type: "active_board_changed",
        activeBoardId: session?.board.id ?? null,
      });
    }
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const l of this.listeners) l(snapshot);
  }

  private notifyBoardsChanged(): void {
    for (const l of this.boardsChangedListeners) l();
  }

  private disconnect(setStatusOff = true): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const old = this.ws;
      this.ws = null;
      old.onopen = null;
      old.onmessage = null;
      old.onerror = null;
      old.onclose = null;
      old.close(1000, "Disabled");
    }
    this.readOnly = false;
    if (setStatusOff) {
      this.status = "off";
      this.lastError = null;
    }
  }

  private connect(): void {
    if (!this.settings.enabled || typeof WebSocket === "undefined") return;
    if (this.ws) return;

    this.status = "connecting";
    this.emit();

    let ws: WebSocket;
    try {
      ws = new WebSocket(bridgeWsUrl(this.settings.port));
    } catch (err) {
      this.status = "error";
      this.lastError = err instanceof Error ? err.message : String(err);
      this.emit();
      this.scheduleReconnect();
      return;
    }

    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.sendJson({
        type: "hello",
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        token: this.settings.token,
        tabId: this.tabId,
        activeBoardId: this.activeSession?.board.id ?? null,
      });
    };

    ws.onmessage = (ev) => {
      if (this.ws !== ws || typeof ev.data !== "string") return;
      let msg: BridgeServerMessage;
      try {
        msg = JSON.parse(ev.data) as BridgeServerMessage;
      } catch {
        return;
      }
      if (msg.type === "hello_ack") {
        this.status = "connected";
        this.readOnly = Boolean(msg.readOnly);
        this.lastError = null;
        this.reconnectAttempt = 0;
        this.emit();
        return;
      }
      if (msg.type === "request") {
        void this.handleRequest(ws, msg);
      }
    };

    ws.onerror = () => {
      // Details arrive on close.
    };

    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.readOnly = false;
      if (!this.settings.enabled) {
        this.status = "off";
        this.lastError = null;
        this.emit();
        return;
      }
      if (ev.code === 4001) {
        this.status = "auth_error";
        this.lastError = ev.reason || "Pairing token rejected by MCP server.";
      } else {
        this.status = "connecting";
        this.lastError = null;
      }
      this.emit();
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (!this.settings.enabled || this.reconnectTimer) return;
    const delayMs = Math.min(5000, 1500 + this.reconnectAttempt * 500);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private sendJson(payload: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private async handleRequest<M extends BridgeMethod>(
    ws: WebSocket,
    req: BridgeRequestMessage<M>,
  ): Promise<void> {
    let response: BridgeResponseMessage<M>;
    try {
      const result = await this.dispatch(req.method, req.params);
      response = {
        type: "response",
        requestId: req.requestId,
        ok: true,
        result,
      };
    } catch (err) {
      response = {
        type: "response",
        requestId: req.requestId,
        ok: false,
        error: {
          code: "BRIDGE_ERROR",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
    if (this.ws === ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
    }
  }

  private async dispatch<M extends BridgeMethod>(
    method: M,
    params: BridgeMethodMap[M]["params"],
  ): Promise<BridgeMethodMap[M]["result"]> {
    switch (method) {
      case "list_boards": {
        const records = await boardRepository.list();
        const boards: BridgeBoardMeta[] = [];
        for (const rec of records) {
          const isActive = this.activeSession?.board.id === rec.id;
          if (isActive && this.activeSession) {
            boards.push({
              id: rec.id,
              name: this.activeSession.board.name,
              createdAt: rec.createdAt,
              updatedAt: rec.updatedAt,
              isActive: true,
              background: this.activeSession.doc.getBackground(),
              objectCounts: this.activeSession.doc.getObjectCounts(),
            });
          } else if (
            rec.background !== undefined && rec.objectCounts !== undefined
          ) {
            boards.push({
              id: rec.id,
              name: rec.name,
              createdAt: rec.createdAt,
              updatedAt: rec.updatedAt,
              isActive: false,
              background: rec.background,
              objectCounts: rec.objectCounts,
            });
          } else {
            const doc = new CanvasDocument();
            try {
              await new DocumentPersistence(rec.id, doc).load();
              doc.ensureBackground();
              const background = doc.getBackground();
              const objectCounts = doc.getObjectCounts();
              await getDB().boards.update(rec.id, { background, objectCounts });
              boards.push({
                id: rec.id,
                name: rec.name,
                createdAt: rec.createdAt,
                updatedAt: rec.updatedAt,
                isActive: false,
                background,
                objectCounts,
              });
            } finally {
              doc.destroy();
            }
          }
        }
        return { boards } as BridgeMethodMap[M]["result"];
      }

      case "get_board_state": {
        const { boardId } =
          params as BridgeMethodMap["get_board_state"]["params"];
        const { board, doc, dispose } = await this.openBoardDoc(boardId);
        try {
          return {
            board: {
              id: board.id,
              name: board.name,
              createdAt: board.createdAt,
              updatedAt: board.updatedAt,
              isActive: this.activeSession?.board.id === board.id,
            },
            stateUpdateBase64: bytesToBase64(Y.encodeStateAsUpdate(doc.ydoc)),
          } as BridgeMethodMap[M]["result"];
        } finally {
          dispose();
        }
      }

      case "create_board": {
        const { name, background } =
          params as BridgeMethodMap["create_board"]["params"];
        const board = await boardRepository.create(
          name?.trim() || "Untitled board",
        );
        const doc = new CanvasDocument();
        const persistence = new DocumentPersistence(board.id, doc);
        try {
          await persistence.load();
          persistence.start();
          if (background) doc.setBackground(background);
          else doc.ensureBackground();
          await persistence.flush();
          const result: BridgeBoardMeta = {
            id: board.id,
            name: board.name,
            createdAt: board.createdAt,
            updatedAt: board.updatedAt,
            isActive: false,
            background: doc.getBackground(),
            objectCounts: doc.getObjectCounts(),
          };
          this.notifyBoardsChanged();
          return { board: result } as BridgeMethodMap[M]["result"];
        } finally {
          await persistence.destroy();
          doc.destroy();
        }
      }

      case "apply_yjs_update": {
        const { boardId, updateBase64 } =
          params as BridgeMethodMap["apply_yjs_update"]["params"];
        const update = base64ToBytes(updateBase64);
        if (this.activeSession?.board.id === boardId) {
          this.activeSession.doc.applyMcpUpdate(update);
          const updatedAt = Date.now();
          this.activeSession.board.updatedAt = updatedAt;
          return {
            stateUpdateBase64: bytesToBase64(
              Y.encodeStateAsUpdate(this.activeSession.doc.ydoc),
            ),
            updatedAt,
          } as BridgeMethodMap[M]["result"];
        }

        const board = await boardRepository.get(boardId);
        if (!board) throw new Error(`Board "${boardId}" not found.`);
        const doc = new CanvasDocument();
        const persistence = new DocumentPersistence(boardId, doc);
        try {
          await persistence.load();
          persistence.start();
          doc.applyMcpUpdate(update);
          await persistence.flush();
          const updatedAt = Date.now();
          await getDB().boards.update(boardId, {
            updatedAt,
            background: doc.getBackground(),
            objectCounts: doc.getObjectCounts(),
          });
          this.notifyBoardsChanged();
          return {
            stateUpdateBase64: bytesToBase64(Y.encodeStateAsUpdate(doc.ydoc)),
            updatedAt,
          } as BridgeMethodMap[M]["result"];
        } finally {
          await persistence.destroy();
          doc.destroy();
        }
      }

      case "export_board_pdf": {
        const { boardId } =
          params as BridgeMethodMap["export_board_pdf"]["params"];
        const { board, doc, dispose } = await this.openBoardDoc(boardId);
        try {
          const { exportToPDF } = await import("../export/PDFExporter");
          const result = await exportToPDF({
            objects: doc.getAll(),
            boardName: board.name,
            background: doc.getBackground(),
          });
          return {
            bytesBase64: bytesToBase64(result.bytes),
            fileName: result.fileName,
            pageCount: result.pageCount,
          } as BridgeMethodMap[M]["result"];
        } finally {
          dispose();
        }
      }

      case "export_board_preview": {
        const { boardId, maxDimension } =
          params as BridgeMethodMap["export_board_preview"]["params"];
        const { doc, dispose } = await this.openBoardDoc(boardId);
        try {
          const preview = await renderBoardPreview(doc, maxDimension);
          return preview as BridgeMethodMap[M]["result"];
        } finally {
          dispose();
        }
      }
    }
  }

  private async openBoardDoc(boardId: string): Promise<{
    board: { id: string; name: string; createdAt: number; updatedAt: number; };
    doc: CanvasDocument;
    dispose: () => void;
  }> {
    if (this.activeSession?.board.id === boardId) {
      return {
        board: this.activeSession.board,
        doc: this.activeSession.doc,
        dispose: () => {},
      };
    }
    const board = await boardRepository.get(boardId);
    if (!board) throw new Error(`Board "${boardId}" not found.`);
    const doc = new CanvasDocument();
    await new DocumentPersistence(boardId, doc).load();
    doc.ensureBackground();
    return {
      board,
      doc,
      dispose: () => doc.destroy(),
    };
  }
}

export const mcpBridge = new McpBridgeClient();
