import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { boardRepository } from "../boards/BoardRepository";
import { InkboardDB, setDB } from "../storage/db";
import { CanvasDocument } from "./crdt";
import { DocumentPersistence } from "./persistence";
import type { StrokeObject } from "./schema";
import { nextWidthStep, summarise } from "./strokeCommands";

const stroke = (width: number, color = "#000") => ({
  tool: "pen" as const,
  color,
  width,
  points: [0, 0, 0.7, 10, 10, 0.3],
  bounds: { minX: -width, minY: -width, maxX: 10 + width, maxY: 10 + width },
});

describe("width steps", () => {
  it("steps relative to each width and clamps", () => {
    expect(nextWidthStep(2, 1)).toBe(2.5);
    expect(nextWidthStep(5, 1)).toBe(7);
    expect(nextWidthStep(2.5, -1)).toBe(1.5);
    expect(nextWidthStep(40, 1)).toBe(40);
    expect(nextWidthStep(1, -1)).toBe(0.5);
    expect(nextWidthStep(0.5, -1)).toBe(0.5);
  });
  it("summarises mixed values", () => {
    expect(summarise([4, 4])).toEqual({ value: 4, mixed: false });
    expect(summarise([4, 7])).toEqual({ value: null, mixed: true });
  });
});

describe("stroke property commands", () => {
  it("changes width 2 -> 6 for all selected strokes as one undo step, keeping pressure", () => {
    const d = new CanvasDocument();
    const ids = [d.addStroke(stroke(2)).id, d.addStroke(stroke(2)).id];
    d.setStrokeWidth(ids, 6);
    for (const id of ids) {
      const s = d.get(id) as StrokeObject;
      expect(s.width).toBe(6);
      expect(s.points).toEqual([0, 0, 0.7, 10, 10, 0.3]);
      expect(s.bounds.maxX).toBe(16);
      expect(s.color).toBe("#000");
    }
    d.undo();
    expect((d.get(ids[0]) as StrokeObject).width).toBe(2);
    expect((d.get(ids[1]) as StrokeObject).width).toBe(2);
    d.redo();
    expect((d.get(ids[0]) as StrokeObject).width).toBe(6);
  });

  it("adjusts mixed widths relative to each stroke", () => {
    const d = new CanvasDocument();
    const a = d.addStroke(stroke(2)).id;
    const b = d.addStroke(stroke(5)).id;
    d.adjustStrokeWidths([a, b], 1);
    expect((d.get(a) as StrokeObject).width).toBe(2.5);
    expect((d.get(b) as StrokeObject).width).toBe(7);
    d.adjustStrokeWidths([a, b], -1);
    // Steps land on the shared scale, so 2.5 -> 1.5 and 7 -> 4.
    expect((d.get(a) as StrokeObject).width).toBe(1.5);
    expect((d.get(b) as StrokeObject).width).toBe(4);
  });

  it("moves strokes as a group and undoes in one step", () => {
    const d = new CanvasDocument();
    const ids = [d.addStroke(stroke(2)).id, d.addStroke(stroke(2)).id, d.addStroke(stroke(2)).id];
    d.translateObjects(ids, 100, -50);
    for (const id of ids) {
      const s = d.get(id) as StrokeObject;
      expect(s.points).toEqual([100, -50, 0.7, 110, -40, 0.3]);
      expect(s.bounds.minX).toBe(98);
    }
    d.undo();
    for (const id of ids) expect((d.get(id) as StrokeObject).points[0]).toBe(0);
  });

  it("changes colour and syncs property edits to a remote replica", () => {
    const a = new CanvasDocument();
    const b = new CanvasDocument();
    const id = a.addStroke(stroke(2)).id;
    b.applyUpdate(Y.encodeStateAsUpdate(a.ydoc));
    a.setStrokeWidth([id], 8);
    a.setStrokeColor([id], "#f00");
    b.applyUpdate(Y.encodeStateAsUpdate(a.ydoc));
    const remote = b.get(id) as StrokeObject;
    expect(remote.width).toBe(8);
    expect(remote.color).toBe("#f00");
  });
});

describe("edited widths persist", () => {
  let n = 0;
  beforeEach(() => setDB(new InkboardDB(`lasso-${Date.now()}-${n++}`)));

  it("survives reload", async () => {
    const board = await boardRepository.create("W");
    const d1 = new CanvasDocument();
    const p1 = new DocumentPersistence(board.id, d1);
    p1.start();
    const id = d1.addStroke(stroke(2)).id;
    d1.setStrokeWidth([id], 8);
    await p1.destroy();

    const d2 = new CanvasDocument();
    await new DocumentPersistence(board.id, d2).load();
    expect((d2.get(id) as StrokeObject).width).toBe(8);
  });
});
