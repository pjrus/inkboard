import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { CanvasDocument } from "../document/crdt";
import { DEFAULT_LASSO_FILTER, type CanvasObject, type LassoFilter, type PDFPageObject, type StrokeObject, type TextObject } from "../document/schema";
import {
  lassoHits,
  matchesLassoFilter,
  objectCenter,
  objectCorners,
  rectContains,
  rotatePoint,
  snapAngle,
  toDegrees,
  transformedBounds,
} from "./transform";

const HALF_TURN = Math.PI;
const QUARTER = Math.PI / 2;

const near = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);

const page = (x: number, y: number, rotation = 0): PDFPageObject => ({
  id: `p${x}-${y}`,
  type: "pdf-page",
  assetId: "asset",
  pdfDocumentId: "doc",
  pageNumber: 1,
  x,
  y,
  width: 100,
  height: 200,
  rotation,
  createdAt: 1,
});

const text = (x: number, y: number, rotation = 0): TextObject => ({
  id: `t${x}-${y}`,
  type: "text",
  x,
  y,
  width: 100,
  text: "hello",
  fontFamily: "open-sans",
  fontSize: 20,
  color: "#000",
  rotation,
  createdAt: 2,
  updatedAt: 2,
});

/** A horizontal stroke from (x0,y) to (x1,y). */
const stroke = (x0: number, x1: number, y: number, id = "s"): StrokeObject => {
  const points: number[] = [];
  for (let i = 0; i <= 10; i++) points.push(x0 + ((x1 - x0) * i) / 10, y, 0.5);
  return {
    id,
    type: "stroke",
    tool: "pen",
    color: "#000",
    width: 2,
    points,
    bounds: { minX: Math.min(x0, x1) - 2, minY: y - 2, maxX: Math.max(x0, x1) + 2, maxY: y + 2 },
    createdAt: 3,
  };
};

const lasso = (minX: number, minY: number, maxX: number, maxY: number) => [
  { x: minX, y: minY },
  { x: maxX, y: minY },
  { x: maxX, y: maxY },
  { x: minX, y: maxY },
];

describe("object transforms", () => {
  it("puts a rotated object's bounds where the object actually is", () => {
    const upright = page(0, 0);
    expect(transformedBounds(upright)).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 200 });
    // A quarter turn swaps the extents about the unchanged centre (50, 100).
    const turned = transformedBounds(page(0, 0, QUARTER));
    near(turned.minX, -50);
    near(turned.maxX, 150);
    near(turned.minY, 50);
    near(turned.maxY, 150);
  });

  it("hit tests in the object's own frame, not its old rectangle", () => {
    const turned = page(0, 0, QUARTER);
    // Inside the rotated page but outside its original rectangle.
    expect(rectContains(turned, { x: 140, y: 100 })).toBe(true);
    // Inside the original rectangle but no longer covered once turned.
    expect(rectContains(turned, { x: 50, y: 190 })).toBe(false);
    // The centre is fixed by rotation, so it is always inside.
    expect(rectContains(turned, objectCenter(turned))).toBe(true);
  });

  it("snaps to 15 degree increments and reports whole degrees", () => {
    expect(toDegrees(snapAngle((37 * Math.PI) / 180))).toBe(30);
    expect(toDegrees(snapAngle((44 * Math.PI) / 180))).toBe(45);
    expect(toDegrees(snapAngle(QUARTER))).toBe(90);
    expect(toDegrees(-QUARTER)).toBe(270);
  });

  it("rotates a point about a pivot", () => {
    const p = rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, QUARTER);
    near(p.x, 0);
    near(p.y, 10);
  });
});

