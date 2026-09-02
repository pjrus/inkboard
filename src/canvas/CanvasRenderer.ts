import type { CanvasDocument } from "../document/crdt";
import { unpackPoints, type Bounds, type PDFPageObject, type PenTool, type StrokeObject, type StrokePoint, type Viewport } from "../document/schema";
import { boundsIntersect, DEFAULT_VIEWPORT, visibleWorldBounds } from "./coordinates";
import { ImageCache } from "./ImageCache";
import { strokeOutline, type XY } from "./strokeGeometry";

export const BACKGROUND = "#f3f1ec";
const PAGE_BORDER = "rgba(0,0,0,0.12)";
const PAGE_SHADOW = "rgba(20,16,8,0.10)";
const SELECTION = "#2b6de9";
const OVERSCAN_PX = 200;

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
 *   static  — background, PDF pages, committed strokes (redrawn on
 *             viewport/document change only)
 *   overlay — the stroke being drawn, eraser cursor, drag previews
 *             (redrawn per pointer frame; cheap)
 *
 * Both are driven by requestAnimationFrame; multiple invalidations within a
 * frame collapse into one draw. Stroke outlines are cached as Path2D in world
 * units so a pan/zoom is a transform change plus a fill per visible stroke.
 */
export class CanvasRenderer {
  readonly imageCache: ImageCache;

  private staticCtx: CanvasRenderingContext2D;
  private overlayCtx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private viewport: Viewport = DEFAULT_VIEWPORT;

  private pages: PDFPageObject[] = [];
  private strokes: StrokeObject[] = [];
  private pathCache = new Map<string, Path2D>();

  private staticDirty = true;
  private overlayDirty = true;
  private rafId: number | null = null;
  private unsubscribe: () => void;

  activeStroke: ActiveStroke | null = null;
  eraserCursor: EraserCursor | null = null;
  selectedId: string | null = null;
  dragPreview: { id: string; dx: number; dy: number } | null = null;
  /** Local-only stroke selection (never persisted or synced). */
  selectedStrokeIds = new Set<string>();
  selectionDrag: { dx: number; dy: number } | null = null;
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
    this.unsubscribe = doc.onChange((changes) => {
      for (const c of changes) if (c.kind !== "add") this.pathCache.delete(c.id);
      this.rebuildLists();
      this.invalidateStatic();
    });
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

