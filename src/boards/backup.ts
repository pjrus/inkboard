import * as Y from "yjs";
import { CanvasDocument } from "../document/crdt";
import { newId } from "../document/ids";
import type { Viewport } from "../document/schema";
import { type AssetRecord, type BoardRecord, getDB } from "../storage/db";

/**
 * Single-file board backup (`.inkboard`).
 *
 *   "INKBOARD1"  9 bytes of magic (the digit is the format version)
 *   u32 (LE)     length of the JSON header
 *   header       JSON: board metadata, update length, asset list
 *   payload      the merged Yjs update, then each asset's bytes, in header order
 *
 * Bytes stay binary (no base64), and Blob slices keep a large PDF from being
 * copied into memory more than once.
 */
const MAGIC = "INKBOARD1";
const MAGIC_BYTES = new TextEncoder().encode(MAGIC);

interface Header {
  board: { name: string; createdAt: number; viewport?: Viewport; };
  updateLength: number;
  assets: {
    id: string;
    mimeType: string;
    length: number;
    width?: number;
    height?: number;
    createdAt: number;
  }[];
}

export async function exportBoard(boardId: string): Promise<Blob> {
  const db = getDB();
  const [board, rows, assets] = await Promise.all([
    db.boards.get(boardId),
    db.updates.where("boardId").equals(boardId).sortBy("id"),
    db.assets.where("boardId").equals(boardId).toArray(),
  ]);
  if (!board) throw new Error("Board not found");
  const update = Y.mergeUpdates(rows.map((r) => r.update));
  const header: Header = {
    board: {
      name: board.name,
      createdAt: board.createdAt,
      viewport: board.viewport,
    },
    updateLength: update.byteLength,
    assets: assets.map((a) => ({
      id: a.id,
      mimeType: a.mimeType,
      length: a.blob.size,
      width: a.width,
      height: a.height,
      createdAt: a.createdAt,
    })),
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, json.byteLength, true);
  return new Blob([
    MAGIC_BYTES,
    length,
    json,
    update.slice(),
    ...assets.map((a) => a.blob),
  ], { type: "application/octet-stream" });
}

/**
 * Restore a backup as a NEW board; it never overwrites an existing one.
 * Asset ids are global keys and live inside the document, so they are
 * rewritten, otherwise restoring a backup of a board that still exists
 * would steal that board's assets.
 */
export async function importBoard(file: Blob): Promise<BoardRecord> {
  const fixed = MAGIC_BYTES.length + 4;
  const head = new Uint8Array(await file.slice(0, fixed).arrayBuffer());
  if (
    MAGIC !== new TextDecoder().decode(head.subarray(0, MAGIC_BYTES.length))
  ) {
    throw new Error("Not an Inkboard backup file");
  }
  const headerLength = new DataView(head.buffer).getUint32(
    MAGIC_BYTES.length,
    true,
  );
  let header: Header;
  try {
    header = JSON.parse(await file.slice(fixed, fixed + headerLength).text());
  } catch {
    throw new Error("Backup file is corrupt");
  }
  let offset = fixed + headerLength;
  const take = (length: number) => {
    if (
      !Number.isInteger(length) || length < 0 || offset + length > file.size
    ) {
      throw new Error("Backup file is truncated");
    }
    const part = file.slice(offset, offset + length);
    offset += length;
    return part;
  };

  const boardId = newId(10);
  const ids = new Map<string, string>();
  const remap = (id: string) => {
    if (!ids.has(id)) ids.set(id, newId());
    return ids.get(id)!;
  };

  const doc = new CanvasDocument();
  doc.applyUpdate(
    new Uint8Array(await take(header.updateLength).arrayBuffer()),
  );
  doc.ydoc.transact(() => {
    for (const obj of doc.objects.values()) {
      const assetId = obj.get("assetId");
      if (typeof assetId === "string") obj.set("assetId", remap(assetId));
    }
    for (const meta of doc.pdfDocuments.values()) {
      const source = meta.get("sourceAssetId");
      if (typeof source === "string") meta.set("sourceAssetId", remap(source));
    }
  });
  const update = Y.encodeStateAsUpdate(doc.ydoc);
  doc.destroy();

  const now = Date.now();
  const assets: AssetRecord[] = header.assets.map((a) => {
    const blob = take(a.length).slice(0, a.length, a.mimeType);
    return {
      id: remap(a.id),
      boardId,
      mimeType: a.mimeType,
      blob,
      width: a.width,
      height: a.height,
      size: blob.size,
      createdAt: a.createdAt ?? now,
    };
  });
  const board: BoardRecord = {
    id: boardId,
    name: header.board.name,
    createdAt: header.board.createdAt,
    updatedAt: now,
    viewport: header.board.viewport,
  };
  const db = getDB();
  await db.transaction("rw", db.boards, db.updates, db.assets, async () => {
    await db.boards.add(board);
    await db.updates.add({ boardId, update, createdAt: now });
    await db.assets.bulkAdd(assets);
  });
  navigator.storage?.persist?.().catch(() => {});
  return board;
}

export function downloadBoardBackup(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${
    name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "board"
  }.inkboard`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
