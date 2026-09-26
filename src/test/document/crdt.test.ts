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
      type: "image" as const,
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
    expect(d.getPDFDocument("doc")).toBeUndefined();
  });

  it("detaches copied PDF pages from their import", () => {
    const d = new CanvasDocument();
    d.addPDFDocument(
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
    const [copy] = d.cloneObjects([d.get("p1")!], 700, 0);
    expect(d.get(copy)).toMatchObject({
      type: "image",
      assetId: "doc-p1",
      x: 700,
    });
    expect(d.get(copy)).not.toHaveProperty("pdfDocumentId");
    expect(d.get(copy)).not.toHaveProperty("pageNumber");
    expect(d.pagesOf("doc").map((p) => p.id)).toEqual(["p1"]);
    // Rearranging or removing the PDF never reaches the copy.
    d.setPDFLayout("doc", "horizontal", [{ id: "p1", x: 5000, y: 0 }]);
    d.removePDFDocument("doc");
    expect(d.getAll().map((o) => o.id)).toEqual([copy]);
    expect(d.get(copy)).toMatchObject({ x: 700 });
  });

  it("reads pages saved under the old pdf-page type as images", () => {
    const old = new Y.Doc();
    const m = new Y.Map<unknown>();
    for (
      const [k, v] of Object.entries({
        id: "p1",
        type: "pdf-page",
        assetId: "a",
        pdfDocumentId: "doc",
        pageNumber: 1,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
        createdAt: 1,
      })
    ) m.set(k, v);
    old.getMap("objects").set("p1", m);
    const d = new CanvasDocument(old);
    expect(d.get("p1")?.type).toBe("image");
    expect(d.pagesOf("doc")).toHaveLength(1);
  });

  it("notifies listeners with typed changes", () => {
    const d = new CanvasDocument();
    const seen: string[] = [];
    d.onChange((changes) => changes.forEach((c) => seen.push(c.kind)));
    const s = d.addStroke(strokeInput(0));
    d.removeObjects([s.id]);
    expect(seen).toEqual(["add", "remove"]);
  });

  it("clones objects with fresh ids and an offset, as one undo step", () => {
    const d = new CanvasDocument();
    const s = d.addStroke(strokeInput(0));
    const t = d.addText({
      x: 5,
      y: 5,
      width: 100,
      text: "hi",
      fontFamily: "inter",
      fontSize: 20,
      color: "#000",
    });
    const [sc, tc] = d.cloneObjects([d.get(s.id)!, d.get(t.id)!], 10, 20);
    expect([sc, tc]).not.toContain(s.id);
    expect(d.get(sc)).toMatchObject({
      points: [10, 20, 0.5, 20, 30, 0.5],
      bounds: { minX: 7, minY: 17, maxX: 23, maxY: 33 },
    });
    expect(d.get(tc)).toMatchObject({ x: 15, y: 25, text: "hi" });
    // The copy's text is its own Y.Text, not shared with the original.
    d.editText(tc, (y) => y.insert(2, "!"));
    expect(d.get(t.id)).toMatchObject({ text: "hi" });
    d.closeUndoGroup();
    d.undo(); // the edit
    d.undo(); // the clone
    expect(d.getAll()).toHaveLength(2);
    expect(d.get(s.id)).toMatchObject({ bounds: { minX: -3 } });
  });
});
