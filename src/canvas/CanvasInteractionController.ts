import type { CanvasDocument } from "../document/crdt";
import type { PenTool, StrokePoint, Tool, Viewport } from "../document/schema";
import { packPoints } from "../document/schema";
import { pan, screenLengthToWorld, screenToWorld, zoomBy, type Point } from "./coordinates";
import { beginPinch, updatePinch, type PinchStart } from "./gestures";
import type { CanvasRenderer } from "./CanvasRenderer";
import { computeBounds, lassoSelectsStroke, polygonBounds, simplifyPoints, strokeSegmentHitTest, type XY } from "./strokeGeometry";
import { unpackPoints } from "../document/schema";
import type { StrokeSelection } from "../store/toolStore";

/**
 * Central pointer/wheel/keyboard state machine for the canvas.
 *
 * States are explicit so conflicting interactions (pinch while drawing,
 * dragging a page while inking, etc.) are impossible by construction.
 */
type State =
  | { type: "idle" }
  | { type: "drawing"; pointerId: number; points: StrokePoint[]; tool: PenTool; color: string; width: number; hasPressure: boolean }
  | { type: "erasing"; pointerId: number; last: Point }
  | { type: "panning"; pointerId: number; last: Point }
  | { type: "pinching"; pinch: PinchStart }
  | { type: "movingObject"; pointerId: number; objectId: string; start: Point; moved: boolean }
  | { type: "lassoing"; pointerId: number; points: XY[]; additive: boolean; startScreen: Point; maxDistPx: number }
  | { type: "movingSelection"; pointerId: number; start: Point; moved: boolean };

export interface ControllerHost {
  getTool(): Tool;
  getColor(): string;
  getWidth(): number;
  /** True once a stylus has been used: fingers then navigate only. */
  stylusSeen(): boolean;
  onStylusSeen(): void;
  onViewportChange(vp: Viewport): void;
  onSelectionChange(id: string | null): void;
  onStrokeSelectionChange(sel: StrokeSelection | null): void;
}

const ERASER_RADIUS_PX = 12;
const LASSO_CLICK_TOLERANCE_PX = 4;
const SELECTION_GRAB_PAD_PX = 8;
const DRAG_THRESHOLD_PX = 3;

export class CanvasInteractionController {
  private state: State = { type: "idle" };
  private touches = new Map<number, Point>();
  private spaceDown = false;
  private disposers: (() => void)[] = [];
  /** Local stroke selection; never enters the document. */
  private selectedIds = new Set<string>();

  constructor(
    private readonly el: HTMLElement,
    private readonly renderer: CanvasRenderer,
    private readonly doc: CanvasDocument,
    private readonly host: ControllerHost,
  ) {
    this.bind();
    this.updateCursor();
    // Keep the selection consistent with the document (remote deletes/edits).
    this.disposers.push(
      doc.onChange((changes) => {
        if (this.selectedIds.size === 0) return;
        let touched = false;
        for (const c of changes) {
          if (!this.selectedIds.has(c.id)) continue;
          touched = true;
          if (c.kind === "remove") this.selectedIds.delete(c.id);
        }
        if (touched) this.publishStrokeSelection();
      }),
    );
  }

  // ---- stroke selection ---------------------------------------------

  getSelectedStrokeIds(): string[] {
    return Array.from(this.selectedIds);
  }

  setSelectedStrokes(ids: Iterable<string>) {
    this.selectedIds = new Set(ids);
    this.publishStrokeSelection();
  }

  clearStrokeSelection() {
    if (this.selectedIds.size === 0) return;
    this.selectedIds.clear();
    this.publishStrokeSelection();
  }

  setSelectionWidth(width: number) {
    this.doc.setStrokeWidth(this.getSelectedStrokeIds(), width);
  }

  adjustSelectionWidth(direction: 1 | -1) {
    this.doc.adjustStrokeWidths(this.getSelectedStrokeIds(), direction);
  }

  setSelectionColor(color: string) {
    this.doc.setStrokeColor(this.getSelectedStrokeIds(), color);
  }

  deleteSelection() {
    const ids = this.getSelectedStrokeIds();
    this.selectedIds.clear();
    this.doc.removeObjects(ids);
    this.publishStrokeSelection();
  }

