import type { CanvasDocument } from "../document/crdt";
import {
  unpackPoints,
  type Bounds,
  type PDFPageObject,
  type PenTool,
  type StrokeObject,
  type StrokePoint,
  type TextObject,
  type Viewport,
} from "../document/schema";
import { canvasFont } from "../text/fonts";
import { measureText, onTextMeasurementsInvalidated, textBounds } from "../text/textMeasure";
import { canvasTheme, type CanvasTheme } from "../theme/canvasTheme";
import { boundsIntersect, DEFAULT_VIEWPORT, visibleWorldBounds } from "./coordinates";
import { ImageCache } from "./ImageCache";
import { strokeOutline, type XY } from "./strokeGeometry";
import { boundsCenter, objectCenter, pointsBounds, rectContains, rotatePoint, rotationOf, transformedBounds, unionBounds } from "./transform";

const OVERSCAN_PX = 200;
/** Screen-space size of the width-resize grip on a selected text box. */
export const TEXT_HANDLE_PX = 10;
/** Screen-space radius of the rotation grip (generous, for finger and stylus). */
export const ROTATE_HANDLE_PX = 22;
/** How far above the selection the rotation grip floats, in screen pixels. */
const ROTATE_HANDLE_OFFSET_PX = 34;

/**
 * A transform being previewed on the current selection.
 *
 * Purely transient: the CRDT hears about a move or a rotation once, when the
 * gesture ends, so a drag is one undo step and not one per pointer frame.
 */
export interface SelectionPreview {
  dx: number;
  dy: number;
  /** Radians about `pivot`. */
  angle: number;
  pivot: XY;
}

export interface ActiveStroke {
  points: StrokePoint[];
  tool: PenTool;
  color: string;
  width: number;
  hasPressure: boolean;
}

export interface EraserCursor {
  x: number;
  y: number;
  radius: number;
}

/**
 * Imperative renderer over two stacked <canvas> elements:
 *
 *   static  - background, PDF pages, committed strokes, text boxes (redrawn on
 *             viewport/document/theme change only)
 *   overlay - the stroke being drawn, eraser cursor, lasso outline
 *             (redrawn per pointer frame; cheap)
 *
 * Both are driven by requestAnimationFrame; multiple invalidations within a
 * frame collapse into one draw. Stroke outlines are cached as Path2D in world
 * units so a pan/zoom is a transform change plus a fill per visible stroke.
 * Text layout is cached in text/textMeasure.ts on the same principle.
 *
 * Draw order matches LAYER in schema.ts: pages, then ink, then text, so typed
 * annotations always sit on top of an imported page without touching it.
 */
export class CanvasRenderer {
  readonly imageCache: ImageCache;

  private staticCtx: CanvasRenderingContext2D;
  private overlayCtx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private viewport: Viewport = DEFAULT_VIEWPORT;
  private theme: CanvasTheme = canvasTheme("light");

  private pages: PDFPageObject[] = [];
  private strokes: StrokeObject[] = [];
  private texts: TextObject[] = [];
  private pathCache = new Map<string, Path2D>();

  private staticDirty = true;
  private overlayDirty = true;
  private rafId: number | null = null;
  private disposers: (() => void)[] = [];
  private viewportListeners = new Set<(vp: Viewport) => void>();

  activeStroke: ActiveStroke | null = null;
  eraserCursor: EraserCursor | null = null;
  selectedId: string | null = null;
  dragPreview: { id: string; dx: number; dy: number } | null = null;
  /** Local-only object selection (never persisted or synced). */
  selectedIds = new Set<string>();
  /** Uncommitted move/rotation of the selection while a gesture is running. */
  selectionPreview: SelectionPreview | null = null;
  /** Live angle readout shown while rotating, e.g. "45°". */
  angleLabel: string | null = null;
  /** Live width while a text box is being resized (not yet committed). */
  textResize: { id: string; width: number } | null = null;
  /** The text box whose DOM editor is open; drawn by the overlay, not here. */
  editingTextId: string | null = null;
  /** Temporary lasso outline in world space while the user drags. */
  lassoPath: XY[] | null = null;
  /** Pages whose asset is still being rasterised (for placeholder text). */
  pendingAssets = new Set<string>();

