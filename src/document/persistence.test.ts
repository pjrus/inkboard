import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { InkboardDB, setDB } from "../storage/db";
import { boardRepository, DEFAULT_TOOL_PREFS } from "../boards/BoardRepository";
import { CanvasDocument } from "./crdt";
import { DocumentPersistence } from "./persistence";

let counter = 0;
beforeEach(() => {
  setDB(new InkboardDB(`test-${Date.now()}-${counter++}`));
});

const stroke = (x: number) => ({
  tool: "pen" as const,
  color: "#000",
  width: 3,
  points: [x, 0, 0.5, x + 1, 1, 0.5],
  bounds: { minX: x, minY: 0, maxX: x + 1, maxY: 1 },
});

describe("board persistence", () => {
  it("stores and restores a board's CRDT state across sessions", async () => {
    const board = await boardRepository.create("Test");

    const doc1 = new CanvasDocument();
    const p1 = new DocumentPersistence(board.id, doc1);
    await p1.load();
    p1.start();
    const ids = [doc1.addStroke(stroke(0)).id, doc1.addStroke(stroke(10)).id];
    await p1.destroy();

    const doc2 = new CanvasDocument();
    const p2 = new DocumentPersistence(board.id, doc2);
    const { updateCount } = await p2.load();
    expect(updateCount).toBeGreaterThan(0);
    expect(doc2.getAll().map((o) => o.id).sort()).toEqual(ids.sort());
    expect(doc2.get(ids[0])).toEqual(doc1.get(ids[0]));
  });

  it("compacts many update rows into one without losing data", async () => {
    const board = await boardRepository.create("Compact");
    const doc = new CanvasDocument();
    const p = new DocumentPersistence(board.id, doc);
    await p.load();
    p.start();
    for (let i = 0; i < 20; i++) {
      doc.addStroke(stroke(i));
      await p.flush();
    }
    await p.compact();
    await p.destroy();

    const doc2 = new CanvasDocument();
    const p2 = new DocumentPersistence(board.id, doc2);
    const { updateCount } = await p2.load();
    expect(updateCount).toBe(1);
    expect(doc2.getAll()).toHaveLength(20);
  });

  it("restores text boxes, their styling and their collaborative text type", async () => {
    const board = await boardRepository.create("Text");

    const doc1 = new CanvasDocument();
    const p1 = new DocumentPersistence(board.id, doc1);
    await p1.load();
    p1.start();
    const t = doc1.addText({
      x: 120,
      y: -40,
      width: 260,
      text: "",
      fontFamily: "open-sans",
      fontSize: 24,
      color: "#d93025",
      textAlign: "center",
    });
    for (const ch of "Typed on the canvas") doc1.editText(t.id, (y) => y.insert(y.length, ch));
    await p1.destroy();

    const doc2 = new CanvasDocument();
    const p2 = new DocumentPersistence(board.id, doc2);
    await p2.load();
    expect(doc2.get(t.id)).toMatchObject({
      type: "text",
      x: 120,
      y: -40,
      width: 260,
      text: "Typed on the canvas",
      fontFamily: "open-sans",
      fontSize: 24,
      color: "#d93025",
      textAlign: "center",
    });
    // Still a Y.Text after a reload, so a later collaborator can splice it.
    expect(doc2.getTextHandle(t.id)?.toString()).toBe("Typed on the canvas");
    doc2.editText(t.id, (y) => y.insert(0, "> "));
    expect(doc2.getTextHandle(t.id)?.toString()).toBe("> Typed on the canvas");
  });

  it("persists and restores the viewport and tool preferences", async () => {
    const board = await boardRepository.create("VP");
    await boardRepository.saveViewport(board.id, { x: 12, y: -30, scale: 1.75 });
    expect((await boardRepository.get(board.id))?.viewport).toEqual({ x: 12, y: -30, scale: 1.75 });
    const prefs = { ...DEFAULT_TOOL_PREFS, tool: "pencil" as const, color: "#ff0000", colorExplicit: true, width: 7, textFontSize: 24 };
    await boardRepository.saveToolPreferences(prefs);
    expect(await boardRepository.getToolPreferences()).toEqual(prefs);
  });

  it("deleting a board removes its updates", async () => {
    const board = await boardRepository.create("Del");
    const doc = new CanvasDocument();
    const p = new DocumentPersistence(board.id, doc);
    p.start();
    doc.addStroke(stroke(0));
    await p.destroy();
    await boardRepository.delete(board.id);
    expect(await boardRepository.get(board.id)).toBeUndefined();
    const doc2 = new CanvasDocument();
    expect((await new DocumentPersistence(board.id, doc2).load()).updateCount).toBe(0);
  });
});
