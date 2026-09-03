import * as Y from "yjs";
import { newId } from "./ids";
import { nextWidthStep } from "./strokeCommands";
import { nextFontSizeStep } from "../text/textCommands";
import { computeBoundsFlat } from "../canvas/strokeGeometry";
import { objectCenter, rotatePoint } from "../canvas/transform";
import type {
  CanvasObject,
  PDFDocumentMetadata,
  PDFLayout,
  PDFPageObject,
  StrokeObject,
  TextObject,
} from "./schema";

/**
 * CanvasDocument wraps a Y.Doc and exposes a typed API for canvas objects.
 *
 * Structure inside the Y.Doc:
 *   objects      Y.Map<Y.Map<any>>                id -> object fields
 *   pdfDocuments Y.Map<Y.Map<any>>                id -> PDFDocumentMetadata
 *
 * Each canvas object is its own Y.Map so concurrent edits to different
 * fields (e.g. one peer moves a page while another rotates it) merge cleanly.
 * Stroke points are stored as a plain array: strokes are immutable once
 * committed, so there is no benefit to a Y.Array here and a lot of overhead.
 * A text object's `text` field is the exception: it is a Y.Text, so two
 * replicas typing into the same box merge character by character instead of
 * overwriting each other's string.
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
  readonly undoManager: Y.UndoManager;

  private listeners = new Set<ObjectListener>();
  private cache = new Map<string, CanvasObject>();

  constructor(ydoc?: Y.Doc) {
    this.ydoc = ydoc ?? new Y.Doc();
    this.objects = this.ydoc.getMap("objects");
    this.pdfDocuments = this.ydoc.getMap("pdfDocuments");

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
      id: stroke.id ?? newId(),
      type: "stroke",
      createdAt: Date.now(),
    };
    this.transact(() => this.objects.set(obj.id, toYMap(obj)));
    return obj;
  }

  /**
   * Create a text box. The initial content is a Y.Text so later edits are
   * collaborative splices rather than whole-string replacements.
   */
  addText(
    input: Omit<TextObject, "id" | "type" | "createdAt" | "updatedAt"> & { id?: string },
    grouped = false,
  ): TextObject {
    const now = Date.now();
    const obj: TextObject = { ...input, id: input.id ?? newId(), type: "text", createdAt: now, updatedAt: now };
    const fn = () => {
      const m = toYMap({ ...obj, text: undefined });
      const ytext = new Y.Text();
      if (obj.text) ytext.insert(0, obj.text);
      m.set("text", ytext);
      this.objects.set(obj.id, m);
    };
    // `grouped` lets "create a box, then type into it" become one undo step.
    if (grouped) this.transactGrouped(fn);
    else this.transact(fn);
    return obj;
  }

  /** The live Y.Text behind a text object, for the inline editor to bind to. */
  getTextHandle(id: string): Y.Text | undefined {
    const m = this.objects.get(id);
    if (!m || m.get("type") !== "text") return undefined;
    const t = m.get("text");
    return t instanceof Y.Text ? t : undefined;
  }

  /**
   * Apply an editor splice to a text box.
   *
   * Deliberately *not* wrapped in `transact()`: leaving the undo capture group
   * open lets the UndoManager coalesce a burst of typing into one undo item
   * instead of one per keystroke. `closeUndoGroup()` ends the burst.
   */
  editText(id: string, edit: (text: Y.Text) => void): void {
    const ytext = this.getTextHandle(id);
    if (!ytext) return;
    this.transactGrouped(() => edit(ytext));
  }

  /** Stamp `updatedAt` without starting a new undo step. */
  touchText(id: string): void {
    const m = this.objects.get(id);
    if (!m || m.get("type") !== "text") return;
    this.transactGrouped(() => m.set("updatedAt", Date.now()));
  }

  /** Apply text properties (font, size, colour, alignment, width) in one undo step. */
  setTextProperties(ids: string[], patch: Partial<Pick<TextObject, "fontFamily" | "fontSize" | "color" | "textAlign" | "width">>): void {
    if (ids.length === 0) return;
    const now = Date.now();
    this.transact(() => {
      for (const id of ids) {
        const m = this.objects.get(id);
        if (!m || m.get("type") !== "text") continue;
        for (const [k, v] of Object.entries(patch)) if (v !== undefined) m.set(k, v);
        m.set("updatedAt", now);
      }
    });
  }

  /** Step each text box's size to the next/previous preset, in one undo step. */
  adjustTextFontSizes(ids: string[], direction: 1 | -1): void {
    const now = Date.now();
    this.transact(() => {
      for (const id of ids) {
        const m = this.objects.get(id);
        if (!m || m.get("type") !== "text") continue;
        m.set("fontSize", nextFontSizeStep(m.get("fontSize") as number, direction));
        m.set("updatedAt", now);
      }
    });
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

  /** Apply the same field patch to many objects in one undo step. */
  updateObjects(ids: string[], patch: Record<string, unknown>): void {
    if (ids.length === 0) return;
    this.transact(() => {
      for (const id of ids) {
        const m = this.objects.get(id);
        if (!m) continue;
        for (const [k, v] of Object.entries(patch)) m.set(k, v);
      }
    });
  }

  /** Set the base width of the given strokes (bounds are recomputed). */
  setStrokeWidth(ids: string[], width: number): void {
    this.transact(() => {
      for (const id of ids) {
        const m = this.objects.get(id);
        if (!m || m.get("type") !== "stroke") continue;
        m.set("width", width);
        m.set("bounds", computeBoundsFlat(m.get("points") as number[], width));
      }
    });
  }

  /** Step every stroke's width to the next/previous preset relative to its own width. */
  adjustStrokeWidths(ids: string[], direction: 1 | -1): void {
    this.transact(() => {
      for (const id of ids) {
        const m = this.objects.get(id);
        if (!m || m.get("type") !== "stroke") continue;
        const width = nextWidthStep(m.get("width") as number, direction);
        m.set("width", width);
        m.set("bounds", computeBoundsFlat(m.get("points") as number[], width));
      }
    });
  }

  /**
   * Move any mix of strokes, text boxes and imported pages by a world-space
   * delta, as one undo step.
   *
   * This is the only translation command in the app: the lasso, a page drag
   * and the keyboard all route through it, so every object type's idea of
   * "where it is" is understood in exactly one place. Strokes move by
   * rewriting their points - once, on commit, never per pointer frame.
   */
  translateObjects(ids: string[], dx: number, dy: number): void {
    if (ids.length === 0 || (dx === 0 && dy === 0)) return;
    this.transact(() => {
      for (const id of ids) this.applyTranslation(id, dx, dy);
    });
  }

  /**
   * Rotate objects by `angleDelta` radians about a shared world-space pivot,
   * as one undo step.
   *
   * Each object's centre orbits the pivot and its own rotation advances by the
   * same delta, so a group keeps its arrangement instead of every member
   * spinning in place. Strokes have no rotation field: their points are
   * rotated about the pivot directly (see canvas/transform.ts for why).
   */
  rotateObjects(ids: string[], angleDelta: number, pivot: { x: number; y: number }): void {
    if (ids.length === 0 || angleDelta === 0) return;
    const now = Date.now();
    this.transact(() => {
      for (const id of ids) {
        const m = this.objects.get(id);
        const obj = this.get(id);
        if (!m || !obj) continue;
        if (obj.type === "stroke") {
          const pts = (m.get("points") as number[]).slice();
          const cos = Math.cos(angleDelta);
          const sin = Math.sin(angleDelta);
          for (let i = 0; i + 2 < pts.length; i += 3) {
            const x = pts[i] - pivot.x;
            const y = pts[i + 1] - pivot.y;
            pts[i] = pivot.x + x * cos - y * sin;
            pts[i + 1] = pivot.y + x * sin + y * cos;
          }
          m.set("points", pts);
          m.set("bounds", computeBoundsFlat(pts, m.get("width") as number));
        } else {
          const centre = objectCenter(obj);
          const moved = rotatePoint(centre, pivot, angleDelta);
          m.set("x", (m.get("x") as number) + (moved.x - centre.x));
          m.set("y", (m.get("y") as number) + (moved.y - centre.y));
          m.set("rotation", ((m.get("rotation") as number) ?? 0) + angleDelta);
          if (obj.type === "text") m.set("updatedAt", now);
        }
      }
    });
  }

  private applyTranslation(id: string, dx: number, dy: number): void {
    const m = this.objects.get(id);
    if (!m) return;
    if (m.get("type") === "stroke") {
      const pts = (m.get("points") as number[]).slice();
      for (let i = 0; i + 2 < pts.length; i += 3) {
        pts[i] += dx;
        pts[i + 1] += dy;
      }
      const b = m.get("bounds") as { minX: number; minY: number; maxX: number; maxY: number };
      m.set("points", pts);
      m.set("bounds", { minX: b.minX + dx, minY: b.minY + dy, maxX: b.maxX + dx, maxY: b.maxY + dy });
      return;
    }
    m.set("x", (m.get("x") as number) + dx);
    m.set("y", (m.get("y") as number) + dy);
    if (m.get("type") === "text") m.set("updatedAt", Date.now());
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
