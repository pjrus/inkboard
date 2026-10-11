import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { exportBoard, importBoard } from "../../boards/backup";
import { boardRepository } from "../../boards/BoardRepository";
import { CanvasDocument } from "../../document/crdt";
import { DocumentPersistence } from "../../document/persistence";
import { getDB, InkboardDB, setDB } from "../../storage/db";

let counter = 0;
beforeEach(() => {
  setDB(new InkboardDB(`test-backup-${Date.now()}-${counter++}`));
});

async function loadDoc(boardId: string) {
  const doc = new CanvasDocument();
  await new DocumentPersistence(boardId, doc).load();
  return doc;
}

describe("board backup", () => {
  it("restores strokes and assets as a new board, even beside the original", async () => {
    const board = await boardRepository.create("Notes");
    const doc = new CanvasDocument();
    const p = new DocumentPersistence(board.id, doc);
    await p.load();
    p.start();
    doc.addStroke({
      tool: "pen",
      color: "#000",
      width: 3,
      points: [0, 0, 0.5, 1, 1, 0.5],
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    });
    doc.addPDFDocument(
      {
        id: "pdf1",
        fileName: "a.pdf",
        pageCount: 1,
        layout: "vertical",
        sourceAssetId: "pdf1-src",
        createdAt: 1,
      },
      [{
        id: "page1",
        type: "image",
        assetId: "pdf1-p1",
        pdfDocumentId: "pdf1",
        pageIndex: 0,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
        createdAt: 1,
      } as never],
    );
    await p.destroy();
    for (const id of ["pdf1-p1", "pdf1-src"]) {
      const blob = new Blob([id], { type: "image/jpeg" });
      await getDB().assets.add({
        id,
        boardId: board.id,
        mimeType: "image/jpeg",
        blob,
        size: blob.size,
        createdAt: 1,
      });
    }

    const file = await exportBoard(board.id);
    const restored = await importBoard(file);

    expect(restored.id).not.toBe(board.id);
    expect(restored.name).toBe("Notes");
    const copy = await loadDoc(restored.id);
    expect(copy.getAll()).toHaveLength(2);
    const page = copy.getAll().find((o) => o.type === "image") as any;
    expect(page.assetId).not.toBe("pdf1-p1");
    const asset = await getDB().assets.get(page.assetId);
    expect(asset?.boardId).toBe(restored.id);
    expect(await asset!.blob.text()).toBe("pdf1-p1");
    const source = copy.getPDFDocument("pdf1")!.sourceAssetId!;
    expect(await (await getDB().assets.get(source))!.blob.text()).toBe(
      "pdf1-src",
    );
    // The original board keeps its own assets.
    expect((await getDB().assets.get("pdf1-p1"))?.boardId).toBe(board.id);
  });

  it("rejects files that are not backups or are truncated", async () => {
    await expect(importBoard(new Blob(["nope nope nope"]))).rejects.toThrow(
      "Not an Inkboard backup",
    );
    const board = await boardRepository.create("x");
    const file = await exportBoard(board.id);
    await expect(importBoard(file.slice(0, 20))).rejects.toThrow();
  });
});
