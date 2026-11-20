import { timingSafeEqual } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_MAX_ASSET_BYTES = 4 * 1024 * 1024; // 4 MiB

/**
 * Constant-time token comparison to avoid timing side channels.
 */
export function safeTokenEquals(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verify that a WebSocket `Origin` header comes from loopback (`localhost`,
 * `127.0.0.1`, `[::1]`) or an explicitly allowlisted origin.
 */
export function isAllowedLocalOrigin(
  originHeader: string | undefined,
  extraAllowedOrigins: string[] = [],
): boolean {
  if (!originHeader) {
    // Non-browser clients (e.g. Node tests) omit Origin; token auth still applies.
    return true;
  }
  if (extraAllowedOrigins.includes(originHeader)) {
    return true;
  }
  let parsed: URL;
  try {
    parsed = new URL(originHeader);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/**
 * Resolve `targetPath` strictly inside `rootDir`, checking symlinks on the
 * resolved root and existing parent directory to prevent path traversal.
 */
export async function resolveSandboxedPath(
  rootDir: string,
  targetPath: string,
): Promise<string> {
  if (!rootDir) {
    throw new Error("No sandboxed root directory is configured.");
  }
  if (targetPath.includes("\0")) {
    throw new Error("Invalid path: null byte is not allowed.");
  }
  const resolvedRoot = await realpath(path.resolve(rootDir));
  const candidate = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(resolvedRoot, targetPath);

  if (!isWithinDirectory(resolvedRoot, candidate)) {
    throw new Error(
      `Path "${targetPath}" escapes configured directory "${resolvedRoot}".`,
    );
  }

  // Also check realpath of nearest existing ancestor to block symlink escapes.
  const parentDir = path.dirname(candidate);
  try {
    const realParent = await realpath(parentDir);
    if (!isWithinDirectory(resolvedRoot, realParent)) {
      throw new Error(
        `Path "${targetPath}" resolves outside configured directory "${resolvedRoot}".`,
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  return candidate;
}

function isWithinDirectory(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function enforceAssetSizeLimit(
  byteLength: number,
  maxBytes = DEFAULT_MAX_ASSET_BYTES,
  label = "Asset payload",
): void {
  if (byteLength > maxBytes) {
    throw new Error(
      `${label} (${byteLength} bytes) exceeds the ${maxBytes}-byte MCP payload limit. Save to a file with outputPath instead.`,
    );
  }
}
