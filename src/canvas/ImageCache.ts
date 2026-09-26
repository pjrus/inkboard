import { getDB } from "../storage/db";

/**
 * LRU cache of decoded page images. Pages are decoded lazily as they come
 * near the viewport and released again when the cache grows past `capacity`,
 * so a 300-page import never has 300 bitmaps resident at once.
 */
export class ImageCache {
  /** Insertion order is recency order: a hit re-inserts, eviction takes the first. */
  private entries = new Map<string, ImageBitmap>();
  private loading = new Set<string>();
  private missing = new Set<string>();

  constructor(
    private readonly onLoaded: () => void,
    private readonly capacity = 48,
  ) {}

  /** Returns the bitmap if decoded; otherwise kicks off a load and returns undefined. */
  get(assetId: string): ImageBitmap | undefined {
    const bitmap = this.entries.get(assetId);
    if (bitmap) {
      this.entries.delete(assetId);
      this.entries.set(assetId, bitmap);
      return bitmap;
    }
    if (!this.loading.has(assetId) && !this.missing.has(assetId)) {
      void this.load(assetId);
    }
    return undefined;
  }

  isMissing(assetId: string): boolean {
    return this.missing.has(assetId);
  }

  /** Forget a "missing" verdict, e.g. after the asset has just been written. */
  invalidate(assetId: string): void {
    this.missing.delete(assetId);
    this.entries.get(assetId)?.close();
    this.entries.delete(assetId);
  }

  private async load(assetId: string) {
    this.loading.add(assetId);
    try {
      const rec = await getDB().assets.get(assetId);
      if (!rec) {
        this.missing.add(assetId);
        return;
      }
      const bitmap = await createImageBitmap(rec.blob);
      this.entries.set(assetId, bitmap);
      this.evict();
      this.onLoaded();
    } catch (err) {
      console.error("Failed to decode asset", assetId, err);
      this.missing.add(assetId);
    } finally {
      this.loading.delete(assetId);
    }
  }

  private evict() {
    for (const [id, bitmap] of this.entries) {
      if (this.entries.size <= this.capacity) return;
      bitmap.close();
      this.entries.delete(id);
    }
  }

  clear() {
    for (const b of this.entries.values()) b.close();
    this.entries.clear();
    this.missing.clear();
  }
}
