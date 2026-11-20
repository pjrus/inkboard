import { DEFAULT_BRIDGE_PORT } from "./protocol";

const STORAGE_KEY = "inkboard:mcp-bridge";

export interface BridgeSettings {
  enabled: boolean;
  port: number;
  token: string;
}

let memoryFallback: BridgeSettings | null = null;

export function generatePairingToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isValidBridgePort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function bridgeWsUrl(port: number): string {
  if (!isValidBridgePort(port)) {
    throw new Error(`Invalid bridge port: ${port}`);
  }
  return `ws://127.0.0.1:${port}`;
}

export function loadBridgeSettings(): BridgeSettings {
  const defaults = (): BridgeSettings => ({
    enabled: false,
    port: DEFAULT_BRIDGE_PORT,
    token: generatePairingToken(),
  });

  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<BridgeSettings>;
        const port = typeof parsed.port === "number"
            && isValidBridgePort(parsed.port)
          ? parsed.port
          : DEFAULT_BRIDGE_PORT;
        const token =
          typeof parsed.token === "string" && parsed.token.length > 0
            ? parsed.token
            : generatePairingToken();
        return {
          enabled: Boolean(parsed.enabled),
          port,
          token,
        };
      }
      const fresh = defaults();
      saveBridgeSettings(fresh);
      return fresh;
    }
  } catch {
    // Ignore storage errors (e.g. private browsing / restricted environments).
  }

  if (!memoryFallback) memoryFallback = defaults();
  return { ...memoryFallback };
}

export function saveBridgeSettings(settings: BridgeSettings): void {
  memoryFallback = { ...settings };
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
  } catch {
    // Ignore storage write failures.
  }
}