  constructor(
    private readonly staticCanvas: HTMLCanvasElement,
    private readonly overlayCanvas: HTMLCanvasElement,
    private readonly doc: CanvasDocument,
  ) {
    this.staticCtx = staticCanvas.getContext("2d", { alpha: false })!;
    this.overlayCtx = overlayCanvas.getContext("2d")!;
    this.imageCache = new ImageCache(() => this.invalidateStatic());
    this.rebuildLists();
    this.disposers.push(
      doc.onChange((changes) => {
        for (const c of changes) if (c.kind !== "add") this.pathCache.delete(c.id);
        this.rebuildLists();
        this.invalidateStatic();
      }),
      // Web fonts finishing their load changes every text metric.
      onTextMeasurementsInvalidated(() => this.invalidateStatic()),
    );
  }

  // ---- public API ----------------------------------------------------

  resize(cssWidth: number, cssHeight: number, dpr: number) {
    this.width = cssWidth;
    this.height = cssHeight;
    this.dpr = dpr;
    for (const c of [this.staticCanvas, this.overlayCanvas]) {
      c.width = Math.max(1, Math.round(cssWidth * dpr));
      c.height = Math.max(1, Math.round(cssHeight * dpr));
      c.style.width = `${cssWidth}px`;
      c.style.height = `${cssHeight}px`;
    }
    this.invalidateStatic();
    this.invalidateOverlay();
  }

  getViewport(): Viewport {
    return this.viewport;
  }

  setViewport(vp: Viewport) {
    this.viewport = vp;
    for (const l of this.viewportListeners) l(vp);
    this.invalidateStatic();
    this.invalidateOverlay();
  }

  /**
   * Notified on every viewport change, including mid-pinch. The inline text
   * editor uses this to keep its DOM overlay glued to its world-space box.
   */
  onViewportChanged(fn: (vp: Viewport) => void): () => void {
    this.viewportListeners.add(fn);
    return () => this.viewportListeners.delete(fn);
  }

  /** Theme is presentation only: no document object is touched or rewritten. */
  setTheme(theme: CanvasTheme) {
    this.theme = theme;
    this.invalidateStatic();
    this.invalidateOverlay();
  }

  getSize() {
    return { width: this.width, height: this.height };
  }

  invalidateStatic() {
    this.staticDirty = true;
    this.schedule();
  }

  invalidateOverlay() {
    this.overlayDirty = true;
    this.schedule();
  }

  /** Called when a page image has just been written to storage. */
  assetReady(assetId: string) {
    this.pendingAssets.delete(assetId);
    this.imageCache.invalidate(assetId);
    this.invalidateStatic();
  }

  /**
   * Top-most page under a world point, if any. Rotation is accounted for: the
   * point is taken back into the page's own frame before the rectangle test.
   */
  hitTestPage(p: { x: number; y: number }): PDFPageObject | undefined {
    for (let i = this.pages.length - 1; i >= 0; i--) {
      if (rectContains(this.pages[i], p)) return this.pages[i];
    }
    return undefined;
  }

  /**
   * Top-most text box under a world point. Hit testing uses the whole box, not
   * the glyphs, so clicking any blank part of a text box selects it, and it
   * follows the box's rotation.
   */
  hitTestText(p: { x: number; y: number }, padWorld = 0): TextObject | undefined {
    for (let i = this.texts.length - 1; i >= 0; i--) {
      if (rectContains(this.effectiveText(this.texts[i]), p, padWorld)) return this.texts[i];
    }
    return undefined;
  }

  getStrokes(): StrokeObject[] {
    return this.strokes;
  }

  /** Strokes whose bounds intersect the given world rectangle (candidate query). */
  getStrokesInBounds(b: Bounds): StrokeObject[] {
    return this.strokes.filter((s) => boundsIntersect(s.bounds, b));
  }

  getTextsInBounds(b: Bounds): TextObject[] {
    return this.texts.filter((t) => boundsIntersect(transformedBounds(t), b));
  }

  getPagesInBounds(b: Bounds): PDFPageObject[] {
    return this.pages.filter((p) => boundsIntersect(transformedBounds(p), b));
  }

  /** The text object as it currently looks, including an uncommitted resize. */
  effectiveText(t: TextObject): TextObject {
    return this.textResize && this.textResize.id === t.id ? { ...t, width: this.textResize.width } : t;
  }

