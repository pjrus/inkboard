import { useEffect, useState } from "react";
import { type BridgeUIState, mcpBridge } from "../bridge/McpBridgeClient";
import { DEFAULT_BRIDGE_PORT } from "../bridge/protocol";

interface Props {
  onClose: () => void;
}

export function McpBridgeDialog({ onClose }: Props) {
  const [state, setState] = useState<BridgeUIState>(() => mcpBridge.getState());
  const [portInput, setPortInput] = useState(() => String(state.port));
  const [readOnlySnippet, setReadOnlySnippet] = useState(false);
  const [copied, setCopied] = useState<"token" | "config" | null>(null);

  useEffect(() => {
    return mcpBridge.subscribe((next) => {
      setState(next);
      setPortInput(String(next.port));
    });
  }, []);

  const statusLabel = (() => {
    switch (state.status) {
      case "off":
        return "Disabled";
      case "connecting":
        return `Waiting for MCP server on 127.0.0.1:${state.port}…`;
      case "connected":
        return state.readOnly
          ? `Connected (read-only) · 127.0.0.1:${state.port}`
          : `Connected · 127.0.0.1:${state.port}`;
      case "auth_error":
        return "Pairing token mismatch";
      case "error":
        return state.lastError ?? "Connection error";
    }
  })();

  const args = ["inkboard-mcp", "--token", state.token];
  if (state.port !== DEFAULT_BRIDGE_PORT) {
    args.push("--port", String(state.port));
  }
  if (readOnlySnippet) {
    args.push("--read-only");
  }

  const configSnippet = JSON.stringify(
    {
      mcpServers: {
        inkboard: {
          command: "npx",
          args,
        },
      },
    },
    null,
    2,
  );

  const copyText = async (value: string, kind: "token" | "config") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1800);
    } catch {
      // Clipboard API unavailable in restricted contexts.
    }
  };

  const commitPort = () => {
    const parsed = Number(portInput);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
      mcpBridge.setPort(parsed);
    } else {
      setPortInput(String(state.port));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal mcp-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-bridge-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mcp-header">
          <h2 id="mcp-bridge-title">Local MCP Bridge</h2>
          <span
            className={`mcp-status mcp-status-${state.status}`}
            role="status"
          >
            <span className="mcp-status-dot" />
            {statusLabel}
          </span>
        </div>

        <p className="modal-meta">
          Connect local AI tools (Claude Desktop, Cursor, VS Code) to your live
          boards over loopback <code>127.0.0.1</code>.
        </p>

        <label className="mcp-toggle-row">
          <span>Enable Local MCP Bridge</span>
          <input
            type="checkbox"
            checked={state.enabled}
            onChange={(e) => mcpBridge.setEnabled(e.target.checked)}
          />
        </label>

        {state.lastError && state.status === "auth_error" && (
          <p className="modal-note modal-error" role="alert">
            {state.lastError}
          </p>
        )}

        <div className="mcp-field">
          <label htmlFor="mcp-token-input">Session pairing token</label>
          <div className="mcp-input-row">
            <input
              id="mcp-token-input"
              type="text"
              readOnly
              value={state.token}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void copyText(state.token, "token")}
            >
              {copied === "token" ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => mcpBridge.regenerateToken()}
            >
              Rotate
            </button>
          </div>
        </div>

        <div className="mcp-field">
          <label htmlFor="mcp-port-input">Loopback port (127.0.0.1)</label>
          <input
            id="mcp-port-input"
            type="number"
            min={1}
            max={65535}
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            onBlur={commitPort}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitPort();
            }}
          />
        </div>

        <div className="mcp-field">
          <div className="mcp-field-header">
            <span>MCP client configuration</span>
            <label className="mcp-readonly-check">
              <input
                type="checkbox"
                checked={readOnlySnippet}
                onChange={(e) => setReadOnlySnippet(e.target.checked)}
              />
              <span>--read-only</span>
            </label>
          </div>
          <pre className="mcp-code">{configSnippet}</pre>
          <div className="mcp-snippet-actions">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void copyText(configSnippet, "config")}
            >
              {copied === "config" ? "Copied JSON" : "Copy JSON"}
            </button>
          </div>
        </div>

        <p className="modal-note">
          Everything stays on this machine. Live AI edits run as Yjs CRDT
          transactions so Cmd/Ctrl+Z undoes them cleanly.
        </p>

        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-primary"
            autoFocus
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