  /** Top-most page under a world point, if any. */
  hitTestPage(p: { x: number; y: number }): PDFPageObject | undefined {
    for (let i = this.pages.length - 1; i >= 0; i--) {
      const pg = this.pages[i];
      if (p.x >= pg.x && p.x <= pg.x + pg.width && p.y >= pg.y && p.y <= pg.y + pg.height) return pg;
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

  /** World-space bounds of the current stroke selection (including drag offset). */
  getSelectionBounds(): Bounds | null {
    if (this.selectedStrokeIds.size === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of this.strokes) {
      if (!this.selectedStrokeIds.has(s.id)) continue;
      const b = s.bounds;
      if (b.minX < minX) minX = b.minX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.maxY > maxY) maxY = b.maxY;
    }
    if (!isFinite(minX)) return null;
    const dx = this.selectionDrag?.dx ?? 0;
    const dy = this.selectionDrag?.dy ?? 0;
    return { minX: minX + dx, minY: minY + dy, maxX: maxX + dx, maxY: maxY + dy };
  }

  destroy() {
    this.unsubscribe();
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.imageCache.clear();
    this.pathCache.clear();
  }

  // ---- internals -----------------------------------------------------

  private rebuildLists() {
    const pages: PDFPageObject[] = [];
    const strokes: StrokeObject[] = [];
    for (const o of this.doc.getAll()) {
      if (o.type === "pdf-page") pages.push(o);
      else if (o.type === "stroke") strokes.push(o);
      // "text" objects are reserved for a later milestone and skipped here.
    }
    pages.sort((a, b) => a.createdAt - b.createdAt || a.pageNumber - b.pageNumber);
    strokes.sort((a, b) => a.createdAt - b.createdAt);
    this.pages = pages;
    this.strokes = strokes;
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
    const { width, height, dpr, viewport } = this;
    if (width === 0 || height === 0) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, width * dpr, height * dpr);

    const visible = visibleWorldBounds(viewport, width, height, OVERSCAN_PX);
    this.applyWorldTransform(ctx);

    // Layer 10: PDF pages
    for (const page of this.pages) {
      const b = pageBounds(page, this.dragPreview);
      if (!boundsIntersect(b, visible)) continue;
      this.drawPage(ctx, page, b);
    }

    // Layer 20: strokes (selected ones are drawn last, with their drag offset)
    const hasSelection = this.selectedStrokeIds.size > 0;
    const deferred: StrokeObject[] = [];
    for (const stroke of this.strokes) {
      if (hasSelection && this.selectedStrokeIds.has(stroke.id)) {
        deferred.push(stroke);
        continue;
      }
      if (!boundsIntersect(stroke.bounds, visible)) continue;
      this.drawStroke(ctx, stroke, false);
    }
    if (deferred.length) {
      const dx = this.selectionDrag?.dx ?? 0;
      const dy = this.selectionDrag?.dy ?? 0;
      ctx.save();
      ctx.translate(dx, dy);
      for (const stroke of deferred) this.drawStroke(ctx, stroke, true);
      ctx.restore();
      const sb = this.getSelectionBounds();
      if (sb) {
        const pad = 6 / viewport.scale;
        ctx.save();
        ctx.setLineDash([6 / viewport.scale, 4 / viewport.scale]);
        ctx.strokeStyle = SELECTION;
        ctx.lineWidth = 1.5 / viewport.scale;
        ctx.strokeRect(sb.minX - pad, sb.minY - pad, sb.maxX - sb.minX + pad * 2, sb.maxY - sb.minY + pad * 2);
        ctx.restore();
      }
    }

    // Layer 100: selection
    if (this.selectedId) {
      const page = this.pages.find((p) => p.id === this.selectedId);
      if (page) {
        const b = pageBounds(page, this.dragPreview);
        ctx.strokeStyle = SELECTION;
        ctx.lineWidth = 2 / viewport.scale;
        ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
      }
    }
  }

  private drawPage(ctx: CanvasRenderingContext2D, page: PDFPageObject, b: Bounds) {
    const { scale } = this.viewport;
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const off = 3 / scale;
    // Cheap paper shadow (real shadowBlur is too slow for hundreds of pages).
    ctx.fillStyle = PAGE_SHADOW;
    ctx.fillRect(b.minX + off, b.minY + off, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(b.minX, b.minY, w, h);

    const bitmap = this.imageCache.get(page.assetId);
    if (bitmap) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = scale < 1 ? "high" : "medium";
      ctx.drawImage(bitmap, b.minX, b.minY, w, h);
    } else {
      const pending = this.pendingAssets.has(page.assetId) || !this.imageCache.isMissing(page.assetId);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.font = `${Math.max(12, 16 / scale)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(pending ? `Rendering page ${page.pageNumber}…` : `Page ${page.pageNumber} image unavailable`, b.minX + w / 2, b.minY + h / 2);
    }

    ctx.strokeStyle = PAGE_BORDER;
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
      ctx.strokeStyle = "rgba(43,109,233,0.35)";
      ctx.lineWidth = 5 / this.viewport.scale;
      ctx.lineJoin = "round";
      ctx.stroke(path);
    }
    ctx.fillStyle = stroke.color;
    ctx.globalAlpha = stroke.tool === "pencil" ? 0.82 : 1;
    ctx.fill(path);
    ctx.globalAlpha = 1;
  }

  private renderOverlay() {
    this.overlayDirty = false;
    const ctx = this.overlayCtx;
    const { width, height, dpr, viewport } = this;
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
      ctx.fillStyle = "rgba(43,109,233,0.08)";
      ctx.fill();
      ctx.setLineDash([5 / viewport.scale, 4 / viewport.scale]);
      ctx.strokeStyle = "rgba(43,109,233,0.9)";
      ctx.lineWidth = 1.5 / viewport.scale;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (this.eraserCursor) {
      const c = this.eraserCursor;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
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
