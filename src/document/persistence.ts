import * as Y from "yjs";
import { getDB } from "../storage/db";
import type { CanvasDocument } from "./crdt";

/**
 * Incremental CRDT persistence.
 *
 * Every Yjs update emitted by the document is queued and flushed to the
 * `updates` table on a short debounce. Drawing never waits on IndexedDB: the
 * in-memory doc is the source of truth and the write happens afterwards.
 *
 * When the number of stored update rows grows past COMPACT_THRESHOLD, the
 * rows are merged into one snapshot row inside a single transaction, so a
 * crash mid-compaction can never lose data.
 */

export type SaveStatus = "idle" | "saving" | "saved" | "error";

const FLUSH_DELAY_MS = 120;
const COMPACT_THRESHOLD = 300;

export class DocumentPersistence {
  private queue: Uint8Array[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private unsubscribe: (() => void) | null = null;
  private statusListeners = new Set<(s: SaveStatus) => void>();
  private _status: SaveStatus = "idle";
  private destroyed = false;

  constructor(
    private readonly boardId: string,
    private readonly doc: CanvasDocument,
  ) {}

  get status() {
    return this._status;
  }

  onStatus(fn: (s: SaveStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  /** Load all persisted updates into the document. */
  async load(): Promise<{ updateCount: number }> {
    const rows = await getDB().updates.where("boardId").equals(this.boardId).toArray();
    rows.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    let applied = 0;
    for (const row of rows) {
      try {
        Y.applyUpdate(this.doc.ydoc, row.update, "persistence");
        applied++;
      } catch (err) {
        // A corrupted row must not destroy the board: skip it and carry on.
        console.error("Skipping corrupt CRDT update row", row.id, err);
      }
    }
    if (rows.length > COMPACT_THRESHOLD) void this.compact();
    return { updateCount: applied };
  }

  /** Start listening for local changes and persisting them. */
  start(): void {
    const handler = (update: Uint8Array, origin: unknown) => {
      if (origin === "persistence") return; // came from load()
      this.queue.push(update);
      this.schedule();
    };
    this.doc.ydoc.on("update", handler);
    this.unsubscribe = () => this.doc.ydoc.off("update", handler);
  }

  private schedule() {
    this.setStatus("saving");
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, FLUSH_DELAY_MS);
  }

  /** Write everything queued so far. Safe to call at any time. */
  async flush(): Promise<void> {
    if (this.flushing) {
      await this.flushing;
    }
    if (this.queue.length === 0) {
      if (this._status === "saving") this.setStatus("saved");
      return;
    }
    const batch = this.queue;
    this.queue = [];
    const merged = batch.length === 1 ? batch[0] : Y.mergeUpdates(batch);
    this.flushing = (async () => {
      try {
        const db = getDB();
        await db.transaction("rw", db.updates, db.boards, async () => {
          await db.updates.add({ boardId: this.boardId, update: merged, createdAt: Date.now() });
          await db.boards.update(this.boardId, { updatedAt: Date.now() });
        });
        if (this.queue.length === 0) this.setStatus("saved");
        const count = await db.updates.where("boardId").equals(this.boardId).count();
        if (count > COMPACT_THRESHOLD) await this.compact();
      } catch (err) {
        console.error("Failed to persist CRDT update", err);
        // Put the batch back so the next flush retries it.
        this.queue.unshift(merged);
        this.setStatus("error");
      } finally {
        this.flushing = null;
      }
    })();
    await this.flushing;
    if (this.queue.length && !this.destroyed) this.schedule();
  }

  /** Merge all stored update rows into one. Atomic. */
  async compact(): Promise<void> {
    const db = getDB();
    await db.transaction("rw", db.updates, async () => {
      const rows = await db.updates.where("boardId").equals(this.boardId).toArray();
      if (rows.length < 2) return;
      rows.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
      const merged = Y.mergeUpdates(rows.map((r) => r.update));
      await db.updates.bulkDelete(rows.map((r) => r.id!));
      await db.updates.add({ boardId: this.boardId, update: merged, createdAt: Date.now() });
    });
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.unsubscribe?.();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
    this.statusListeners.clear();
  }

  private setStatus(s: SaveStatus) {
    if (s === this._status) return;
    this._status = s;
    for (const l of this.statusListeners) l(s);
  }
}
