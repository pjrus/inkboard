import * as Y from "yjs";
import { nanoid } from "nanoid";
import type {
  CanvasObject,
  PDFDocumentMetadata,
  PDFLayout,
  PDFPageObject,
  StrokeObject,
} from "./schema";

/**
 * CanvasDocument wraps a Y.Doc and exposes a typed API for canvas objects.
 *
 * Structure inside the Y.Doc:
 *   metadata     Y.Map<any>                       board-level shared metadata
 *   objects      Y.Map<Y.Map<any>>                id -> object fields
 *   pdfDocuments Y.Map<Y.Map<any>>                id -> PDFDocumentMetadata
 *   settings     Y.Map<any>                       shared settings (unused yet)
 *
 * Each canvas object is its own Y.Map so concurrent edits to different
 * fields (e.g. one peer moves a page while another rotates it) merge cleanly.
 * Stroke points are stored as a plain array: strokes are immutable once
 * committed, so there is no benefit to a Y.Array here and a lot of overhead.
 *
 * All local mutations pass through `transact()` with LOCAL_ORIGIN so the
 * UndoManager only tracks this replica's edits.
 */

export const LOCAL_ORIGIN = Symbol("local");

export type ObjectChange =
  | { kind: "add"; id: string; object: CanvasObject }
  | { kind: "update"; id: string; object: CanvasObject }
  | { kind: "remove"; id: string };

export type ObjectListener = (changes: ObjectChange[], transactionOrigin: unknown) => void;

export class CanvasDocument {
  readonly ydoc: Y.Doc;
  readonly objects: Y.Map<Y.Map<unknown>>;
  readonly pdfDocuments: Y.Map<Y.Map<unknown>>;
  readonly metadata: Y.Map<unknown>;
  readonly settings: Y.Map<unknown>;
  readonly undoManager: Y.UndoManager;

  private listeners = new Set<ObjectListener>();
  private cache = new Map<string, CanvasObject>();

  constructor(ydoc?: Y.Doc) {
    this.ydoc = ydoc ?? new Y.Doc();
    this.objects = this.ydoc.getMap("objects");
    this.pdfDocuments = this.ydoc.getMap("pdfDocuments");
    this.metadata = this.ydoc.getMap("metadata");
    this.settings = this.ydoc.getMap("settings");

    this.undoManager = new Y.UndoManager([this.objects, this.pdfDocuments], {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      // Every logical user action calls stopCapturing() first, so a long
      // timeout here just lets multi-step actions (e.g. an import) coalesce.
      captureTimeout: 1000,
    });

    this.rebuildCache();
    this.objects.observeDeep((events, txn) => this.handleEvents(events, txn));
  }

  // ---- reading -------------------------------------------------------

  /** Snapshot of every object. Returns cached plain objects (cheap). */
  getAll(): CanvasObject[] {
    return Array.from(this.cache.values());
  }

  get(id: string): CanvasObject | undefined {
    return this.cache.get(id);
  }

  getPDFDocument(id: string): PDFDocumentMetadata | undefined {
    const m = this.pdfDocuments.get(id);
    return m ? (m.toJSON() as PDFDocumentMetadata) : undefined;
  }

  getPDFDocuments(): PDFDocumentMetadata[] {
    const out: PDFDocumentMetadata[] = [];
    this.pdfDocuments.forEach((m) => out.push(m.toJSON() as PDFDocumentMetadata));
    return out;
  }

  pagesOf(pdfDocumentId: string): PDFPageObject[] {
    const pages: PDFPageObject[] = [];
    for (const o of this.cache.values()) {
      if (o.type === "pdf-page" && o.pdfDocumentId === pdfDocumentId) pages.push(o);
    }
    pages.sort((a, b) => a.pageNumber - b.pageNumber);
    return pages;
  }

