import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addStrokeInputSchema,
  addTextBoxInputSchema,
  createBoardInputSchema,
  deleteObjectsInputSchema,
  queryObjectsInputSchema,
  updateTextBoxInputSchema,
} from "../schema.js";
import {
  enforceAssetSizeLimit,
  isAllowedLocalOrigin,
  resolveSandboxedPath,
  safeTokenEquals,
} from "../security.js";

describe("MCP Zod input validation", () => {
  it("validates add_text_box inputs and rejects out-of-range values", () => {
    expect(
      addTextBoxInputSchema.safeParse({
        boardId: "abc123",
        x: 10,
        y: 20,
        text: "Hello",
        fontFamily: "inter",
        fontSize: 24,
        width: 320,
        color: "#2b6de9",
        backgroundColor: "#fff9c4",
        textAlign: "center",
      }).success,
    ).toBe(true);

    expect(
      addTextBoxInputSchema.safeParse({
        boardId: "abc123",
        x: Number.NaN,
        y: 20,
        text: "Hello",
      }).success,
    ).toBe(false);

    expect(
      addTextBoxInputSchema.safeParse({
        boardId: "abc123",
        x: 0,
        y: 0,
        text: "Hello",
        color: "red",
      }).success,
    ).toBe(false);

    expect(
      addTextBoxInputSchema.safeParse({
        boardId: "abc123",
        x: 0,
        y: 0,
        text: "Hello",
        width: 20, // below MIN_TEXT_WIDTH (80)
      }).success,
    ).toBe(false);
  });

  it("validates update_text_box, add_stroke, query_objects, create_board, delete_objects", () => {
    expect(
      updateTextBoxInputSchema.safeParse({
        boardId: "b1",
        objectId: "o1",
        backgroundColor: "transparent",
      }).success,
    ).toBe(true);

    expect(
      addStrokeInputSchema.safeParse({
        boardId: "b1",
        points: [],
      }).success,
    ).toBe(false);

    expect(
      addStrokeInputSchema.safeParse({
        boardId: "b1",
        tool: "highlighter",
        width: 8,
        points: [{ x: 0, y: 0 }, { x: 100, y: 100, pressure: 0.7 }],
      }).success,
    ).toBe(true);

    expect(
      queryObjectsInputSchema.safeParse({
        boardId: "b1",
        bounds: { x: 0, y: 0, width: -10, height: 10 },
      }).success,
    ).toBe(false);

    expect(
      createBoardInputSchema.safeParse({ name: "Arch", background: "#1c1d21" })
        .success,
    ).toBe(true);

    expect(
      deleteObjectsInputSchema.safeParse({ boardId: "b1", objectIds: [] })
        .success,
    ).toBe(false);
  });
});

describe("Security helpers", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length) {
      await rm(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it("compares tokens in constant time", () => {
    expect(safeTokenEquals("secret-token", "secret-token")).toBe(true);
    expect(safeTokenEquals("secret-token", "secret-tokeN")).toBe(false);
    expect(safeTokenEquals("secret-token", "short")).toBe(false);
    expect(safeTokenEquals("", "")).toBe(false);
  });

  it("allows only loopback origins unless allowlisted", () => {
    expect(isAllowedLocalOrigin("http://localhost:5173")).toBe(true);
    expect(isAllowedLocalOrigin("http://127.0.0.1:4173")).toBe(true);
    expect(isAllowedLocalOrigin("https://[::1]:8443")).toBe(true);
    expect(isAllowedLocalOrigin(undefined)).toBe(true);

    expect(isAllowedLocalOrigin("https://evil.example")).toBe(false);
    expect(isAllowedLocalOrigin("http://localhost.evil.example:5173")).toBe(
      false,
    );
    expect(isAllowedLocalOrigin("not-a-url")).toBe(false);
    expect(
      isAllowedLocalOrigin("https://custom.local", ["https://custom.local"]),
    ).toBe(true);
  });

  it("sandboxes export and archive paths including symlinks", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inkboard-root-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "inkboard-out-"));
    tempDirs.push(root, outside);

    const valid = await resolveSandboxedPath(root, "exports/board.pdf");
    expect(valid).toBe(
      path.join(await realpathSafe(root), "exports/board.pdf"),
    );

    await expect(
      resolveSandboxedPath(root, "../outside.pdf"),
    ).rejects.toThrow(/escapes/);

    await expect(
      resolveSandboxedPath(root, "bad\0path.pdf"),
    ).rejects.toThrow(/null byte/);

    // Symlink pointing outside root must be rejected
    await writeFile(path.join(outside, "secret.txt"), "hi");
    const linkDir = path.join(root, "escape-link");
    await symlink(outside, linkDir);
    await expect(
      resolveSandboxedPath(root, "escape-link/out.pdf"),
    ).rejects.toThrow(/resolves outside/);
  });

  it("enforces asset byte size limits", () => {
    expect(() => enforceAssetSizeLimit(100, 1024)).not.toThrow();
    expect(() => enforceAssetSizeLimit(2048, 1024, "PDF")).toThrow(
      /exceeds the 1024-byte/,
    );
  });
});

async function realpathSafe(p: string): Promise<string> {
  const { realpath } = await import("node:fs/promises");
  return realpath(p);
}
