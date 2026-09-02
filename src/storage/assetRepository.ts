import { getDB, type AssetRecord } from "./db";

/**
 * Binary asset storage. Assets are addressed by stable ids so a future sync
 * layer can request "the assets referenced by this CRDT document" from peers.
 */
export interface AssetRepository {
  put(asset: AssetRecord): Promise<void>;
  get(id: string): Promise<AssetRecord | undefined>;
  has(id: string): Promise<boolean>;
  listForBoard(boardId: string): Promise<AssetRecord[]>;
  deleteForBoard(boardId: string): Promise<void>;
  delete(ids: string[]): Promise<void>;
  storageUsed(boardId?: string): Promise<number>;
}

export class IndexedDBAssetRepository implements AssetRepository {
  async put(asset: AssetRecord): Promise<void> {
    await getDB().assets.put(asset);
  }
  async get(id: string): Promise<AssetRecord | undefined> {
    return getDB().assets.get(id);
  }
  async has(id: string): Promise<boolean> {
    return (await getDB().assets.where("id").equals(id).count()) > 0;
  }
  async listForBoard(boardId: string): Promise<AssetRecord[]> {
    return getDB().assets.where("boardId").equals(boardId).toArray();
  }
  async deleteForBoard(boardId: string): Promise<void> {
    await getDB().assets.where("boardId").equals(boardId).delete();
  }
  async delete(ids: string[]): Promise<void> {
    await getDB().assets.bulkDelete(ids);
  }
  async storageUsed(boardId?: string): Promise<number> {
    const coll = boardId ? getDB().assets.where("boardId").equals(boardId) : getDB().assets.toCollection();
    let total = 0;
    await coll.each((a) => {
      total += a.size;
    });
    return total;
  }
}

export const assetRepository: AssetRepository = new IndexedDBAssetRepository();