  onChange(listener: ObjectListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---- writing -------------------------------------------------------

  /** Run `fn` as one undoable, locally-originated transaction. */
  transact(fn: () => void, undoable = true): void {
    if (undoable) this.undoManager.stopCapturing();
    this.ydoc.transact(fn, LOCAL_ORIGIN);
    if (undoable) this.undoManager.stopCapturing();
  }

  /**
   * Run `fn` inside an undo capture group that is NOT closed afterwards, so a
   * following call within captureTimeout merges into the same undo item.
   * Used for multi-step operations such as progressive PDF import.
   */
  transactGrouped(fn: () => void): void {
    this.ydoc.transact(fn, LOCAL_ORIGIN);
  }

  addStroke(stroke: Omit<StrokeObject, "id" | "type" | "createdAt"> & { id?: string }): StrokeObject {
    const obj: StrokeObject = {
      ...stroke,
      id: stroke.id ?? nanoid(12),
      type: "stroke",
      createdAt: Date.now(),
    };
    this.transact(() => this.objects.set(obj.id, toYMap(obj)));
    return obj;
  }

  removeObjects(ids: string[], grouped = false): void {
    if (ids.length === 0) return;
    const fn = () => {
      for (const id of ids) this.objects.delete(id);
    };
    if (grouped) this.transactGrouped(fn);
    else this.transact(fn);
  }

  /** Close the current undo capture group (next change starts a new item). */
  closeUndoGroup(): void {
    this.undoManager.stopCapturing();
  }

  /** Insert a PDF document's metadata and all its page objects in one undo step. */
  addPDFDocument(meta: PDFDocumentMetadata, pages: PDFPageObject[]): void {
    this.transact(() => {
      this.pdfDocuments.set(meta.id, toYMap(meta));
      for (const p of pages) this.objects.set(p.id, toYMap(p));
    });
  }

  updateObject(id: string, patch: Record<string, unknown>, undoable = true): void {
    const m = this.objects.get(id);
    if (!m) return;
    this.transact(() => {
      for (const [k, v] of Object.entries(patch)) m.set(k, v);
    }, undoable);
  }

  /** Move a set of objects by a world-space delta in one undo step. */
  translateObjects(ids: string[], dx: number, dy: number): void {
    this.transact(() => {
      for (const id of ids) {
        const m = this.objects.get(id);
        if (!m) continue;
        const type = m.get("type");
        if (type === "pdf-page" || type === "text") {
          m.set("x", (m.get("x") as number) + dx);
          m.set("y", (m.get("y") as number) + dy);
        }
      }
    });
  }

  setPDFLayout(pdfDocumentId: string, layout: PDFLayout, positions: { id: string; x: number; y: number }[]): void {
    const meta = this.pdfDocuments.get(pdfDocumentId);
    if (!meta) return;
    this.transact(() => {
      meta.set("layout", layout);
      for (const pos of positions) {
        const m = this.objects.get(pos.id);
        if (!m) continue;
        m.set("x", pos.x);
        m.set("y", pos.y);
      }
    });
  }

  removePDFDocument(pdfDocumentId: string): void {
    const pages = this.pagesOf(pdfDocumentId);
    this.transact(() => {
      for (const p of pages) this.objects.delete(p.id);
      this.pdfDocuments.delete(pdfDocumentId);
    });
  }

  undo(): void {
    this.undoManager.undo();
  }

  redo(): void {
    this.undoManager.redo();
  }

  canUndo(): boolean {
    return this.undoManager.canUndo();
  }

  canRedo(): boolean {
    return this.undoManager.canRedo();
  }

  // ---- sync helpers --------------------------------------------------

  encodeState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc);
  }

  applyUpdate(update: Uint8Array, origin: unknown = "remote"): void {
    Y.applyUpdate(this.ydoc, update, origin);
  }

  destroy(): void {
    this.undoManager.destroy();
    this.ydoc.destroy();
    this.listeners.clear();
  }

  // ---- internals -----------------------------------------------------

  private rebuildCache() {
    this.cache.clear();
    this.objects.forEach((m, id) => this.cache.set(id, m.toJSON() as CanvasObject));
  }

  private handleEvents(events: Y.YEvent<any>[], txn: Y.Transaction) {
    const changes: ObjectChange[] = [];
    const touched = new Set<string>();
    for (const ev of events) {
      if (ev.target === this.objects) {
        ev.changes.keys.forEach((change, id) => {
          if (change.action === "delete") {
            this.cache.delete(id);
            changes.push({ kind: "remove", id });
          } else {
            const m = this.objects.get(id);
            if (!m) return;
            const obj = m.toJSON() as CanvasObject;
            this.cache.set(id, obj);
            changes.push({ kind: change.action === "add" ? "add" : "update", id, object: obj });
          }
          touched.add(id);
        });
      } else {
        // Nested change inside an object's Y.Map (e.g. page moved).
        const path = ev.path;
        const id = path[0];
        if (typeof id === "string" && !touched.has(id)) {
          const m = this.objects.get(id);
          if (m) {
            const obj = m.toJSON() as CanvasObject;
            this.cache.set(id, obj);
            changes.push({ kind: "update", id, object: obj });
            touched.add(id);
          }
        }
      }
    }
    if (changes.length) for (const l of this.listeners) l(changes, txn.origin);
  }
}

function toYMap(obj: object): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) m.set(k, v);
  return m;
}
