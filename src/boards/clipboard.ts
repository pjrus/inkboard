import { isImageLikeObject } from "../canvas/transform";
import { newId } from "../document/ids";
import type { CanvasObject } from "../document/schema";
import { type AssetRecord, getDB } from "../storage/db";

/**
 * In-app clipboard for board objects. Deliberately not the system clipboard.
 *
 * Objects are plain JSON, but images point at assets, and assets belong to
 * the board they live on (deleting a board deletes them). So copying also
 * snapshots the bytes of every image asset, and pasting into a different
 * board writes fresh assets owned by that board. A pasted copy therefore
 * never depends on its source board, even if that board is deleted between
 * the copy and the paste.
 */
interface Clip {
  boardId: string;
  objects: CanvasObject[];
  /** Resolves once the image bytes have been read. */
  assets: Promise<AssetRecord[]>;
}

let clip: Clip | null = null;

export function hasClipboard(): boolean {
  return clip !== null;
}

export function copyToClipboard(boardId: string, objects: CanvasObject[]) {
  clip = { boardId, objects, assets: snapshotAssets(objects) };
}

/**
 * Paste into `boardId`. `insert` adds the objects to the document and returns
 * what it created; the next paste cascades from those copies.
 */
export async function pasteClipboard(
  boardId: string,
  insert: (objects: CanvasObject[]) => CanvasObject[],
): Promise<void> {
  const c = clip;
  if (!c) return;
  let objects = c.objects;
  let assets = await c.assets;
  if (c.boardId !== boardId) {
    // Every image gets a new asset id, even one whose bytes are missing, so
    // nothing here can ever resolve to the source board's asset.
    const ids = new Map<string, string>();
    for (const o of objects) {
      if (isImageLikeObject(o) && !ids.has(o.assetId)) {
        ids.set(o.assetId, newId());
      }
    }
    const now = Date.now();
    assets = assets.map((a) => ({
      ...a,
      id: ids.get(a.id)!,
      boardId,
      createdAt: now,
    }));
    await getDB().assets.bulkPut(assets);
    objects = objects.map((o) =>
      isImageLikeObject(o) ? { ...o, assetId: ids.get(o.assetId)! } : o
    );
  }
  const pasted = insert(objects);
  // Leave a newer copy alone if one was made while this paste was waiting.
  if (clip === c && pasted.length) {
    clip = { boardId, objects: pasted, assets: Promise.resolve(assets) };
  }
}

async function snapshotAssets(objects: CanvasObject[]): Promise<AssetRecord[]> {
  const ids = new Set<string>();
  for (const o of objects) if (isImageLikeObject(o)) ids.add(o.assetId);
  if (ids.size === 0) return [];
  const records = await getDB().assets.bulkGet([...ids]);
  return Promise.all(
    records
      .filter((r): r is AssetRecord => r !== undefined)
      .map(async (r) => ({
        ...r,
        // Copy into memory: a Blob read from IndexedDB may be backed by the
        // stored row, which goes away if its board is deleted.
        blob: new Blob([await r.blob.arrayBuffer()], { type: r.mimeType }),
      })),
  );
}
