import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { isAllowedLocalOrigin, safeTokenEquals } from "../security.js";
import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeClientMessage,
  type BridgeMethod,
  type BridgeMethodMap,
  type BridgeRequestMessage,
  DEFAULT_BRIDGE_PORT,
} from "./protocol.js";

export interface BridgeServerOptions {
  token: string;
  port?: number;
  readOnly?: boolean;
  allowedOrigins?: string[];
  authTimeoutMs?: number;
}

interface ConnectedTab {
  tabId: string;
  ws: WebSocket;
  activeBoardId: string | null;
  lastSeenAt: number;
}

interface PendingRequest {
  tabId: string;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class BridgeServer {
  private readonly token: string;
  private readonly requestedPort: number;
  private readonly readOnly: boolean;
  private readonly allowedOrigins: string[];
  private readonly authTimeoutMs: number;

  private httpServer: Server | null = null;
  private wss: WebSocketServer | null = null;
  private tabs = new Map<string, ConnectedTab>();
  private pending = new Map<string, PendingRequest>();
  private _port: number | null = null;

  constructor(options: BridgeServerOptions) {
    if (!options.token || options.token.trim().length === 0) {
      throw new Error("A non-empty bridge session token is required.");
    }
    this.token = options.token;
    this.requestedPort = options.port ?? DEFAULT_BRIDGE_PORT;
    this.readOnly = Boolean(options.readOnly);
    this.allowedOrigins = options.allowedOrigins ?? [];
    this.authTimeoutMs = options.authTimeoutMs ?? 3000;
  }

  get port(): number {
    return this._port ?? this.requestedPort;
  }

  get connectedTabCount(): number {
    return this.tabs.size;
  }

  async start(): Promise<number> {
    if (this.httpServer) return this.port;

    const httpServer = createServer((_req, res) => {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Inkboard Local MCP Bridge (WebSocket only)");
    });

    const wss = new WebSocketServer({ noServer: true });

    httpServer.on(
      "upgrade",
      (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        if (!isAllowedLocalOrigin(req.headers.origin, this.allowedOrigins)) {
          socket.write(
            "HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n",
          );
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          this.handleConnection(ws);
        });
      },
    );

    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      // Strictly bind to loopback 127.0.0.1 so nothing is exposed on LAN.
      httpServer.listen(this.requestedPort, "127.0.0.1", () => {
        httpServer.off("error", reject);
        resolve();
      });
    });

    const addr = httpServer.address();
    this._port = typeof addr === "object" && addr
      ? addr.port
      : this.requestedPort;
    this.httpServer = httpServer;
    this.wss = wss;
    return this._port;
  }

  async close(): Promise<void> {
    for (const [id, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error("Local MCP bridge closed."));
      this.pending.delete(id);
    }
    for (const tab of this.tabs.values()) {
      tab.ws.close(1001, "Server shutting down");
    }
    this.tabs.clear();

    if (this.wss) {
      await new Promise<void>((resolve) => this.wss!.close(() => resolve()));
      this.wss = null;
    }
    if (this.httpServer) {
      await new Promise<void>((resolve) =>
        this.httpServer!.close(() => resolve())
      );
      this.httpServer = null;
    }
    this._port = null;
  }

  async request<M extends BridgeMethod>(
    method: M,
    params: BridgeMethodMap[M]["params"],
    options?: { boardId?: string; timeoutMs?: number; },
  ): Promise<BridgeMethodMap[M]["result"]> {
    const tab = this.selectTab(options?.boardId);
    const requestId = randomUUID();
    const timeoutMs = options?.timeoutMs ?? 15_000;

    const payload: BridgeRequestMessage<M> = {
      type: "request",
      requestId,
      method,
      params,
    };

    return new Promise<BridgeMethodMap[M]["result"]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new Error(
            `Bridge request "${method}" timed out after ${timeoutMs}ms.`,
          ),
        );
      }, timeoutMs);

      this.pending.set(requestId, {
        tabId: tab.tabId,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      tab.ws.send(JSON.stringify(payload), (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(requestId);
          reject(err);
        }
      });
    });
  }

  private selectTab(boardId?: string): ConnectedTab {
    const active: ConnectedTab[] = [];
    for (const tab of this.tabs.values()) {
      if (tab.ws.readyState === WebSocket.OPEN) {
        active.push(tab);
      }
    }
    if (active.length === 0) {
      throw new Error(
        `No Inkboard browser tab is connected to the local MCP bridge (127.0.0.1:${this.port}). Open Inkboard in your browser, open Board Menu -> Local MCP Bridge, enable it, and verify the pairing token.`,
      );
    }
    if (boardId) {
      const exact = active
        .filter((t) => t.activeBoardId === boardId)
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0];
      if (exact) return exact;
    }
    active.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    return active[0];
  }

  private handleConnection(ws: WebSocket): void {
    let authenticatedTabId: string | null = null;

    const authTimer = setTimeout(() => {
      if (!authenticatedTabId) {
        ws.close(4001, "Authentication timeout");
      }
    }, this.authTimeoutMs);

    ws.on("message", (raw) => {
      let msg: BridgeClientMessage;
      try {
        const text = typeof raw === "string"
          ? raw
          : Buffer.isBuffer(raw)
          ? raw.toString("utf8")
          : Buffer.from(raw as ArrayBuffer).toString("utf8");
        msg = JSON.parse(text) as BridgeClientMessage;
      } catch {
        ws.close(4000, "Invalid JSON");
        return;
      }

      if (!authenticatedTabId) {
        if (
          msg.type !== "hello"
          || msg.protocolVersion !== BRIDGE_PROTOCOL_VERSION
          || typeof msg.token !== "string"
          || typeof msg.tabId !== "string"
          || msg.tabId.length === 0
        ) {
          clearTimeout(authTimer);
          ws.close(4000, "Expected hello message");
          return;
        }
        if (!safeTokenEquals(this.token, msg.token)) {
          clearTimeout(authTimer);
          ws.close(4001, "Invalid pairing token");
          return;
        }
        clearTimeout(authTimer);
        authenticatedTabId = msg.tabId;
        const previous = this.tabs.get(authenticatedTabId);
        if (previous && previous.ws !== ws) {
          previous.ws.close(1000, "Replaced by newer connection");
        }
        this.tabs.set(authenticatedTabId, {
          tabId: authenticatedTabId,
          ws,
          activeBoardId: msg.activeBoardId ?? null,
          lastSeenAt: Date.now(),
        });
        ws.send(
          JSON.stringify({
            type: "hello_ack",
            protocolVersion: BRIDGE_PROTOCOL_VERSION,
            readOnly: this.readOnly,
          }),
        );
        return;
      }

      const tab = this.tabs.get(authenticatedTabId);
      if (tab) tab.lastSeenAt = Date.now();

      if (msg.type === "active_board_changed") {
        if (tab) tab.activeBoardId = msg.activeBoardId ?? null;
        return;
      }

      if (msg.type === "response") {
        const pending = this.pending.get(msg.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(msg.requestId);
        if (msg.ok) {
          pending.resolve(msg.result);
        } else {
          pending.reject(new Error(msg.error.message));
        }
      }
    });

    ws.on("close", () => {
      clearTimeout(authTimer);
      if (!authenticatedTabId) return;
      const current = this.tabs.get(authenticatedTabId);
      if (current?.ws === ws) {
        this.tabs.delete(authenticatedTabId);
      }
      for (const [reqId, req] of this.pending) {
        if (req.tabId === authenticatedTabId) {
          clearTimeout(req.timer);
          this.pending.delete(reqId);
          req.reject(
            new Error("Connected Inkboard browser tab disconnected."),
          );
        }
      }
    });

    ws.on("error", () => {
      // Handled via close event.
    });
  }
}
