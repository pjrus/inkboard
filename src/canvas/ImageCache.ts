import { assetRepository } from "../storage/assetRepository";

/**
 * LRU cache of decoded page images. Pages are decoded lazily as they come
 * near the viewport and released again when the cache grows past `capacity`,
 * so a 300-page import never has 300 bitmaps resident at once.
 */
export class ImageCache {
  private entries = new Map<string, { bitmap: ImageBitmap; lastUsed: number }>();
  private loading = new Set<string>();
  private missing = new Set<string>();
  private tick = 0;

  constructor(
    private readonly onLoaded: () => void,
    private readonly capacity = 48,
  ) {}

  /** Returns the bitmap if decoded; otherwise kicks off a load and returns undefined. */
  get(assetId: string): ImageBitmap | undefined {
    const e = this.entries.get(assetId);
    if (e) {
      e.lastUsed = ++this.tick;
      return e.bitmap;
    }
    if (!this.loading.has(assetId) && !this.missing.has(assetId)) void this.load(assetId);
    return undefined;
  }

  isMissing(assetId: string): boolean {
    return this.missing.has(assetId);
  }

  /** Forget a "missing" verdict, e.g. after the asset has just been written. */
  invalidate(assetId: string): void {
    this.missing.delete(assetId);
    const e = this.entries.get(assetId);
    if (e) {
      e.bitmap.close();
      this.entries.delete(assetId);
    }
  }

  private async load(assetId: string) {
    this.loading.add(assetId);
    try {
      const rec = await assetRepository.get(assetId);
      if (!rec) {
        this.missing.add(assetId);
        return;
      }
      const bitmap = await createImageBitmap(rec.blob);
      this.entries.set(assetId, { bitmap, lastUsed: ++this.tick });
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
    if (this.entries.size <= this.capacity) return;
    const sorted = Array.from(this.entries.entries()).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    const excess = this.entries.size - this.capacity;
    for (let i = 0; i < excess; i++) {
      const [id, e] = sorted[i];
      e.bitmap.close();
      this.entries.delete(id);
    }
  }

  clear() {
    for (const e of this.entries.values()) e.bitmap.close();
    this.entries.clear();
    this.missing.clear();
  }
}
