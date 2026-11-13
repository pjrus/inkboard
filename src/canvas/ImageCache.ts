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
  private pass = 0;
  private lastPass = new Map<string, number>();
  private generation = 0;

  constructor(
    private readonly onLoaded: () => void,
    private readonly capacity = 48,
  ) {}

  /** Mark the start of a render pass so visible images are never evicted mid-frame. */
  beginPass(): void {
    this.pass++;
  }

  /** Returns the bitmap if decoded; otherwise kicks off a load and returns undefined. */
  get(assetId: string): ImageBitmap | undefined {
    if (this.pass > 0) this.lastPass.set(assetId, this.pass);
    const bitmap = this.entries.get(assetId);
    if (bitmap) {
      this.entries.delete(assetId);
      this.entries.set(assetId, bitmap);
      return bitmap;
    }
    if (!this.loading.has(assetId) && !this.missing.has(assetId)) {
      void this.load(assetId, this.generation);
    }
    return undefined;
  }

  isMissing(assetId: string): boolean {
    return this.missing.has(assetId);
  }

  /** Forget a "missing" verdict, e.g. after the asset has just been written. */
  invalidate(assetId: string): void {
    this.generation++;
    this.missing.delete(assetId);
    this.entries.get(assetId)?.close();
    this.entries.delete(assetId);
    this.lastPass.delete(assetId);
  }

  private async load(assetId: string, gen: number) {
    this.loading.add(assetId);
    try {
      const rec = await getDB().assets.get(assetId);
      if (gen !== this.generation) return;
      if (!rec) {
        this.missing.add(assetId);
        return;
      }
      const bitmap = await createImageBitmap(rec.blob);
      if (gen !== this.generation) {
        bitmap.close();
        return;
      }
      this.entries.set(assetId, bitmap);
      this.evict();
      this.onLoaded();
    } catch (err) {
      if (gen !== this.generation) return;
      console.error("Failed to decode asset", assetId, err);
      this.missing.add(assetId);
    } finally {
      this.loading.delete(assetId);
    }
  }

  private evict() {
    for (const [id, bitmap] of this.entries) {
      if (this.entries.size <= this.capacity) return;
      // Never evict images drawn in the active render pass; otherwise zooming
      // out past `capacity` pages would thrash IndexedDB every frame.
      if (this.pass > 0 && this.lastPass.get(id) === this.pass) continue;
      bitmap.close();
      this.entries.delete(id);
      this.lastPass.delete(id);
    }
  }

  clear() {
    this.generation++;
    for (const b of this.entries.values()) b.close();
    this.entries.clear();
    this.missing.clear();
    this.lastPass.clear();
  }
}