describe("lasso filter", () => {
  const objects: CanvasObject[] = [stroke(10, 90, 50), text(10, 10), page(0, 0)];
  const all = lasso(-200, -200, 300, 400);
  const only = (f: Partial<LassoFilter>) =>
    lassoHits(objects, all, { ...DEFAULT_LASSO_FILTER, ...f })
      .map((o) => o.type)
      .sort();

  it("selects every eligible type when all are enabled", () => {
    expect(only({})).toEqual(["pdf-page", "stroke", "text"]);
  });

  it("selects only handwriting with ink alone enabled", () => {
    expect(only({ text: false, images: false })).toEqual(["stroke"]);
  });

  it("selects only text boxes with text alone enabled", () => {
    expect(only({ ink: false, images: false })).toEqual(["text"]);
  });

  it("selects only images and PDF pages with images alone enabled", () => {
    expect(only({ ink: false, text: false })).toEqual(["pdf-page"]);
  });

  it("classifies each object type exactly once", () => {
    const inkOnly: LassoFilter = { ink: true, text: false, images: false };
    expect(objects.map((o) => matchesLassoFilter(o, inkOnly))).toEqual([true, false, false]);
  });

  it("selects a rotated object by where it is now, not where it was", () => {
    const turned = page(0, 0, QUARTER); // occupies x -50..150, y 50..150
    const overOldBox = lasso(10, 160, 90, 195); // inside the pre-rotation rect only
    const overNewBox = lasso(-60, 60, 160, 140); // over the rotated page
    expect(lassoHits([turned], overOldBox, DEFAULT_LASSO_FILTER)).toEqual([]);
    expect(lassoHits([turned], overNewBox, DEFAULT_LASSO_FILTER)).toHaveLength(1);
  });
});

describe("moving and rotating a mixed selection", () => {
  function board() {
    const doc = new CanvasDocument();
    const a = doc.addStroke(stroke(0, 20, 0, "a"));
    const b = doc.addStroke(stroke(100, 120, 0, "b"));
    const t = doc.addText({ x: 0, y: 100, width: 100, text: "hi", fontFamily: "open-sans", fontSize: 20, color: "#000" });
    doc.addPDFDocument({ id: "doc", fileName: "f.pdf", pageCount: 1, layout: "vertical", createdAt: 1 }, [page(0, 300)]);
    const p = doc.getAll().find((o) => o.type === "pdf-page")!;
    return { doc, ids: [a.id, b.id, t.id, p.id] };
  }

  it("moves every selected type by the same world delta, as one undo step", () => {
    const { doc, ids } = board();
    const before = ids.map((id) => transformedBounds(doc.get(id)!));
    const historyBefore = doc.undoManager.undoStack.length;
    doc.translateObjects(ids, 300, 0);
    // One drag, one undo entry - never one per object or per pointer frame.
    expect(doc.undoManager.undoStack.length).toBe(historyBefore + 1);
    ids.forEach((id, i) => {
      const now = transformedBounds(doc.get(id)!);
      near(now.minX, before[i].minX + 300);
      near(now.minY, before[i].minY);
    });
    doc.undo();
    // A single undo brings the whole mixed selection back together.
    ids.forEach((id, i) => near(transformedBounds(doc.get(id)!).minX, before[i].minX));
  });

  it("rotates a group about a shared centre, so the arrangement turns too", () => {
    const doc = new CanvasDocument();
    const a = doc.addStroke(stroke(0, 20, 0, "a"));
    const b = doc.addStroke(stroke(200, 220, 0, "b"));
    const pivot = { x: 110, y: 0 };
    // A half turn must swap the two strokes' places, not spin each in place.
    doc.rotateObjects([a.id, b.id], HALF_TURN, pivot);
    near(transformedBounds(doc.get(a.id)!).minX, 198);
    near(transformedBounds(doc.get(b.id)!).minX, -2);
  });

  it("gives a rotated object a new position and a new rotation", () => {
    const doc = new CanvasDocument();
    const t = doc.addText({ x: 0, y: 0, width: 100, text: "hi", fontFamily: "open-sans", fontSize: 20, color: "#000" });
    const centre = objectCenter(doc.get(t.id)!);
    doc.rotateObjects([t.id], QUARTER, { x: 500, y: 0 });
    const after = doc.get(t.id) as TextObject;
    near(after.rotation ?? 0, QUARTER);
    // Its centre orbited the pivot rather than staying put.
    const moved = rotatePoint(centre, { x: 500, y: 0 }, QUARTER);
    const now = objectCenter(after);
    near(now.x, moved.x, 1e-3);
    near(now.y, moved.y, 1e-3);
  });

  it("counts one rotation gesture as one undoable step, and redo restores it", () => {
    const { doc, ids } = board();
    const pivot = { x: 0, y: 0 };
    doc.rotateObjects(ids, Math.PI / 6, pivot);
    const rotated = ids.map((id) => transformedBounds(doc.get(id)!));
    doc.undo();
    ids.forEach((id, i) => expect(transformedBounds(doc.get(id)!)).not.toEqual(rotated[i]));
    doc.redo();
    ids.forEach((id, i) => {
      const now = transformedBounds(doc.get(id)!);
      near(now.minX, rotated[i].minX, 1e-3);
      near(now.minY, rotated[i].minY, 1e-3);
    });
  });

  it("keeps positions and rotations across a reload of the document", () => {
    const { doc, ids } = board();
    doc.translateObjects(ids, 40, -25);
    doc.rotateObjects(ids, Math.PI / 6, { x: 10, y: 10 });
    const expected = ids.map((id) => transformedBounds(doc.get(id)!));

    const reopened = new CanvasDocument();
    reopened.applyUpdate(Y.encodeStateAsUpdate(doc.ydoc));
    ids.forEach((id, i) => {
      const b = transformedBounds(reopened.get(id)!);
      near(b.minX, expected[i].minX, 1e-3);
      near(b.minY, expected[i].minY, 1e-3);
    });
    // Selection is local state: nothing about it survives into the document.
    expect(reopened.getAll().some((o) => "selected" in o)).toBe(false);
  });

  it("rotates a stroke's own geometry, and its corners follow", () => {
    const doc = new CanvasDocument();
    const s = doc.addStroke(stroke(0, 100, 0, "s"));
    const centre = objectCenter(doc.get(s.id)!);
    doc.rotateObjects([s.id], QUARTER, centre);
    const b = transformedBounds(doc.get(s.id)!);
    // A horizontal stroke turned a quarter turn about its own centre is vertical.
    expect(b.maxY - b.minY).toBeGreaterThan(b.maxX - b.minX);
    expect(objectCorners(doc.get(s.id)!)).toHaveLength(4);
  });
});

