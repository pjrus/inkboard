import * as Y from "yjs";
import { CanvasDocument } from "../document/crdt";
import { newId } from "../document/ids";
import { DocumentPersistence } from "../document/persistence";
import {
  type AssetRecord,
  type BoardRecord,
  getDB,
  type UpdateRecord,
} from "../storage/db";

/**
 * Backup and restore of every board as one `.inkboard` file.
 *
 * Layout: the 8 ASCII bytes "INKBOARD", a little-endian uint32 header length,
 * the JSON header, then raw segments back to back. For each board in header
 * order: its Yjs state, then each of its assets. Assets stay binary (no
 * base64), and restore slices them straight out of the file, so a backup full
 * of PDF pages is never held in memory twice.
 *
 * Only assets the document still references are written. Restore always adds
 * new boards with fresh board and asset ids, so restoring a backup next to the
 * board it came from can never overwrite or share that board's assets.
 */

const MAGIC = "INKBOARD";
const PREAMBLE = MAGIC.length + 4;
const VERSION = 1;

interface BackupHeader {
  version: number;
  boards: {
    name: string;
    createdAt: number;
    updatedAt: number;
    updateSize: number;
    assets: Omit<AssetRecord, "boardId" | "blob">[];
  }[];
}

export async function backupBoards(): Promise<Blob> {
  const db = getDB();
  const header: BackupHeader = { version: VERSION, boards: [] };
  const segments: BlobPart[] = [];
  for (const board of await db.boards.toArray()) {
    const doc = new CanvasDocument();
    await new DocumentPersistence(board.id, doc).load();
    // Yjs never hands out a SharedArrayBuffer.
    const update = Y.encodeStateAsUpdate(doc.ydoc) as Uint8Array<ArrayBuffer>;
    const ids = new Set(assetRefs(doc).map((r) => r.id));
    doc.destroy();
    // A page whose import never finished has no asset; skip it, as export does.
    const assets = (await db.assets.bulkGet([...ids])).filter(
      (a): a is AssetRecord => a !== undefined,
    );
    header.boards.push({
      name: board.name,
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
      updateSize: update.byteLength,
      assets: assets.map(({ boardId: _, blob, ...a }) => ({
        ...a,
        size: blob.size,
      })),
    });
    segments.push(update, ...assets.map((a) => a.blob));
  }
  const json = new TextEncoder().encode(JSON.stringify(header));
  const preamble = new Uint8Array(PREAMBLE);
  preamble.set(new TextEncoder().encode(MAGIC));
  new DataView(preamble.buffer).setUint32(MAGIC.length, json.byteLength, true);
  return new Blob([preamble, json, ...segments], {
    type: "application/octet-stream",
  });
}

/** Adds every board in the backup as a new board. Returns how many. */
export async function restoreBoards(file: Blob): Promise<number> {
  const preamble = new Uint8Array(await file.slice(0, PREAMBLE).arrayBuffer());
  if (
    preamble.byteLength < PREAMBLE
    || new TextDecoder().decode(preamble.subarray(0, MAGIC.length)) !== MAGIC
  ) {
    throw new Error("Not an Inkboard backup");
  }
  let offset = PREAMBLE
    + new DataView(preamble.buffer).getUint32(MAGIC.length, true);
  const header = JSON.parse(
    await file.slice(PREAMBLE, offset).text(),
  ) as BackupHeader;
  if (header.version !== VERSION) {
    throw new Error(`Unsupported backup version ${header.version}`);
  }
  let end = offset;
  for (const b of header.boards) {
    end += b.updateSize;
    for (const a of b.assets) end += a.size;
  }
  // Negated so a malformed size (NaN) is rejected too.
  if (!(end <= file.size)) throw new Error("Backup file is incomplete");

  const next = (size: number, type?: string) => {
    const blob = file.slice(offset, offset + size, type);
    offset += size;
    return blob;
  };
  const now = Date.now();
  const boards: BoardRecord[] = [];
  const updates: UpdateRecord[] = [];
  const assets: AssetRecord[] = [];
  for (const b of header.boards) {
    const boardId = newId(10);
    const doc = new CanvasDocument();
    Y.applyUpdate(
      doc.ydoc,
      new Uint8Array(await next(b.updateSize).arrayBuffer()),
    );
    // Every reference gets a fresh id, even one whose bytes are missing, so
    // nothing can resolve to an asset owned by another board.
    const ids = new Map<string, string>();
    doc.ydoc.transact(() => {
      for (const r of assetRefs(doc)) {
        if (!ids.has(r.id)) ids.set(r.id, newId());
        r.map.set(r.key, ids.get(r.id));
      }
    });
    updates.push({
      boardId,
      update: Y.encodeStateAsUpdate(doc.ydoc),
      createdAt: now,
    });
    doc.destroy();
    for (const a of b.assets) {
      const blob = next(a.size, a.mimeType);
      const id = ids.get(a.id);
      if (id) assets.push({ ...a, id, boardId, blob });
    }
    boards.push({
      id: boardId,
      name: String(b.name),
      createdAt: Number(b.createdAt) || now,
      updatedAt: Number(b.updatedAt) || now,
    });
  }

  // One transaction: a restore that fails part-way leaves nothing behind.
  const db = getDB();
  await db.transaction("rw", db.boards, db.updates, db.assets, async () => {
    await db.boards.bulkAdd(boards);
    await db.updates.bulkAdd(updates);
    await db.assets.bulkAdd(assets);
  });
  navigator.storage?.persist?.().catch(() => {});
  return boards.length;
}

/** Every field in the document that names an asset in the `assets` table. */
function assetRefs(doc: CanvasDocument) {
  const refs: { map: Y.Map<unknown>; key: string; id: string; }[] = [];
  const fields = [
    [doc.objects, "assetId"],
    [doc.pdfDocuments, "sourceAssetId"],
  ] as const;
  for (const [maps, key] of fields) {
    for (const map of maps.values()) {
      const id = map.get(key);
      if (typeof id === "string") refs.push({ map, key, id });
    }
  }
  return refs;
}