  private publishStrokeSelection() {
    this.renderer.selectedStrokeIds = new Set(this.selectedIds);
    this.renderer.invalidateStatic();
    if (this.selectedIds.size === 0) {
      this.host.onStrokeSelectionChange(null);
      return;
    }
    const widths: number[] = [];
    const colors: string[] = [];
    for (const id of this.selectedIds) {
      const o = this.doc.get(id);
      if (o?.type === "stroke") {
        widths.push(o.width);
        colors.push(o.color);
      }
    }
    this.host.onStrokeSelectionChange({ ids: Array.from(this.selectedIds), widths, colors });
  }

  /** Strokes inside a world-space lasso polygon: bounds prefilter, then polygon test. */
  private strokesInLasso(poly: XY[]): string[] {
    const pb = polygonBounds(poly);
    const out: string[] = [];
    for (const s of this.renderer.getStrokesInBounds(pb)) {
      if (lassoSelectsStroke(unpackPoints(s.points), s.width, poly, pb)) out.push(s.id);
    }
    return out;
  }

  private pointInSelection(wp: Point): boolean {
    const b = this.renderer.getSelectionBounds();
    if (!b) return false;
    const pad = screenLengthToWorld(SELECTION_GRAB_PAD_PX, this.viewport);
    return wp.x >= b.minX - pad && wp.x <= b.maxX + pad && wp.y >= b.minY - pad && wp.y <= b.maxY + pad;
  }

  // ---- viewport helpers ----------------------------------------------

  get viewport(): Viewport {
    return this.renderer.getViewport();
  }

  setViewport(vp: Viewport) {
    this.renderer.setViewport(vp);
    this.host.onViewportChange(vp);
  }

  zoomAtCenter(factor: number) {
    const { width, height } = this.renderer.getSize();
    this.setViewport(zoomBy(this.viewport, { x: width / 2, y: height / 2 }, factor));
  }

  setSelection(id: string | null) {
    this.renderer.selectedId = id;
    this.renderer.invalidateStatic();
    this.host.onSelectionChange(id);
  }

  updateCursor() {
    const tool = this.host.getTool();
    let cursor = "default";
    if (this.state.type === "panning" || this.state.type === "pinching") cursor = "grabbing";
    else if (this.state.type === "movingObject" || this.state.type === "movingSelection") cursor = "move";
    else if (this.spaceDown || tool === "pan") cursor = "grab";
    else if (tool === "pen" || tool === "pencil" || tool === "lasso") cursor = "crosshair";
    else if (tool === "eraser") cursor = "none";
    this.el.style.cursor = cursor;
  }

  destroy() {
    for (const d of this.disposers) d();
  }

  // ---- event binding -------------------------------------------------

  private bind() {
    const el = this.el;
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      el.addEventListener(type, fn, opts);
      this.disposers.push(() => el.removeEventListener(type, fn, opts));
    };
    on("pointerdown", (e) => this.onPointerDown(e));
    on("pointermove", (e) => this.onPointerMove(e));
    on("pointerup", (e) => this.onPointerUp(e));
    on("pointercancel", (e) => this.onPointerUp(e));
    on("pointerleave", (e) => {
      if (this.state.type === "idle") this.hideEraserCursor(e);
    });
    on("wheel", (e) => this.onWheel(e), { passive: false });
    on("contextmenu", (e) => e.preventDefault());
    // Safari trackpad pinch / iOS page zoom.
    const stopGesture = (e: Event) => e.preventDefault();
    el.addEventListener("gesturestart", stopGesture);
    el.addEventListener("gesturechange", stopGesture);
    this.disposers.push(() => {
      el.removeEventListener("gesturestart", stopGesture);
      el.removeEventListener("gesturechange", stopGesture);
    });

