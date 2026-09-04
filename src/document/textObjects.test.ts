import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { CanvasDocument } from "./crdt";
import { DEFAULT_TEXT_WIDTH, type TextObject } from "./schema";

const textInput = (overrides: Partial<TextObject> = {}) => ({
  x: 0,
  y: 0,
  width: DEFAULT_TEXT_WIDTH,
  text: "",
  fontFamily: "open-sans" as const,
  fontSize: 20,
  color: "#1b1b1f",
  textAlign: "left" as const,
  ...overrides,
});

const sync = (a: CanvasDocument, b: CanvasDocument) => {
  const ua = Y.encodeStateAsUpdate(a.ydoc);
  const ub = Y.encodeStateAsUpdate(b.ydoc);
  a.applyUpdate(ub);
  b.applyUpdate(ua);
};

const textOf = (d: CanvasDocument, id: string) =>
  (d.get(id) as TextObject).text;

describe("text objects in the CRDT", () => {
  it("stores text as a plain string in snapshots but a Y.Text underneath", () => {
    const d = new CanvasDocument();
    const t = d.addText(textInput({ text: "hello" }));
    expect(d.get(t.id)).toMatchObject({
      type: "text",
      text: "hello",
      fontFamily: "open-sans",
      fontSize: 20,
    });
    expect(d.getTextHandle(t.id)).toBeInstanceOf(Y.Text);
    expect(d.getTextHandle(t.id)?.toString()).toBe("hello");
  });

  it("merges concurrent edits to the same text box without corruption", () => {
    const a = new CanvasDocument();
    const b = new CanvasDocument();
    const t = a.addText(textInput({ text: "Hello world" }));
    sync(a, b);

    // Two replicas type into the same box at different offsets, offline.
    a.editText(t.id, (y) => y.insert(5, ", dear"));
    b.editText(t.id, (y) => y.insert(11, "!"));
    sync(a, b);

    expect(textOf(a, t.id)).toBe(textOf(b, t.id));
    // Nothing is lost: both insertions survive on both replicas.
    expect(textOf(a, t.id)).toContain(", dear");
    expect(textOf(a, t.id)).toContain("!");
    expect(textOf(a, t.id)).toContain("Hello");
    expect(textOf(a, t.id)).toContain("world");
  });

  it("merges a deletion on one replica with an insertion on the other", () => {
    const a = new CanvasDocument();
    const b = new CanvasDocument();
    const t = a.addText(textInput({ text: "abcdef" }));
    sync(a, b);
    a.editText(t.id, (y) => y.delete(0, 3));
    b.editText(t.id, (y) => y.insert(6, "gh"));
    sync(a, b);
    expect(textOf(a, t.id)).toBe("defgh");
    expect(textOf(b, t.id)).toBe("defgh");
  });

  it("merges independent property changes field by field", () => {
    const a = new CanvasDocument();
    const b = new CanvasDocument();
    const t = a.addText(textInput({ text: "note" }));
    sync(a, b);
    a.setTextProperties([t.id], { fontSize: 32 });
    b.setTextProperties([t.id], { color: "#d93025" });
    sync(a, b);
    expect(a.get(t.id)).toMatchObject({ fontSize: 32, color: "#d93025" });
    expect(a.get(t.id)).toEqual(b.get(t.id));
  });

  it("undoes and redoes creation, property changes and deletion", () => {
    const d = new CanvasDocument();
    const t = d.addText(textInput({ text: "hi" }));
    d.setTextProperties([t.id], {
      fontFamily: "roboto",
      fontSize: 32,
      textAlign: "center",
    });
    expect(d.get(t.id)).toMatchObject({
      fontFamily: "roboto",
      fontSize: 32,
      textAlign: "center",
    });
    d.undo();
    expect(d.get(t.id)).toMatchObject({
      fontFamily: "open-sans",
      fontSize: 20,
      textAlign: "left",
    });
    d.redo();
    expect(d.get(t.id)).toMatchObject({ fontFamily: "roboto", fontSize: 32 });
    d.removeObjects([t.id]);
    expect(d.get(t.id)).toBeUndefined();
    d.undo();
    expect(textOf(d, t.id)).toBe("hi");
    d.undo();
    d.undo();
    expect(d.get(t.id)).toBeUndefined();
  });

  it("groups a burst of typing into one undo step, not one per keystroke", () => {
    const d = new CanvasDocument();
    const t = d.addText(textInput(), true);
    for (const ch of "hello") d.editText(t.id, (y) => y.insert(y.length, ch));
    expect(textOf(d, t.id)).toBe("hello");
    d.undo();
    // The whole burst (and the creation it grew out of) is one step.
    expect(d.get(t.id)).toBeUndefined();
    expect(d.canUndo()).toBe(false);
  });

  it("steps font sizes through the shared preset scale", () => {
    const d = new CanvasDocument();
    const a = d.addText(textInput({ fontSize: 20 }));
    const b = d.addText(textInput({ fontSize: 40 }));
    d.adjustTextFontSizes([a.id, b.id], 1);
    expect((d.get(a.id) as TextObject).fontSize).toBe(24);
    expect((d.get(b.id) as TextObject).fontSize).toBe(48);
    d.adjustTextFontSizes([a.id, b.id], -1);
    expect((d.get(a.id) as TextObject).fontSize).toBe(20);
    expect((d.get(b.id) as TextObject).fontSize).toBe(40);
  });

  it("moves a mixed selection of strokes and text in one undo step", () => {
    const d = new CanvasDocument();
    const stroke = d.addStroke({
      tool: "pen",
      color: "#000",
      width: 3,
      points: [0, 0, 0.5, 10, 10, 0.5],
      bounds: { minX: -3, minY: -3, maxX: 13, maxY: 13 },
    });
    const text = d.addText(textInput({ x: 100, y: 50, text: "note" }));
    d.translateObjects([stroke.id, text.id], 25, -10);
    expect(d.get(text.id)).toMatchObject({ x: 125, y: 40 });
    expect(
      (d.get(stroke.id) as { points: number[] }).points.slice(0, 2),
    ).toEqual([25, -10]);
    d.undo();
    expect(d.get(text.id)).toMatchObject({ x: 100, y: 50 });
    expect(
      (d.get(stroke.id) as { points: number[] }).points.slice(0, 2),
    ).toEqual([0, 0]);
  });

  it("reports text changes to listeners so the renderer can repaint", () => {
    const d = new CanvasDocument();
    const seen: string[] = [];
    const t = d.addText(textInput());
    d.onChange((changes) => changes.forEach((c) => seen.push(c.kind)));
    d.editText(t.id, (y) => y.insert(0, "typed"));
    d.setTextProperties([t.id], { color: "#fff" });
    expect(seen).toEqual(["update", "update"]);
    expect(textOf(d, t.id)).toBe("typed");
  });
});
