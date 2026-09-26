import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { backupBoards, restoreBoards } from "../../boards/backup";
import { boardRepository } from "../../boards/BoardRepository";
import { CanvasDocument } from "../../document/crdt";
import { DocumentPersistence } from "../../document/persistence";
import type { ImageObject } from "../../document/schema";
import { getDB, InkboardDB, setDB } from "../../storage/db";

let counter = 0;
beforeEach(() => {
  setDB(new InkboardDB(`backup-${Date.now()}-${counter++}`));
});

const bytes = (...b: number[]) => new Blob([new Uint8Array(b)]);

async function putAsset(boardId: string, id: string, blob: Blob) {
  await getDB().assets.put({
    id,
    boardId,
    mimeType: "image/jpeg",
    blob,
    size: blob.size,
    createdAt: 1,
  });
}

async function openDoc(boardId: string) {
  const doc = new CanvasDocument();
  await new DocumentPersistence(boardId, doc).load();
  return doc;
}

/** A board with an imported one-page PDF, its source file and an orphan. */
async function seedBoard() {
  const board = await boardRepository.create("Lecture 3");
  await putAsset(board.id, "doc-p1", bytes(1, 2, 3));
  await putAsset(board.id, "doc-src", bytes(9, 9));
  await putAsset(board.id, "orphan", bytes(7));
  const doc = new CanvasDocument();
  const persistence = new DocumentPersistence(board.id, doc);
  persistence.start();
  doc.addPDFDocument(
    {
      id: "doc",
      fileName: "a.pdf",
      pageCount: 1,
      layout: "vertical",
      sourceAssetId: "doc-src",
      createdAt: 1,
    },
    [
      {
        id: "p1",
        type: "image",
        assetId: "doc-p1",
        pdfDocumentId: "doc",
        pageNumber: 1,
        x: 0,
        y: 0,
        width: 612,
        height: 792,
        rotation: 0,
        createdAt: 1,
      },
    ],
  );
  await persistence.destroy();
  return board;
}

describe("backup", () => {
  it("restores every board as a copy with its own assets", async () => {
    const original = await seedBoard();
    const file = await backupBoards();

    expect(await restoreBoards(file)).toBe(1);

    const restored = (await boardRepository.list()).find(
      (b) => b.id !== original.id,
    )!;
    expect(restored.name).toBe("Lecture 3");
    const doc = await openDoc(restored.id);
    const page = doc.get("p1") as ImageObject;
    const src = doc.getPDFDocument("doc")!.sourceAssetId!;
    expect(page.assetId).not.toBe("doc-p1");
    expect(src).not.toBe("doc-src");

    const db = getDB();
    const assets = await db.assets
      .where("boardId")
      .equals(restored.id)
      .toArray();
    // The orphan was not referenced, so it was not backed up.
    expect(assets.map((a) => a.id).sort()).toEqual([page.assetId, src].sort());
    const pageAsset = await db.assets.get(page.assetId);
    expect([...new Uint8Array(await pageAsset!.blob.arrayBuffer())]).toEqual([
      1,
      2,
      3,
    ]);
    // The original board still owns its assets.
    expect((await db.assets.get("doc-p1"))!.boardId).toBe(original.id);
  });

  it("rejects files that are not complete backups, writing nothing", async () => {
    await seedBoard();
    const file = await backupBoards();
    const before = await getDB().boards.count();

    await expect(restoreBoards(bytes(1, 2, 3))).rejects.toThrow();
    await expect(
      restoreBoards(file.slice(0, file.size - 1)),
    ).rejects.toThrow("incomplete");
    expect(await getDB().boards.count()).toBe(before);
  });
});
