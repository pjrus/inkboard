import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { boardRepository } from "../../boards/BoardRepository";
import { copyToClipboard, pasteClipboard } from "../../boards/clipboard";
import { CanvasDocument } from "../../document/crdt";
import type { CanvasObject, ImageObject } from "../../document/schema";
import { getDB, InkboardDB, setDB } from "../../storage/db";

let counter = 0;
beforeEach(() => {
  setDB(new InkboardDB(`clip-${Date.now()}-${counter++}`));
});

/** A board holding one imported PDF page and its asset. */
async function boardWithPage() {
  const board = await boardRepository.create("Source");
  await getDB().assets.put({
    id: "doc-p1",
    boardId: board.id,
    mimeType: "image/jpeg",
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }),
    size: 3,
    createdAt: 1,
  });
  const doc = new CanvasDocument();
  doc.addPDFDocument(
    {
      id: "doc",
      fileName: "a.pdf",
      pageCount: 1,
      layout: "vertical",
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
  return { board, doc };
}

const insertInto = (doc: CanvasDocument) => (objs: CanvasObject[]) =>
  doc.cloneObjects(objs, 10, 10).map((id) => doc.get(id)!);

describe("clipboard", () => {
  it("pastes a PDF page into another board as an image with its own asset", async () => {
    const { board: src, doc: srcDoc } = await boardWithPage();
    const dst = await boardRepository.create("Destination");
    const dstDoc = new CanvasDocument();

    copyToClipboard(src.id, [srcDoc.get("p1")!]);
    // The source board goes away between copy and paste.
    await boardRepository.delete(src.id);
    await pasteClipboard(dst.id, insertInto(dstDoc));

    const [img] = dstDoc.getAll() as ImageObject[];
    expect(img.type).toBe("image");
    expect(img.pdfDocumentId).toBeUndefined();
    expect(img.assetId).not.toBe("doc-p1");
    const asset = await getDB().assets.get(img.assetId);
    expect(asset?.boardId).toBe(dst.id);
    expect(new Uint8Array(await asset!.blob.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("reuses the board's own asset when pasting within the same board", async () => {
    const { board, doc } = await boardWithPage();
    copyToClipboard(board.id, [doc.get("p1")!]);
    await pasteClipboard(board.id, insertInto(doc));
    await pasteClipboard(board.id, insertInto(doc));

    const copies = doc.getAll().filter((o) => o.id !== "p1") as ImageObject[];
    expect(copies.map((c) => c.assetId)).toEqual(["doc-p1", "doc-p1"]);
    // Repeated pastes cascade instead of stacking.
    expect(copies.map((c) => c.x).sort()).toEqual([10, 20]);
    expect(await getDB().assets.count()).toBe(1);
  });
});
