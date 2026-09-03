import "fake-indexeddb/auto";
import { readFile } from "node:fs/promises";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CanvasDocument } from "../document/crdt";
import { DEFAULT_TEXT_WIDTH, type CanvasObject } from "../document/schema";
import { putAsset } from "../storage/assetRepository";
import { InkboardDB, setDB } from "../storage/db";
import { exportToPDF } from "./PDFExporter";

/**
 * End-to-end export: build a board like the one in the README's test recipe,
 * render it to a real PDF and read the result back with PDF.js.
 *
 * Fonts are normally fetched from the bundled asset URLs Vite generates; in
 * Node those URLs are root-relative paths, so `fetch` is pointed at the file
 * system. Nothing else about the pipeline is stubbed - this exercises the same
 * font embedding, coordinate maths and page planning the browser runs.
 */
beforeAll(() => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    if (url.startsWith("/node_modules/")) {
      const bytes = await readFile(`${process.cwd()}${url}`);
      return new Response(new Uint8Array(bytes));
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
});

// A 1x1 PNG, standing in for a rasterised PDF page.
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function pngBlob(): Blob {
  const bin = Buffer.from(PNG_1x1, "base64");
  return new Blob([new Uint8Array(bin)], { type: "image/png" });
}

let counter = 0;

/** A board with an imported page, ink in two colours and widths, and text. */
async function buildBoard(): Promise<CanvasObject[]> {
  const doc = new CanvasDocument();
  const boardId = "board";
  await putAsset({
    id: "doc-p1",
    boardId,
    mimeType: "image/png",
    blob: pngBlob(),
    width: 1,
    height: 1,
    size: 100,
    createdAt: 1,
  });
  doc.addPDFDocument({ id: "doc", fileName: "lecture.pdf", pageCount: 1, layout: "vertical", createdAt: 1 }, [
    { id: "p1", type: "pdf-page", assetId: "doc-p1", pdfDocumentId: "doc", pageNumber: 1, x: 0, y: 0, width: 612, height: 792, rotation: 0, createdAt: 1 },
  ]);
  doc.addStroke({
    tool: "pen",
    color: "#1b1b1f",
    width: 2.5,
    points: [50, 100, 0.5, 150, 140, 0.6, 250, 110, 0.5],
    bounds: { minX: 47, minY: 97, maxX: 253, maxY: 143 },
  });
  doc.addStroke({
    tool: "pencil",
    color: "#d93025",
    width: 12,
    points: [80, 400, 0.5, 300, 460, 0.5],
    bounds: { minX: 68, minY: 388, maxX: 312, maxY: 472 },
  });
  doc.addText({
    x: 60,
    y: 200,
    width: DEFAULT_TEXT_WIDTH,
    text: "Annotation over the imported page, long enough to wrap onto a second line.",
    fontFamily: "open-sans",
    fontSize: 20,
    color: "#2b6de9",
    textAlign: "left",
  });
  doc.addText({
    x: 60,
    y: 600,
    width: 240,
    text: "Second family, centred",
    fontFamily: "roboto",
    fontSize: 24,
    color: "#1b1b1f",
    textAlign: "center",
  });
  // A note well outside every imported page.
  doc.addText({
    x: 2000,
    y: 2000,
    width: 200,
    text: "Loose canvas note",
    fontFamily: "lato",
    fontSize: 18,
    color: "#2e9e5b",
    textAlign: "left",
  });
  return doc.getAll();
}

async function readBack(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const ops = await page.getOperatorList();
    const lines = content.items.map((it) => ("str" in it ? it.str : "")).filter((t) => t.trim() !== "");
    pages.push({
      size: page.view.slice(2) as number[],
      lines,
      /** Wrapped lines rejoined, so assertions can talk about whole sentences. */
      text: lines.join(" ").replace(/\s+/g, " ").trim(),
      opCount: ops.fnArray.length,
    });
  }
  return pages;
}

beforeEach(() => {
  setDB(new InkboardDB(`export-test-${counter++}`));
});

