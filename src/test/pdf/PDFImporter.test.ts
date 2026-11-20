import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasDocument } from "../../document/crdt";
import { importPDF, type InspectedPDF } from "../../pdf/PDFImporter";
import { getDB, InkboardDB, setDB } from "../../storage/db";

let counter = 0;

describe("PDFImporter", () => {
  const origDocument = globalThis.document;

  beforeEach(() => {
    setDB(new InkboardDB(`pdf-import-${Date.now()}-${counter++}`));
    (globalThis as any).document = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          fillStyle: "",
          fillRect: vi.fn(),
        }),
        toBlob: (cb: (b: Blob | null) => void) =>
          cb(new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" })),
      }),
    };
  });

  afterEach(() => {
    (globalThis as any).document = origDocument;
  });

  it("stops writing page assets when aborted and destroys the PDF proxy", async () => {
    const controller = new AbortController();
    const destroy = vi.fn().mockResolvedValue(undefined);
    const getPage = vi.fn(async (num: number) => {
      if (num === 2) controller.abort();
      return {
        getViewport: () => ({ width: 100, height: 100 }),
        render: () => ({ promise: Promise.resolve() }),
        cleanup: vi.fn(),
      };
    });

    const inspected = {
      pageCount: 3,
      sizes: [
        { width: 100, height: 100 },
        { width: 100, height: 100 },
        { width: 100, height: 100 },
      ],
      pdf: { getPage, destroy } as unknown as InspectedPDF["pdf"],
    };

    const doc = new CanvasDocument();
    const file = new File([new Uint8Array([9, 9])], "slides.pdf", {
      type: "application/pdf",
    });

    const result = await importPDF({
      boardId: "board-1",
      doc,
      file,
      inspected,
      layout: "vertical",
      origin: { x: 0, y: 0 },
      signal: controller.signal,
    });

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(getPage).toHaveBeenCalledTimes(2);
    // Only source PDF + page 1 should have been saved before page 2 aborted.
    const assets = await getDB().assets.where("boardId").equals("board-1")
      .toArray();
    expect(assets.map((a) => a.id).sort()).toEqual([
      `${result.pdfDocumentId}-p1`,
      `${result.pdfDocumentId}-src`,
    ]);
    doc.destroy();
  });
});