  /** Every selected object, in document order. */
  getSelectedObjects(): (StrokeObject | TextObject | PDFPageObject)[] {
    if (this.selectedIds.size === 0) return [];
    const out: (StrokeObject | TextObject | PDFPageObject)[] = [];
    for (const p of this.pages) if (this.selectedIds.has(p.id)) out.push(p);
    for (const s of this.strokes) if (this.selectedIds.has(s.id)) out.push(s);
    for (const t of this.texts) if (this.selectedIds.has(t.id)) out.push(this.effectiveText(t));
    return out;
  }

  /**
   * Selection bounds *before* the live preview transform. This is the frame
   * the dashed outline and the handles are laid out in; the preview transform
   * is then applied to the whole lot, so the chrome turns with the content.
   */
  selectionBaseBounds(): Bounds | null {
    return unionBounds(this.getSelectedObjects().map(transformedBounds));
  }

  /** Map a world point through the live selection preview. */
  previewPoint(p: XY): XY {
    const pv = this.selectionPreview;
    if (!pv) return p;
    const rotated = pv.angle === 0 ? p : rotatePoint(p, pv.pivot, pv.angle);
    return { x: rotated.x + pv.dx, y: rotated.y + pv.dy };
  }

  /**
   * Axis-aligned world bounds of the selection as it currently appears,
   * preview included. Used to decide whether a press lands "on" the selection.
   */
  getSelectionBounds(): Bounds | null {
    const b = this.selectionBaseBounds();
    if (!b) return null;
    if (!this.selectionPreview) return b;
    return pointsBounds(
      [
        { x: b.minX, y: b.minY },
        { x: b.maxX, y: b.minY },
        { x: b.maxX, y: b.maxY },
        { x: b.minX, y: b.maxY },
      ].map((p) => this.previewPoint(p)),
    );
  }

  /** Centre the selection rotates about: the middle of its own bounds. */
  selectionPivot(): XY | null {
    const b = this.selectionBaseBounds();
    return b ? boundsCenter(b) : null;
  }

  /**
   * World-space centre of the rotation grip, which floats above the selection.
   * One grip for the whole selection, never one per object.
   */
  rotationHandle(): { x: number; y: number; radius: number } | null {
    const b = this.selectionBaseBounds();
    if (!b || this.editingTextId) return null;
    const p = this.previewPoint({ x: (b.minX + b.maxX) / 2, y: b.minY - ROTATE_HANDLE_OFFSET_PX / this.viewport.scale });
    return { x: p.x, y: p.y, radius: ROTATE_HANDLE_PX / this.viewport.scale };
  }

  /**
   * The single selected text box, if the selection is exactly one text box.
   * Only then is a width grip shown: resizing many boxes at once is out of
   * scope for this milestone.
   */
  soleSelectedText(): TextObject | undefined {
    if (this.selectedIds.size !== 1) return undefined;
    const id = this.selectedIds.values().next().value as string;
    return this.texts.find((t) => t.id === id);
  }

  /** World-space centre of the width grip, or null when none is shown. */
  textResizeHandle(): { x: number; y: number; radius: number } | null {
    const raw = this.soleSelectedText();
    if (!raw || this.editingTextId === raw.id) return null;
    const t = this.effectiveText(raw);
    const b = textBounds(t);
    // Just outside the box, so the grip never sits on top of the last glyph.
    const offset = (TEXT_HANDLE_PX * 0.9) / this.viewport.scale;
    // The grip lives in the box's own frame, so it turns with a rotated box.
    const local = rotatePoint({ x: b.maxX + offset, y: (b.minY + b.maxY) / 2 }, boundsCenter(b), rotationOf(t));
    const p = this.previewPoint(local);
    return { x: p.x, y: p.y, radius: TEXT_HANDLE_PX / this.viewport.scale };
  }

  destroy() {
    for (const d of this.disposers) d();
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.imageCache.clear();
    this.pathCache.clear();
  }

  // ---- internals -----------------------------------------------------

  private rebuildLists() {
    const pages: PDFPageObject[] = [];
    const strokes: StrokeObject[] = [];
    const texts: TextObject[] = [];
    for (const o of this.doc.getAll()) {
      if (o.type === "pdf-page") pages.push(o);
      else if (o.type === "stroke") strokes.push(o);
      else if (o.type === "text") texts.push(o);
    }
    pages.sort((a, b) => a.createdAt - b.createdAt || a.pageNumber - b.pageNumber);
    strokes.sort((a, b) => a.createdAt - b.createdAt);
    texts.sort((a, b) => a.createdAt - b.createdAt);
    this.pages = pages;
    this.strokes = strokes;
    this.texts = texts;
  }

