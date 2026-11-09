import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  importImage,
  isImageFile,
  MAX_INITIAL_WORLD_SIZE,
} from "../../canvas/imageImport";
import { CanvasDocument } from "../../document/crdt";
import type { ImageObject } from "../../document/schema";
import { getDB, InkboardDB, setDB } from "../../storage/db";

let counter = 0;
beforeEach(() => {
  setDB(new InkboardDB(`image-import-${Date.now()}-${counter++}`));
});

describe("isImageFile", () => {
  it("identifies image files by mime type", () => {
    expect(isImageFile(new Blob([], { type: "image/png" }))).toBe(true);
    expect(isImageFile(new Blob([], { type: "image/jpeg" }))).toBe(true);
    expect(isImageFile(new Blob([], { type: "image/webp" }))).toBe(true);
    expect(isImageFile(new Blob([], { type: "application/pdf" }))).toBe(false);
    expect(isImageFile(new Blob([], { type: "text/plain" }))).toBe(false);
  });

  it("identifies image files by extension when type is empty", () => {
    expect(isImageFile(new File([], "photo.jpg"))).toBe(true);
    expect(isImageFile(new File([], "screenshot.PNG"))).toBe(true);
    expect(isImageFile(new File([], "drawing.svg"))).toBe(true);
    expect(isImageFile(new File([], "document.pdf"))).toBe(false);
    expect(isImageFile(new File([], "notes.txt"))).toBe(false);
  });
});

describe("importImage", () => {
  it("creates an asset record and an ImageObject on the document", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({
      width: 400,
      height: 300,
      close: () => {},
    }));

    const doc = new CanvasDocument();
    const readyAssets: string[] = [];
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], {
      type: "image/png",
    });

    const img = await importImage({
      boardId: "board-1",
      doc,
      fileOrBlob: blob,
      targetCenter: { x: 100, y: 200 },
      onAssetReady: (id) => readyAssets.push(id),
    });

    expect(img.type).toBe("image");
    expect(img.width).toBe(400);
    expect(img.height).toBe(300);
    expect(img.x).toBe(100 - 200); // centered at 100
    expect(img.y).toBe(200 - 150); // centered at 200
    expect(readyAssets).toEqual([img.assetId]);

    // Check CRDT
    const retrieved = doc.get(img.id) as ImageObject;
    expect(retrieved).toBeDefined();
    expect(retrieved.assetId).toBe(img.assetId);

    // Check IndexedDB
    const asset = await getDB().assets.get(img.assetId);
    expect(asset).toBeDefined();
    expect(asset?.boardId).toBe("board-1");
    expect(asset?.mimeType).toBe("image/png");

    vi.unstubAllGlobals();
  });

  it("scales down large images to MAX_INITIAL_WORLD_SIZE keeping aspect ratio", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({
      width: 2000,
      height: 1000,
      close: () => {},
    }));

    const doc = new CanvasDocument();
    const blob = new Blob([new Uint8Array([1, 2])], { type: "image/jpeg" });

    const img = await importImage({
      boardId: "board-1",
      doc,
      fileOrBlob: blob,
      targetCenter: { x: 0, y: 0 },
    });

    expect(img.width).toBe(MAX_INITIAL_WORLD_SIZE);
    expect(img.height).toBe(MAX_INITIAL_WORLD_SIZE / 2);
    expect(img.x).toBe(-MAX_INITIAL_WORLD_SIZE / 2);
    expect(img.y).toBe(-MAX_INITIAL_WORLD_SIZE / 4);

    vi.unstubAllGlobals();
  });

  it("is undoable and redoable", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({
      width: 200,
      height: 200,
      close: () => {},
    }));

    const doc = new CanvasDocument();
    const blob = new Blob([new Uint8Array([1])], { type: "image/png" });

    const img = await importImage({
      boardId: "board-1",
      doc,
      fileOrBlob: blob,
      targetCenter: { x: 50, y: 50 },
    });

    expect(doc.get(img.id)).toBeDefined();

    doc.undo();
    expect(doc.get(img.id)).toBeUndefined();

    doc.redo();
    expect(doc.get(img.id)).toBeDefined();

    vi.unstubAllGlobals();
  });
});
