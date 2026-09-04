import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { CanvasDocument } from "../../document/crdt";

const strokeInput = (x: number) => ({
  tool: "pen" as const,
  color: "#000",
  width: 3,
  points: [x, 0, 0.5, x + 10, 10, 0.5],
  bounds: { minX: x - 3, minY: -3, maxX: x + 13, maxY: 13 },
});

describe("CanvasDocument (CRDT)", () => {
  it("merges strokes added independently on two replicas", () => {
    const a = new CanvasDocument();
    const b = new CanvasDocument();
    const sa = a.addStroke(strokeInput(0));
    const sb = b.addStroke(strokeInput(100));

    // Exchange full states both ways (what a sync provider would do).
    const ua = Y.encodeStateAsUpdate(a.ydoc);
    const ub = Y.encodeStateAsUpdate(b.ydoc);
    a.applyUpdate(ub);
    b.applyUpdate(ua);

    expect(
      a
        .getAll()
        .map((o) => o.id)
        .sort(),
    ).toEqual([sa.id, sb.id].sort());
    expect(
      b
        .getAll()
        .map((o) => o.id)
        .sort(),
    ).toEqual([sa.id, sb.id].sort());
    expect(a.get(sb.id)).toEqual(b.get(sb.id));
  });

  it("removes strokes and keeps replicas consistent", () => {
    const a = new CanvasDocument();
    const b = new CanvasDocument();
    const s = a.addStroke(strokeInput(0));
    b.applyUpdate(Y.encodeStateAsUpdate(a.ydoc));
    b.removeObjects([s.id]);
    a.applyUpdate(Y.encodeStateAsUpdate(b.ydoc));
    expect(a.getAll()).toHaveLength(0);
  });

  it("supports undo/redo of stroke creation and deletion", () => {
    const d = new CanvasDocument();
    const s1 = d.addStroke(strokeInput(0));
    d.addStroke(strokeInput(50));
    expect(d.getAll()).toHaveLength(2);
    d.undo();
    expect(d.getAll()).toHaveLength(1);
    d.redo();
    expect(d.getAll()).toHaveLength(2);
    d.removeObjects([s1.id]);
    expect(d.getAll()).toHaveLength(1);
    d.undo();
    expect(d.getAll()).toHaveLength(2);
  });

  it("does not undo remote changes", () => {
    const a = new CanvasDocument();
    const b = new CanvasDocument();
    b.addStroke(strokeInput(0));
    a.applyUpdate(Y.encodeStateAsUpdate(b.ydoc));
    a.addStroke(strokeInput(1));
    a.undo();
    expect(a.getAll()).toHaveLength(1); // remote stroke survives
    expect(a.canUndo()).toBe(false);
  });

  it("inserts a PDF document with pages as a single undo step and relays out", () => {
    const d = new CanvasDocument();
    const pages = [1, 2, 3].map((n) => ({
      id: `p${n}`,
      type: "pdf-page" as const,
      assetId: `doc-p${n}`,
      pdfDocumentId: "doc",
      pageNumber: n,
      x: 0,
      y: (n - 1) * 840,
      width: 612,
      height: 792,
      rotation: 0,
      createdAt: 1,
    }));
    d.addPDFDocument(
      {
        id: "doc",
        fileName: "a.pdf",
        pageCount: 3,
        layout: "vertical",
        createdAt: 1,
      },
      pages,
    );
    expect(d.pagesOf("doc")).toHaveLength(3);
    d.setPDFLayout("doc", "horizontal", [
      { id: "p1", x: 0, y: 0 },
      { id: "p2", x: 660, y: 0 },
      { id: "p3", x: 1320, y: 0 },
    ]);
    expect(d.getPDFDocument("doc")?.layout).toBe("horizontal");
    expect(d.pagesOf("doc").map((p) => p.x)).toEqual([0, 660, 1320]);
    d.undo();
    expect(d.getPDFDocument("doc")?.layout).toBe("vertical");
    expect(d.pagesOf("doc").map((p) => p.y)).toEqual([0, 840, 1680]);
    d.undo();
    expect(d.getAll()).toHaveLength(0);
    expect(d.getPDFDocuments()).toHaveLength(0);
  });

  it("notifies listeners with typed changes", () => {
    const d = new CanvasDocument();
    const seen: string[] = [];
    d.onChange((changes) => changes.forEach((c) => seen.push(c.kind)));
    const s = d.addStroke(strokeInput(0));
    d.removeObjects([s.id]);
    expect(seen).toEqual(["add", "remove"]);
  });
});