    const keydown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTypingTarget(e.target) && !e.repeat) {
        this.spaceDown = true;
        e.preventDefault();
        this.updateCursor();
      }
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        this.spaceDown = false;
        this.updateCursor();
      }
    };
    const blur = () => {
      this.spaceDown = false;
      this.updateCursor();
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    this.disposers.push(() => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
    });
  }

  private screenPoint(e: PointerEvent | WheelEvent): Point {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ---- pointer down --------------------------------------------------

  private onPointerDown(e: PointerEvent) {
    const sp = this.screenPoint(e);
    if (e.pointerType === "pen") this.host.onStylusSeen();

    if (e.pointerType === "touch") {
      this.touches.set(e.pointerId, sp);
      if (this.touches.size === 2) {
        this.cancelCurrent();
        const [a, b] = Array.from(this.touches.values());
        this.state = { type: "pinching", pinch: beginPinch(a, b, this.viewport) };
        this.updateCursor();
        return;
      }
      if (this.touches.size > 2) return;
    }

    if (this.state.type !== "idle") return;
    if (e.button === 2) return;

    const tool = this.host.getTool();
    const fingerNavigates = e.pointerType === "touch" && this.host.stylusSeen();

    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // Some browsers throw if the pointer is already gone; drawing still works.
    }

    if (e.button === 1 || this.spaceDown || fingerNavigates || tool === "pan") {
      if (tool === "pan" && !this.spaceDown && e.button === 0) {
        const page = this.renderer.hitTestPage(screenToWorld(sp, this.viewport));
        if (page) {
          this.setSelection(page.id);
          this.state = { type: "movingObject", pointerId: e.pointerId, objectId: page.id, start: sp, moved: false };
          this.updateCursor();
          return;
        }
        this.setSelection(null);
      }
      this.state = { type: "panning", pointerId: e.pointerId, last: sp };
      this.updateCursor();
      return;
    }

    if (tool === "pen" || tool === "pencil") {
      const wp = screenToWorld(sp, this.viewport);
      const hasPressure = e.pointerType === "pen";
      const points: StrokePoint[] = [{ x: wp.x, y: wp.y, pressure: hasPressure ? e.pressure : 0.5 }];
      this.state = { type: "drawing", pointerId: e.pointerId, points, tool, color: this.host.getColor(), width: this.host.getWidth(), hasPressure };
      this.renderer.activeStroke = { points, tool, color: this.host.getColor(), width: this.host.getWidth(), hasPressure };
      this.renderer.invalidateOverlay();
      return;
    }

    if (tool === "lasso") {
      const wp = screenToWorld(sp, this.viewport);
      if (this.selectedIds.size > 0 && this.pointInSelection(wp)) {
        this.state = { type: "movingSelection", pointerId: e.pointerId, start: sp, moved: false };
        this.updateCursor();
        return;
      }
      this.state = { type: "lassoing", pointerId: e.pointerId, points: [wp], additive: e.shiftKey, startScreen: sp, maxDistPx: 0 };
      this.renderer.lassoPath = this.state.points;
      this.renderer.invalidateOverlay();
      return;
    }

    if (tool === "eraser") {
      const wp = screenToWorld(sp, this.viewport);
      this.doc.closeUndoGroup();
      this.state = { type: "erasing", pointerId: e.pointerId, last: wp };
      this.eraseAlong(wp, wp);
      this.showEraserCursor(wp);
    }
  }

  // ---- pointer move --------------------------------------------------

  private onPointerMove(e: PointerEvent) {
    const sp = this.screenPoint(e);

    if (e.pointerType === "touch" && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, sp);
      if (this.state.type === "pinching") {
        const [a, b] = Array.from(this.touches.values());
        if (a && b) this.setViewport(updatePinch(this.state.pinch, a, b));
        return;
      }
    }

    const s = this.state;
    switch (s.type) {
      case "idle":
        if (this.host.getTool() === "eraser") this.showEraserCursor(screenToWorld(sp, this.viewport));
        return;
      case "drawing": {
        if (e.pointerId !== s.pointerId) return;
        const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [e];
        const r = this.el.getBoundingClientRect();
        for (const ce of events.length ? events : [e]) {
          const wp = screenToWorld({ x: ce.clientX - r.left, y: ce.clientY - r.top }, this.viewport);
          const last = s.points[s.points.length - 1];
          if (last && Math.abs(last.x - wp.x) < 1e-3 && Math.abs(last.y - wp.y) < 1e-3) continue;
          s.points.push({ x: wp.x, y: wp.y, pressure: s.hasPressure ? ce.pressure : 0.5 });
        }
        this.renderer.invalidateOverlay();
        return;
      }
      case "erasing": {
        if (e.pointerId !== s.pointerId) return;
        const wp = screenToWorld(sp, this.viewport);
        this.eraseAlong(s.last, wp);
        s.last = wp;
        this.showEraserCursor(wp);
        return;
      }
      case "panning": {
        if (e.pointerId !== s.pointerId) return;
        this.setViewport(pan(this.viewport, sp.x - s.last.x, sp.y - s.last.y));
        s.last = sp;
        return;
      }
      case "movingObject": {
        if (e.pointerId !== s.pointerId) return;
        const dxPx = sp.x - s.start.x;
        const dyPx = sp.y - s.start.y;
        if (!s.moved && Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD_PX) return;
        s.moved = true;
        this.renderer.dragPreview = { id: s.objectId, dx: dxPx / this.viewport.scale, dy: dyPx / this.viewport.scale };
        this.renderer.invalidateStatic();
        return;
      }
      case "lassoing": {
        if (e.pointerId !== s.pointerId) return;
        const wp = screenToWorld(sp, this.viewport);
        s.points.push(wp);
        s.maxDistPx = Math.max(s.maxDistPx, Math.hypot(sp.x - s.startScreen.x, sp.y - s.startScreen.y));
        this.renderer.invalidateOverlay();
        return;
      }
      case "movingSelection": {
        if (e.pointerId !== s.pointerId) return;
        const dxPx = sp.x - s.start.x;
        const dyPx = sp.y - s.start.y;
        if (!s.moved && Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD_PX) return;
        s.moved = true;
        this.renderer.selectionDrag = { dx: dxPx / this.viewport.scale, dy: dyPx / this.viewport.scale };
        this.renderer.invalidateStatic();
        return;
      }
      case "pinching":
        return;
    }
  }

  // ---- pointer up ----------------------------------------------------

  private onPointerUp(e: PointerEvent) {
    if (e.pointerType === "touch") {
      this.touches.delete(e.pointerId);
      if (this.state.type === "pinching") {
        if (this.touches.size < 2) {
          this.state = { type: "idle" };
          this.updateCursor();
        }
        return;
      }
    }
    const s = this.state;
    if (s.type === "idle" || s.type === "pinching") return;
    if ("pointerId" in s && s.pointerId !== e.pointerId) return;

    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);

    switch (s.type) {
      case "drawing":
        this.commitStroke(s, e.type === "pointercancel");
        break;
      case "erasing":
        this.doc.closeUndoGroup();
        if (e.pointerType === "touch") this.hideEraserCursor();
        break;
      case "movingObject": {
        const preview = this.renderer.dragPreview;
        this.renderer.dragPreview = null;
        if (s.moved && preview) this.doc.translateObjects([s.objectId], preview.dx, preview.dy);
        this.renderer.invalidateStatic();
        break;
      }
      case "lassoing":
        this.finishLasso(s, e.type === "pointercancel");
        break;
      case "movingSelection": {
        const drag = this.renderer.selectionDrag;
        this.renderer.selectionDrag = null;
        // A tap inside the selection without movement keeps the selection.
        if (s.moved && drag) this.doc.translateStrokes(this.getSelectedStrokeIds(), drag.dx, drag.dy);
        this.renderer.invalidateStatic();
        break;
      }
      case "panning":
        break;
    }
    this.state = { type: "idle" };
    this.updateCursor();
  }

  private finishLasso(s: Extract<State, { type: "lassoing" }>, cancelled: boolean) {
    this.renderer.lassoPath = null;
    this.renderer.invalidateOverlay();
    if (cancelled) return;
    if (s.maxDistPx < LASSO_CLICK_TOLERANCE_PX) {
      // A tap/click rather than a lasso: deselect.
      if (!s.additive) this.clearStrokeSelection();
      return;
    }
    const poly = simplifyPoints(
      s.points.map((p) => ({ x: p.x, y: p.y })),
      screenLengthToWorld(1.5, this.viewport),
    );
    if (poly.length < 3) {
      if (!s.additive) this.clearStrokeSelection();
      return;
    }
    const hits = this.strokesInLasso(poly);
    if (s.additive) for (const id of hits) this.selectedIds.add(id);
    else this.selectedIds = new Set(hits);
    this.publishStrokeSelection();
  }

  /** Abort whatever is in progress (used when a second finger lands). */
  private cancelCurrent() {
    const s = this.state;
    if (s.type === "drawing") {
      // A stroke that started a few ms before the second finger arrived was
      // almost certainly the start of a gesture, not ink: discard it.
      this.renderer.activeStroke = null;
      this.renderer.invalidateOverlay();
      if (this.el.hasPointerCapture(s.pointerId)) this.el.releasePointerCapture(s.pointerId);
    } else if (s.type === "movingObject") {
      this.renderer.dragPreview = null;
      this.renderer.invalidateStatic();
    } else if (s.type === "erasing") {
      this.doc.closeUndoGroup();
      this.hideEraserCursor();
    } else if (s.type === "lassoing") {
      // Second finger landed: this was a gesture, not a lasso.
      this.renderer.lassoPath = null;
      this.renderer.invalidateOverlay();
      if (this.el.hasPointerCapture(s.pointerId)) this.el.releasePointerCapture(s.pointerId);
    } else if (s.type === "movingSelection") {
      this.renderer.selectionDrag = null;
      this.renderer.invalidateStatic();
    }
    this.state = { type: "idle" };
  }

  private commitStroke(s: Extract<State, { type: "drawing" }>, cancelled: boolean) {
    this.renderer.activeStroke = null;
    this.renderer.invalidateOverlay();
    if (cancelled) return;
    let pts = s.points;
    if (pts.length === 0) return;
    if (pts.length === 1) pts = [pts[0], { ...pts[0], x: pts[0].x + 0.01 }];
    // Light simplification: drop samples that deviate less than a small
    // fraction of the stroke width. Handwriting detail is preserved.
    pts = simplifyPoints(pts, s.width * 0.08);
    this.doc.addStroke({
      tool: s.tool,
      color: s.color,
      width: s.width,
      points: packPoints(pts),
      bounds: computeBounds(pts, s.width),
    });
  }

  // ---- eraser --------------------------------------------------------

  private eraserRadiusWorld() {
    return screenLengthToWorld(ERASER_RADIUS_PX, this.viewport);
  }

  private eraseAlong(from: Point, to: Point) {
    const radius = this.eraserRadiusWorld();
    const sweep = {
      minX: Math.min(from.x, to.x) - radius,
      minY: Math.min(from.y, to.y) - radius,
      maxX: Math.max(from.x, to.x) + radius,
      maxY: Math.max(from.y, to.y) + radius,
    };
    const hits: string[] = [];
    for (const stroke of this.renderer.getStrokes()) {
      const b = stroke.bounds;
      if (b.maxX < sweep.minX || b.minX > sweep.maxX || b.maxY < sweep.minY || b.minY > sweep.maxY) continue;
      const pts: StrokePoint[] = [];
      for (let i = 0; i + 2 < stroke.points.length; i += 3) pts.push({ x: stroke.points[i], y: stroke.points[i + 1] });
      if (strokeSegmentHitTest(pts, stroke.width, from, to, radius)) hits.push(stroke.id);
    }
    if (hits.length) this.doc.removeObjects(hits, true);
  }

  private showEraserCursor(wp: Point) {
    this.renderer.eraserCursor = { x: wp.x, y: wp.y, radius: this.eraserRadiusWorld() };
    this.renderer.invalidateOverlay();
  }

  private hideEraserCursor(_e?: PointerEvent) {
    if (this.renderer.eraserCursor) {
      this.renderer.eraserCursor = null;
      this.renderer.invalidateOverlay();
    }
  }

  // ---- wheel ---------------------------------------------------------

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const sp = this.screenPoint(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch arrives as wheel + ctrlKey; keyboard ctrl+wheel too.
      const factor = Math.exp(-dy * (e.ctrlKey && !e.metaKey ? 0.01 : 0.002));
      this.setViewport(zoomBy(this.viewport, sp, factor));
    } else if (e.shiftKey && dx === 0) {
      this.setViewport(pan(this.viewport, -dy, 0));
    } else {
      this.setViewport(pan(this.viewport, -dx, -dy));
    }
  }
}

export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}