describe("PDF export", () => {
  it("renders one output page per imported page, plus a page for loose notes", async () => {
    const objects = await buildBoard();
    const progress: string[] = [];
    const result = await exportToPDF({
      objects,
      boardName: "Lecture 5",
      layout: "pdf-pages",
      onProgress: (done, total, label) => progress.push(`${done}/${total} ${label}`),
    });

    expect(result.fileName).toBe("Lecture 5.pdf");
    expect(result.pageCount).toBe(2);
    expect(progress.length).toBeGreaterThan(1);

    const pages = await readBack(result.bytes);
    expect(pages).toHaveLength(2);
    // Page one is the imported page's own size, so annotations stay aligned.
    expect(pages[0].size[0]).toBeCloseTo(612, 0);
    expect(pages[0].size[1]).toBeCloseTo(792, 0);
    expect(pages[0].text).toContain("Annotation over the imported page");
    expect(pages[0].text).toContain("Second family");
    // The loose note is not silently dropped; it gets its own page.
    expect(pages[0].text).not.toContain("Loose canvas note");
    expect(pages[1].text).toContain("Loose canvas note");
  });

  it("wraps exported text the same way the canvas does", async () => {
    const objects = await buildBoard();
    const result = await exportToPDF({ objects, boardName: "Wrap", layout: "pdf-pages" });
    const pages = await readBack(result.bytes);
    // The annotation is 300 world units wide at size 20: it cannot be one line.
    const annotation = pages[0].lines.filter((l) => /Annotation|wrap|second line/.test(l));
    expect(annotation.length).toBeGreaterThan(1);
    expect(pages[0].text).toContain("Annotation over the imported page, long enough to wrap onto a second line.");
  });

  it("fits everything onto a single page sized to the content", async () => {
    const objects = await buildBoard();
    const result = await exportToPDF({ objects, boardName: "Fit", layout: "fit" });
    expect(result.pageCount).toBe(1);
    const [page] = await readBack(result.bytes);
    // Wide enough to hold the loose note at x=2000 plus padding.
    expect(page.size[0]).toBeGreaterThan(2200);
    expect(page.text).toContain("Loose canvas note");
    expect(page.text).toContain("Annotation over the imported page");
  });

  it("paginates onto A4 and keeps every page the same size", async () => {
    const objects = await buildBoard();
    const result = await exportToPDF({ objects, boardName: "A4", layout: "a4" });
    const pages = await readBack(result.bytes);
    expect(pages.length).toBeGreaterThanOrEqual(1);
    for (const p of pages) {
      expect(p.size[0]).toBeCloseTo(pages[0].size[0], 1);
      expect(p.size[1]).toBeCloseTo(pages[0].size[1], 1);
    }
  });

  it("exports only the selection when asked", async () => {
    const objects = await buildBoard();
    const selection = objects.filter((o) => o.type === "text" && o.text.startsWith("Loose"));
    const result = await exportToPDF({ objects: selection, boardName: "Selection", layout: "fit" });
    const [page] = await readBack(result.bytes);
    expect(page.text).toContain("Loose canvas note");
    expect(page.text).not.toContain("Annotation over the imported page");
  });

  it("draws ink as vector paths and the imported page as an image", async () => {
    const objects = await buildBoard();
    const result = await exportToPDF({ objects, boardName: "Vector", layout: "pdf-pages" });
    const pages = await readBack(result.bytes);
    // Enough operators for two filled stroke outlines plus text and an image:
    // a rasterised board would be a single drawImage.
    expect(pages[0].opCount).toBeGreaterThan(20);
    // Handwriting is not rasterised, so the file stays small.
    expect(result.bytes.byteLength).toBeLessThan(400_000);
  });

  it("exports rotated objects at the orientation the canvas shows", async () => {
    const objects = await buildBoard();
    const doc = new CanvasDocument();
    // Rebuild the board in a document so the real rotate command is used.
    for (const o of objects) {
      if (o.type === "stroke") doc.addStroke(o);
      else if (o.type === "text") doc.addText(o);
    }
    const pageObj = objects.find((o) => o.type === "pdf-page")!;
    doc.addPDFDocument({ id: "doc", fileName: "lecture.pdf", pageCount: 1, layout: "vertical", createdAt: 1 }, [
      pageObj as never,
    ]);
    const ids = doc.getAll().map((o) => o.id);
    doc.rotateObjects(ids, Math.PI / 2, { x: 306, y: 396 });

    const result = await exportToPDF({ objects: doc.getAll(), boardName: "Rotated", layout: "pdf-pages" });
    const pages = await readBack(result.bytes);
    // A quarter-turned page exports landscape: its transform is respected
    // rather than ignored and clipped back to portrait.
    expect(pages[0].size[0]).toBeCloseTo(792, 0);
    expect(pages[0].size[1]).toBeCloseTo(612, 0);
    // Rotated text is still real, searchable text, wrapped as it was.
    expect(pages.map((p) => p.text).join(" ")).toContain("Annotation over the imported page");
  });

  it("refuses to export an empty board with a readable message", async () => {
    await expect(exportToPDF({ objects: [], boardName: "Empty", layout: "fit" })).rejects.toThrow(/nothing on this board/i);
  });
});