  private schedule() {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      if (this.staticDirty) this.renderStatic();
      if (this.overlayDirty) this.renderOverlay();
    });
  }

  private applyWorldTransform(ctx: CanvasRenderingContext2D) {
    const { scale, x, y } = this.viewport;
    ctx.setTransform(this.dpr * scale, 0, 0, this.dpr * scale, this.dpr * x, this.dpr * y);
  }

  private renderStatic() {
    this.staticDirty = false;
    const ctx = this.staticCtx;
    const { width, height, dpr, viewport, theme } = this;
    if (width === 0 || height === 0) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width * dpr, height * dpr);

    const visible = visibleWorldBounds(viewport, width, height, OVERSCAN_PX);
    this.applyWorldTransform(ctx);

    const hasSelection = this.selectedIds.size > 0;
    // A selected object is drawn inside the live preview transform, but stays
    // in its own layer: selecting a page never lifts it above the ink on it.
    const inPreview = (id: string, draw: () => void) => {
      if (!hasSelection || !this.selectedIds.has(id)) {
        draw();
        return;
      }
      ctx.save();
      this.applyPreviewTransform(ctx);
      draw();
      ctx.restore();
    };

    // Layer 10: PDF pages
    for (const page of this.pages) {
      const selected = hasSelection && this.selectedIds.has(page.id);
      if (!selected && !boundsIntersect(transformedBounds(page), visible)) continue;
      inPreview(page.id, () => this.drawPage(ctx, page, pageBounds(page, this.dragPreview)));
    }

    // Layer 20: strokes
    for (const stroke of this.strokes) {
      const selected = hasSelection && this.selectedIds.has(stroke.id);
      if (!selected && !boundsIntersect(stroke.bounds, visible)) continue;
      inPreview(stroke.id, () => this.drawStroke(ctx, stroke, selected));
    }

    // Layer 30: text boxes, above ink so typed notes read over handwriting
    for (const text of this.texts) {
      if (text.id === this.editingTextId) continue; // the DOM editor draws it
      const selected = hasSelection && this.selectedIds.has(text.id);
      const t = this.effectiveText(text);
      if (!selected && !boundsIntersect(transformedBounds(t), visible)) continue;
      inPreview(text.id, () => this.drawText(ctx, t));
    }

    // Layer 100: selection affordances
    if (hasSelection) this.drawSelectionChrome(ctx);
    if (this.selectedId) {
      const page = this.pages.find((p) => p.id === this.selectedId);
      if (page) {
        const b = pageBounds(page, this.dragPreview);
        this.withRotation(ctx, page.rotation ?? 0, boundsCenter(b), () => {
          ctx.strokeStyle = theme.accent;
          ctx.lineWidth = 2 / viewport.scale;
          ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
        });
      }
    }
  }

  /** Apply the uncommitted selection move/rotation to the current context. */
  private applyPreviewTransform(ctx: CanvasRenderingContext2D) {
    const pv = this.selectionPreview;
    if (!pv) return;
    ctx.translate(pv.dx, pv.dy);
    if (pv.angle !== 0) {
      ctx.translate(pv.pivot.x, pv.pivot.y);
      ctx.rotate(pv.angle);
      ctx.translate(-pv.pivot.x, -pv.pivot.y);
    }
  }

  private drawSelectionChrome(ctx: CanvasRenderingContext2D) {
    const { theme, viewport } = this;
    const sb = this.selectionBaseBounds();
    if (!sb) return;
    const pad = 6 / viewport.scale;
    ctx.save();
    // The outline lives in the same preview transform as the content, so a
    // rotating selection turns inside its box instead of wobbling in an
    // axis-aligned one.
    this.applyPreviewTransform(ctx);
    ctx.setLineDash([6 / viewport.scale, 4 / viewport.scale]);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 1.5 / viewport.scale;
    ctx.strokeRect(sb.minX - pad, sb.minY - pad, sb.maxX - sb.minX + pad * 2, sb.maxY - sb.minY + pad * 2);
    ctx.setLineDash([]);
    // Stem joining the rotation grip to the top of the selection.
    const stemX = (sb.minX + sb.maxX) / 2;
    ctx.beginPath();
    ctx.moveTo(stemX, sb.minY - pad);
    ctx.lineTo(stemX, sb.minY - ROTATE_HANDLE_OFFSET_PX / viewport.scale);
    ctx.stroke();
    ctx.restore();

    const rotate = this.rotationHandle();
    if (rotate) {
      // Drawn at a constant screen size, upright, so it stays grabbable at any
      // zoom and never turns into an unreadable smear mid-rotation.
      const r = ROTATE_HANDLE_PX / 2.4 / viewport.scale;
      ctx.beginPath();
      ctx.arc(rotate.x, rotate.y, r, 0, Math.PI * 2);
      ctx.fillStyle = theme.handleFill;
      ctx.fill();
      ctx.strokeStyle = theme.handleStroke;
      ctx.lineWidth = 1.5 / viewport.scale;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rotate.x, rotate.y, r * 0.5, Math.PI * 0.6, Math.PI * 2.1);
      ctx.stroke();
    }

    const handle = this.textResizeHandle();
    if (handle) {
      const r = TEXT_HANDLE_PX / 2 / viewport.scale;
      ctx.beginPath();
      ctx.roundRect(handle.x - r, handle.y - r * 1.6, r * 2, r * 3.2, r * 0.6);
      ctx.fillStyle = theme.handleFill;
      ctx.fill();
      ctx.strokeStyle = theme.handleStroke;
      ctx.lineWidth = 1.5 / viewport.scale;
      ctx.stroke();
    }
  }

  /**
   * Draw a rotated object's contents in its own upright frame.
   *
   * The bitmap and the glyphs are never re-rendered or re-rasterised: the
   * canvas is turned around the object's centre and the object is drawn
   * exactly as it always was.
   */
  private withRotation(ctx: CanvasRenderingContext2D, angle: number, centre: XY, draw: () => void) {
    if (angle === 0) {
      draw();
      return;
    }
    ctx.save();
    ctx.translate(centre.x, centre.y);
    ctx.rotate(angle);
    ctx.translate(-centre.x, -centre.y);
    draw();
    ctx.restore();
  }

  private drawPage(ctx: CanvasRenderingContext2D, page: PDFPageObject, b: Bounds) {
    this.withRotation(ctx, page.rotation ?? 0, boundsCenter(b), () => this.drawPageUpright(ctx, page, b));
  }

  private drawPageUpright(ctx: CanvasRenderingContext2D, page: PDFPageObject, b: Bounds) {
    const { scale } = this.viewport;
    const { theme } = this;
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const off = 3 / scale;
    // Cheap paper shadow (real shadowBlur is too slow for hundreds of pages).
    ctx.fillStyle = theme.pageShadow;
    ctx.fillRect(b.minX + off, b.minY + off, w, h);
    ctx.fillStyle = theme.pageFill;
    ctx.fillRect(b.minX, b.minY, w, h);

    const bitmap = this.imageCache.get(page.assetId);
    if (bitmap) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = scale < 1 ? "high" : "medium";
      // Imported pages are drawn exactly as rasterised: never inverted or
      // recoloured, in either theme.
      ctx.drawImage(bitmap, b.minX, b.minY, w, h);
    } else {
      const pending = this.pendingAssets.has(page.assetId) || !this.imageCache.isMissing(page.assetId);
      ctx.fillStyle = theme.pagePlaceholderText;
      ctx.font = `${Math.max(12, 16 / scale)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(pending ? `Rendering page ${page.pageNumber}...` : `Page ${page.pageNumber} image unavailable`, b.minX + w / 2, b.minY + h / 2);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }

    ctx.strokeStyle = theme.pageBorder;
    ctx.lineWidth = 1 / scale;
    ctx.strokeRect(b.minX, b.minY, w, h);
  }

  private drawStroke(ctx: CanvasRenderingContext2D, stroke: StrokeObject, selected: boolean) {
    let path = this.pathCache.get(stroke.id);
    if (!path) {
      const pts = unpackPoints(stroke.points);
      path = outlineToPath(strokeOutline(pts, stroke.tool, stroke.width, stroke.tool === "pen" && hasVaryingPressure(pts)));
      this.pathCache.set(stroke.id, path);
    }
    if (selected) {
      // Subtle halo so selected ink stays readable.
      ctx.strokeStyle = this.theme.selectionHalo;
      ctx.lineWidth = 5 / this.viewport.scale;
      ctx.lineJoin = "round";
      ctx.stroke(path);
    }
    ctx.fillStyle = stroke.color;
    ctx.globalAlpha = stroke.tool === "pencil" ? 0.82 : 1;
    ctx.fill(path);
    ctx.globalAlpha = 1;
  }

  /**
   * Text is drawn straight onto the canvas in world units, so it culls, zooms
   * and pans like every other object. Only the box being edited gets a DOM
   * editor, which keeps a board with hundreds of text objects cheap.
   */
  private drawText(ctx: CanvasRenderingContext2D, text: TextObject) {
    // Rotation turns the whole box: wrapping, font, size and alignment are
    // untouched, so a rotated box reads exactly as it did upright.
    this.withRotation(ctx, text.rotation ?? 0, objectCenter(text), () => {
      const layout = measureText(text);
      ctx.save();
      ctx.fillStyle = text.color;
      ctx.font = canvasFont(text.fontFamily, text.fontSize);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      for (const line of layout.lines) {
        if (line.text !== "") ctx.fillText(line.text, text.x + line.x, text.y + line.baseline);
      }
      ctx.restore();
    });
  }

  private renderOverlay() {
    this.overlayDirty = false;
    const ctx = this.overlayCtx;
    const { width, height, dpr, viewport, theme } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width * dpr, height * dpr);
    this.applyWorldTransform(ctx);

    if (this.activeStroke && this.activeStroke.points.length > 0) {
      const s = this.activeStroke;
      const outline = strokeOutline(s.points, s.tool, s.width, s.hasPressure);
      ctx.fillStyle = s.color;
      ctx.globalAlpha = s.tool === "pencil" ? 0.82 : 1;
      ctx.fill(outlineToPath(outline));
      ctx.globalAlpha = 1;
    }

    if (this.lassoPath && this.lassoPath.length > 1) {
      ctx.beginPath();
      ctx.moveTo(this.lassoPath[0].x, this.lassoPath[0].y);
      for (let i = 1; i < this.lassoPath.length; i++) ctx.lineTo(this.lassoPath[i].x, this.lassoPath[i].y);
      ctx.closePath();
      ctx.fillStyle = theme.selectionFill;
      ctx.fill();
      ctx.setLineDash([5 / viewport.scale, 4 / viewport.scale]);
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1.5 / viewport.scale;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (this.angleLabel) {
      // Drawn in screen space so the readout stays upright and legible at any
      // zoom while the selection underneath it turns.
      const pivot = this.selectionPivot();
      if (pivot) {
        const p = this.previewPoint(pivot);
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const sx = p.x * viewport.scale + viewport.x;
        const sy = p.y * viewport.scale + viewport.y;
        ctx.font = "600 12px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const w = ctx.measureText(this.angleLabel).width + 14;
        ctx.beginPath();
        ctx.roundRect(sx - w / 2, sy - 12, w, 24, 6);
        ctx.fillStyle = theme.handleFill;
        ctx.fill();
        ctx.strokeStyle = theme.handleStroke;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = theme.accent;
        ctx.fillText(this.angleLabel, sx, sy);
        ctx.restore();
        this.applyWorldTransform(ctx);
      }
    }

    if (this.eraserCursor) {
      const c = this.eraserCursor;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
      ctx.fillStyle = theme.eraserFill;
      ctx.fill();
      ctx.strokeStyle = theme.eraserStroke;
      ctx.lineWidth = 1.5 / viewport.scale;
      ctx.stroke();
    }
  }
}

function pageBounds(page: PDFPageObject, drag: { id: string; dx: number; dy: number } | null): Bounds {
  const dx = drag && drag.id === page.id ? drag.dx : 0;
  const dy = drag && drag.id === page.id ? drag.dy : 0;
  return { minX: page.x + dx, minY: page.y + dy, maxX: page.x + dx + page.width, maxY: page.y + dy + page.height };
}

function hasVaryingPressure(pts: StrokePoint[]): boolean {
  if (pts.length < 2) return false;
  const first = pts[0].pressure ?? 0.5;
  for (const p of pts) if (Math.abs((p.pressure ?? 0.5) - first) > 1e-3) return true;
  return false;
}

function outlineToPath(outline: number[][]): Path2D {
  const path = new Path2D();
  if (outline.length === 0) return path;
  const [x0, y0] = outline[0];
  path.moveTo(x0, y0);
  // Smooth the polygon with quadratic curves through midpoints.
  for (let i = 1; i < outline.length; i++) {
    const [x1, y1] = outline[i];
    const [x2, y2] = outline[(i + 1) % outline.length];
    path.quadraticCurveTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2);
  }
  path.closePath();
  return path;
}
