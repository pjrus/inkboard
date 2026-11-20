import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { BoardDoc } from "../crdt.js";

describe("BoardDoc CRDT operations", () => {
  it("creates, updates, queries, and deletes objects while preserving Yjs CRDT mergeability", () => {
    const serverDoc = new BoardDoc();
    const peerDoc = new BoardDoc();

    const bgDelta = serverDoc.setBackground("#1c1d21");
    Y.applyUpdate(peerDoc.ydoc, bgDelta);
    expect(peerDoc.getBackground()).toBe("#1c1d21");

    // Default text color contrasts with dark background (#f2f1ee).
    const addedText = serverDoc.addTextBox({
      x: 100,
      y: 200,
      text: "Raft consensus overview",
      width: 280,
      backgroundColor: "#fff9c4",
    });
    expect(addedText.object.color).toBe("#f2f1ee");
    Y.applyUpdate(peerDoc.ydoc, addedText.delta);

    const addedStroke = serverDoc.addStroke({
      tool: "pen",
      width: 4,
      points: [
        { x: 10, y: 20, pressure: 0.5 },
        { x: 110, y: 80, pressure: 0.8 },
      ],
    });
    expect(addedStroke.object.bounds).toEqual({
      minX: 6,
      minY: 16,
      maxX: 114,
      maxY: 84,
    });
    Y.applyUpdate(peerDoc.ydoc, addedStroke.delta);

    // Summary omits raw stroke points by default.
    const compact = serverDoc.getSummary(false);
    expect(compact.objectCounts).toEqual({
      total: 2,
      strokes: 1,
      text: 1,
      images: 0,
    });
    expect(compact.strokes[0].pointCount).toBe(2);
    expect(compact.strokes[0].points).toBeUndefined();
    expect(compact.contentBounds).not.toBeNull();

    // Summary includes stroke points when requested.
    const detailed = serverDoc.getSummary(true);
    expect(detailed.strokes[0].points).toHaveLength(6);

    // Update text box and clear backgroundColor with "transparent".
    const updated = serverDoc.updateTextBox({
      objectId: addedText.object.id,
      text: "Raft leader election notes",
      backgroundColor: "transparent",
      x: 150,
    });
    expect(updated.object.text).toBe("Raft leader election notes");
    expect(updated.object.backgroundColor).toBeUndefined();
    expect(updated.object.x).toBe(150);
    Y.applyUpdate(peerDoc.ydoc, updated.delta);
    expect(peerDoc.getObject(addedText.object.id)).toMatchObject({
      text: "Raft leader election notes",
      x: 150,
    });

    // Query by substring & spatial bounds.
    const hits = serverDoc.queryObjects({
      type: "text",
      textQuery: "leader",
      bounds: { x: 140, y: 190, width: 300, height: 100 },
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe(addedText.object.id);

    const missed = serverDoc.queryObjects({
      type: "text",
      bounds: { x: -500, y: -500, width: 100, height: 100 },
    });
    expect(missed).toHaveLength(0);

    // Delete in one batch.
    const del = serverDoc.deleteObjects([
      addedText.object.id,
      addedStroke.object.id,
      "missing-id",
    ]);
    expect(del.deletedIds).toEqual([
      addedText.object.id,
      addedStroke.object.id,
    ]);
    expect(del.notFoundIds).toEqual(["missing-id"]);
    Y.applyUpdate(peerDoc.ydoc, del.delta);
    expect(peerDoc.getAllObjects()).toHaveLength(0);

    serverDoc.destroy();
    peerDoc.destroy();
  });

  it("rejects updateTextBox for missing or non-text objects", () => {
    const doc = new BoardDoc();
    const { object: stroke } = doc.addStroke({
      points: [{ x: 0, y: 0 }],
    });
    expect(() => doc.updateTextBox({ objectId: "nope", text: "x" })).toThrow(
      /not found/,
    );
    expect(() => doc.updateTextBox({ objectId: stroke.id, text: "x" })).toThrow(
      /not "text"/,
    );
    doc.destroy();
  });
});