describe("lasso hit testing across object types", () => {
  const bigPage = (): PDFPageObject => ({ ...page(0, 0), width: 4000, height: 4000 });

  it("selects an image the lasso is drawn inside, which is the only gesture a huge page allows", () => {
    const loop = lasso(1000, 1000, 1200, 1200);
    expect(lassoHits([bigPage()], loop, DEFAULT_LASSO_FILTER)).toHaveLength(1);
  });

  it("leaves the page alone when the lasso is really around handwriting on top of it", () => {
    const ink = stroke(1000, 1100, 1100);
    const loop = lasso(980, 1080, 1120, 1120);
    expect(lassoHits([bigPage(), ink], loop, DEFAULT_LASSO_FILTER).map((o) => o.id)).toEqual([ink.id]);
  });

  it("still honours the filter on the containment fallback", () => {
    const loop = lasso(1000, 1000, 1200, 1200);
    expect(lassoHits([bigPage()], loop, { ink: true, text: true, images: false })).toEqual([]);
  });

  it("takes the smallest object when several contain the lasso", () => {
    const small: PDFPageObject = { ...page(900, 900), id: "small", width: 600, height: 600 };
    const loop = lasso(1000, 1000, 1100, 1100);
    expect(lassoHits([bigPage(), small], loop, DEFAULT_LASSO_FILTER).map((o) => o.id)).toEqual(["small"]);
  });

  it("picks up overlapping objects of mixed types in one sweep", () => {
    const objects: CanvasObject[] = [stroke(10, 90, 40), text(10, 10), page(0, 0)];
    const hits = lassoHits(objects, lasso(-50, -50, 200, 300), DEFAULT_LASSO_FILTER);
    expect(hits.map((o) => o.type).sort()).toEqual(["pdf-page", "stroke", "text"]);
  });

  it("selects a partially intersected object without needing it enclosed", () => {
    const t = text(0, 0); // 100 wide, starts at the origin
    // Lasso covering the left half of the box: past the halfway rule.
    expect(lassoHits([t], lasso(-50, -50, 60, 100), DEFAULT_LASSO_FILTER)).toHaveLength(1);
    // Only a sliver of the right edge: not a selection.
    expect(lassoHits([t], lasso(95, -50, 200, 100), DEFAULT_LASSO_FILTER)).toEqual([]);
  });

  it("ignores an object that merely grazes the lasso boundary", () => {
    const t = text(100, 0);
    expect(lassoHits([t], lasso(0, 0, 101, 100), DEFAULT_LASSO_FILTER)).toEqual([]);
  });

  it("finds a rotated text box the lasso only partly covers", () => {
    const turned = text(0, 0, QUARTER);
    const upright = transformedBounds(text(0, 0));
    const rotated = transformedBounds(turned);
    expect(rotated).not.toEqual(upright);
    expect(lassoHits([turned], lasso(rotated.minX - 5, rotated.minY - 5, rotated.maxX + 5, rotated.maxY + 5), DEFAULT_LASSO_FILTER)).toHaveLength(1);
  });
});
