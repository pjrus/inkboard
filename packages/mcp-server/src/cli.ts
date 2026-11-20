#!/usr/bin/env node
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "node:http";
import { InkboardFileBackend } from "./backend/InkboardFileBackend.js";
import { LiveBridgeBackend } from "./backend/LiveBridgeBackend.js";
import { BridgeServer } from "./bridge/BridgeServer.js";
import { DEFAULT_BRIDGE_PORT } from "./bridge/protocol.js";
import { DEFAULT_MAX_ASSET_BYTES } from "./security.js";
import {
  createInkboardHttpHandler,
  createInkboardMcpServer,
} from "./server.js";

interface CliArgs {
  token?: string;
  port: number;
  httpPort?: number;
  readOnly: boolean;
  exportDir?: string;
  inkboardDir?: string;
  inkboardFile?: string;
  allowedOrigins: string[];
  maxAssetBytes: number;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    token: process.env.INKBOARD_MCP_TOKEN,
    port: process.env.INKBOARD_MCP_PORT
      ? Number(process.env.INKBOARD_MCP_PORT)
      : DEFAULT_BRIDGE_PORT,
    httpPort: process.env.INKBOARD_MCP_HTTP_PORT
      ? Number(process.env.INKBOARD_MCP_HTTP_PORT)
      : undefined,
    readOnly: false,
    exportDir: process.env.INKBOARD_EXPORT_DIR,
    inkboardDir: process.env.INKBOARD_DIR,
    inkboardFile: process.env.INKBOARD_FILE,
    allowedOrigins: [],
    maxAssetBytes: DEFAULT_MAX_ASSET_BYTES,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) {
        throw new Error(`Missing value for ${flag}`);
      }
      return argv[++i];
    };
    switch (flag) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--token":
        args.token = next();
        break;
      case "--port":
        args.port = Number(next());
        break;
      case "--http-port":
        args.httpPort = Number(next());
        break;
      case "--read-only":
        args.readOnly = true;
        break;
      case "--export-dir":
        args.exportDir = next();
        break;
      case "--inkboard-dir":
        args.inkboardDir = next();
        break;
      case "--inkboard-file":
        args.inkboardFile = next();
        break;
      case "--allow-origin":
        args.allowedOrigins.push(next());
        break;
      case "--max-asset-bytes":
        args.maxAssetBytes = Number(next());
        break;
      default:
        if (flag.startsWith("-")) {
          throw new Error(`Unknown option: ${flag}`);
        }
    }
  }

  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
    throw new Error(`Invalid port: ${args.port}`);
  }
  if (
    args.httpPort !== undefined
    && (!Number.isInteger(args.httpPort) || args.httpPort < 0
      || args.httpPort > 65535)
  ) {
    throw new Error(`Invalid --http-port: ${args.httpPort}`);
  }
  if (!Number.isFinite(args.maxAssetBytes) || args.maxAssetBytes <= 0) {
    throw new Error(`Invalid --max-asset-bytes: ${args.maxAssetBytes}`);
  }
  return args;
}

function printHelp(): void {
  console.error(`Usage: inkboard-mcp [options]

Options:
  --token <token>             Session pairing token from Inkboard browser app
                              (or set INKBOARD_MCP_TOKEN). Required for live bridge.
  --port <port>               Loopback WebSocket bridge port (default: ${DEFAULT_BRIDGE_PORT})
  --http-port <port>          Serve stateless MCP v2 Streamable HTTP on 127.0.0.1:<port>
                              instead of stdio
  --read-only                 Disable all write/mutation tools
  --export-dir <dir>          Sandboxed directory where export_board_pdf may write files
  --inkboard-dir <dir>        Offline mode: read/write .inkboard backups in <dir>
  --inkboard-file <file>      Offline mode: read/write a single .inkboard backup file
  --allow-origin <origin>     Additional allowed WebSocket Origin header
  --max-asset-bytes <bytes>   Max base64 asset payload size (default: ${DEFAULT_MAX_ASSET_BYTES})
  -h, --help                  Show this help message
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  let bridge: BridgeServer | null = null;
  let backend;

  if (args.inkboardFile || args.inkboardDir) {
    if (args.inkboardFile && args.inkboardDir) {
      throw new Error(
        "Pass either --inkboard-file or --inkboard-dir, not both.",
      );
    }
    backend = new InkboardFileBackend({
      rootPath: (args.inkboardFile ?? args.inkboardDir)!,
      isFile: Boolean(args.inkboardFile),
      readOnly: args.readOnly,
    });
    console.error(
      `[inkboard-mcp] Offline .inkboard backend ready (${
        args.inkboardFile ?? args.inkboardDir
      })${args.readOnly ? " [read-only]" : ""}`,
    );
  } else {
    if (!args.token) {
      throw new Error(
        "Missing --token <SESSION_TOKEN> (or INKBOARD_MCP_TOKEN). Copy the pairing token from Inkboard's Local MCP Bridge settings, or use --inkboard-dir / --inkboard-file for offline mode.",
      );
    }
    bridge = new BridgeServer({
      token: args.token,
      port: args.port,
      readOnly: args.readOnly,
      allowedOrigins: args.allowedOrigins,
    });
    const boundPort = await bridge.start();
    console.error(
      `[inkboard-mcp] Local live bridge listening on ws://127.0.0.1:${boundPort}${
        args.readOnly ? " [read-only]" : ""
      }`,
    );
    backend = new LiveBridgeBackend({
      bridge,
      readOnly: args.readOnly,
      exportDir: args.exportDir,
      maxAssetBytes: args.maxAssetBytes,
    });
  }

  let shutdown: () => Promise<void>;

  if (args.httpPort !== undefined) {
    const mcpHandler = createInkboardHttpHandler({
      backend,
      readOnly: args.readOnly,
    });
    const nodeHandler = toNodeHandler(mcpHandler);
    const validateHost = localhostHostValidation();
    const validateOrigin = localhostOriginValidation();
    const httpServer = createServer((req, res) => {
      if (!validateHost(req, res) || !validateOrigin(req, res)) return;
      const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      if (pathname !== "/mcp") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      void nodeHandler(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(args.httpPort, "127.0.0.1", () => {
        httpServer.off("error", reject);
        resolve();
      });
    });
    const addr = httpServer.address();
    const boundHttpPort = typeof addr === "object" && addr
      ? addr.port
      : args.httpPort;
    console.error(
      `[inkboard-mcp] Stateless MCP v2 HTTP endpoint listening on http://127.0.0.1:${boundHttpPort}/mcp`,
    );
    shutdown = async () => {
      try {
        await mcpHandler.close();
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        await bridge?.close();
      } finally {
        process.exit(0);
      }
    };
  } else {
    const handle = serveStdio(
      () => createInkboardMcpServer({ backend, readOnly: args.readOnly }),
      { legacy: "reject" },
    );
    shutdown = async () => {
      try {
        await handle.close();
        await bridge?.close();
      } finally {
        process.exit(0);
      }
    };
  }

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error(
    `[inkboard-mcp] Fatal error: ${
      err instanceof Error ? err.message : String(err)
    }`,
  );
  process.exit(1);
});
