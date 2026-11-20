import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InkboardFileBackend } from "../backend/InkboardFileBackend.js";
import { BoardDoc } from "../crdt.js";

async function writeSampleArchive(filePath: string): Promise<void> {
  const doc = new BoardDoc();
  doc.setBackground("#ffffff");
  doc.addTextBox({ x: 20, y: 30, text: "Offline Note" });
  const update = doc.encodeState();
  doc.destroy();

  const header = {
    version: 1,
    boards: [
      {
        name: "Offline Board",
        createdAt: 1000,
        updatedAt: 2000,
        updateSize: update.byteLength,
        assets: [],
      },
    ],
  };
  const jsonBuf = Buffer.from(JSON.stringify(header), "utf8");
  const preamble = Buffer.alloc(12);
  preamble.write("INKBOARD", 0, "ascii");
  preamble.writeUInt32LE(jsonBuf.byteLength, 8);
  await writeFile(filePath, Buffer.concat([preamble, jsonBuf, update]));
}

describe("InkboardFileBackend (.inkboard offline archives)", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    while (dirs.length) {
      await rm(dirs.pop()!, { recursive: true, force: true });
    }
  });

  it("reads, queries, and mutates boards inside a .inkboard archive", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "inkboard-archive-"));
    dirs.push(dir);
    const archivePath = path.join(dir, "backup.inkboard");
    await writeSampleArchive(archivePath);

    const backend = new InkboardFileBackend({ rootPath: dir });
    const boards = await backend.listBoards();
    expect(boards).toHaveLength(1);
    expect(boards[0].id).toBe("backup.inkboard#0");
    expect(boards[0].objectCounts.text).toBe(1);

    const added = await backend.addTextBox("backup.inkboard#0", {
      x: 50,
      y: 90,
      text: "Added Offline",
    });
    expect(added.text).toBe("Added Offline");

    // Re-open with a fresh backend instance to verify atomic persistence.
    const reloaded = new InkboardFileBackend({
      rootPath: archivePath,
      isFile: true,
      readOnly: true,
    });
    const summary = await reloaded.getBoardSummary("backup.inkboard#0");
    expect(summary.textBoxes.map((t) => t.text)).toEqual([
      "Offline Note",
      "Added Offline",
    ]);

    await expect(
      reloaded.addTextBox("backup.inkboard#0", { x: 0, y: 0, text: "Blocked" }),
    ).rejects.toThrow(/--read-only/);
  });
});
