import type { CanvasDocument } from "../document/crdt";
import type { CanvasMode, CanvasObject, FontFamilyId, LassoFilter, PenTool, StrokePoint, TextAlign, TextObject, Tool, Viewport } from "../document/schema";
import { MAX_TEXT_WIDTH, MIN_TEXT_WIDTH, packPoints } from "../document/schema";
import { DEFAULT_TEXT_WIDTH } from "../document/schema";
import { lineHeightFor } from "../text/textLayout";
import { pan, screenLengthToWorld, screenToWorld, zoomBy, type Point } from "./coordinates";
import { beginPinch, updatePinch, type PinchStart } from "./gestures";
import type { CanvasRenderer } from "./CanvasRenderer";
import { computeBounds, polygonBounds, simplifyPoints, strokeSegmentHitTest, type XY } from "./strokeGeometry";
import { isImageLikeObject, lassoHits, snapAngle, toDegrees } from "./transform";
import type { CanvasSelection } from "../store/toolStore";

/**
 * Central pointer/wheel/keyboard state machine for the canvas.
 *
 * States are explicit so conflicting interactions (pinch while drawing,
 * dragging a page while inking, resizing a text box while panning) are
 * impossible by construction. Text editing lives in a DOM overlay outside this
 * class; the controller only decides when it opens and closes.
 */
type State =
  | { type: "idle" }
  | { type: "drawing"; pointerId: number; points: StrokePoint[]; tool: PenTool; color: string; width: number; hasPressure: boolean }
  | { type: "erasing"; pointerId: number; last: Point }
  | { type: "panning"; pointerId: number; last: Point }
  | { type: "pinching"; pinch: PinchStart }
  | { type: "movingObject"; pointerId: number; objectId: string; start: Point; moved: boolean }
  | { type: "lassoing"; pointerId: number; points: XY[]; additive: boolean; startScreen: Point; maxDistPx: number }
  | { type: "movingSelection"; pointerId: number; start: Point; moved: boolean }
  | { type: "rotatingSelection"; pointerId: number; pivot: Point; startAngle: number; angle: number }
  | { type: "resizingText"; pointerId: number; id: string; startScreenX: number; startWidth: number };

export interface TextStyle {
  fontFamily: FontFamilyId;
  fontSize: number;
  color: string;
  textAlign: TextAlign;
}

export interface ControllerHost {
  getTool(): Tool;
  /**
   * View mode outranks the tool: while it is active nothing on the board can
   * be created, moved, rotated, edited or deleted, whatever tool is selected.
   */
  getMode(): CanvasMode;
  /** Which object types the lasso may pick up. Local preference, never synced. */
  getLassoFilter(): LassoFilter;
  getColor(): string;
  getWidth(): number;
  /** Settings applied to the *next* text box the user creates. */
  getTextStyle(): TextStyle;
  /** True once a stylus has been used: fingers then navigate only. */
  stylusSeen(): boolean;
  onStylusSeen(): void;
  onViewportChange(vp: Viewport): void;
  onSelectionChange(id: string | null): void;
  onObjectSelectionChange(sel: CanvasSelection | null): void;
  onEditingTextChange(id: string | null): void;
}

const ERASER_RADIUS_PX = 12;
const LASSO_CLICK_TOLERANCE_PX = 4;
const SELECTION_GRAB_PAD_PX = 8;
const DRAG_THRESHOLD_PX = 3;
const TEXT_HIT_PAD_PX = 4;
const DOUBLE_TAP_MS = 400;
const DOUBLE_TAP_SLOP_PX = 16;

export class CanvasInteractionController {
  private state: State = { type: "idle" };
  private touches = new Map<number, Point>();
  private spaceDown = false;
  private disposers: (() => void)[] = [];
  /** Local object selection; never enters the document. */
  private selectedIds = new Set<string>();
  private editingTextId: string | null = null;
  private lastTap: { t: number; x: number; y: number; id: string | null } | null = null;

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
        for (const c of changes) {
          if (c.kind === "remove" && c.id === this.editingTextId) this.endTextEdit(false);
        }
        if (this.selectedIds.size === 0) return;
        let touched = false;
        for (const c of changes) {
          if (!this.selectedIds.has(c.id)) continue;
          touched = true;
          if (c.kind === "remove") this.selectedIds.delete(c.id);
        }
        if (touched) this.publishSelection();
      }),
    );
  }

  // ---- object selection ----------------------------------------------

  getSelectedIds(): string[] {
    return Array.from(this.selectedIds);
  }

  clearObjectSelection() {
    if (this.selectedIds.size === 0) {
      if (this.editingTextId) this.endTextEdit();
      return;
    }
    this.selectedIds.clear();
    if (this.editingTextId) this.endTextEdit();
    this.publishSelection();
  }

  /** The object behind a selected id. Every object type is selectable. */
  private selectable(id: string): CanvasObject | undefined {
    return this.doc.get(id);
  }

  private selectedIdsOfType(type: "stroke" | "text"): string[] {
    const out: string[] = [];
    for (const id of this.selectedIds) if (this.selectable(id)?.type === type) out.push(id);
    return out;
  }

  /** Editing is refused outright while the board is in View mode. */
  private get editable(): boolean {
    return this.host.getMode() === "edit";
  }

  /**
   * Leave any in-flight interaction and drop the local selection.
   *
   * Called when switching into View mode: pending text is committed, handles
   * and lassos disappear and the viewport is left exactly where it was.
   * Nothing in the document is deleted or modified.
   */
  cancelInteractions() {
    if (this.editingTextId) this.endTextEdit();
    this.cancelCurrent();
    this.clearObjectSelection();
    this.setSelection(null);
    this.updateCursor();
  }

  setSelectionWidth(width: number) {
    this.doc.setStrokeWidth(this.selectedIdsOfType("stroke"), width);
  }

  adjustSelectionWidth(direction: 1 | -1) {
    this.doc.adjustStrokeWidths(this.selectedIdsOfType("stroke"), direction);
  }

  /** Colour applies to the whole selection: strokes and text both have one. */
  setSelectionColor(color: string) {
    this.doc.updateObjects(this.getSelectedIds(), { color });
  }

  setSelectionFont(fontFamily: FontFamilyId) {
    this.doc.setTextProperties(this.selectedIdsOfType("text"), { fontFamily });
  }

  setSelectionFontSize(fontSize: number) {
    this.doc.setTextProperties(this.selectedIdsOfType("text"), { fontSize });
  }

  adjustSelectionFontSize(direction: 1 | -1) {
    this.doc.adjustTextFontSizes(this.selectedIdsOfType("text"), direction);
  }

  setSelectionAlign(textAlign: TextAlign) {
    this.doc.setTextProperties(this.selectedIdsOfType("text"), { textAlign });
  }

  /**
   * Rotate the whole selection about its shared centre, as one undo step.
   * Used by the contextual toolbar's quarter-turn buttons; the drag handle
   * commits through the same document command.
   */
  rotateSelection(angleDelta: number) {
    const pivot = this.renderer.selectionPivot();
    if (!pivot) return;
    this.doc.rotateObjects(this.getSelectedIds(), angleDelta, pivot);
  }

  deleteSelection() {
    const ids = this.getSelectedIds();
    this.selectedIds.clear();
    if (this.editingTextId) this.endTextEdit(false);
    this.doc.removeObjects(ids);
    this.publishSelection();
  }

  private publishSelection() {
    this.renderer.selectedIds = new Set(this.selectedIds);
    this.renderer.invalidateStatic();
    if (this.selectedIds.size === 0) {
      this.host.onObjectSelectionChange(null);
      return;
    }
    const sel: CanvasSelection = { ids: [], strokeIds: [], textIds: [], imageIds: [], widths: [], colors: [], fonts: [], fontSizes: [], aligns: [] };
    for (const id of this.selectedIds) {
      const o = this.selectable(id);
      if (!o) continue;
      sel.ids.push(id);
      if (isImageLikeObject(o)) {
        sel.imageIds.push(id);
      } else if (o.type === "stroke") {
        sel.strokeIds.push(id);
        sel.widths.push(o.width);
        sel.colors.push(o.color);
      } else if (o.type === "text") {
        sel.textIds.push(id);
        sel.colors.push(o.color);
        sel.fonts.push(o.fontFamily);
        sel.fontSizes.push(o.fontSize);
        sel.aligns.push(o.textAlign ?? "left");
      }
    }
    this.host.onObjectSelectionChange(sel.ids.length ? sel : null);
  }

  // ---- text ----------------------------------------------------------

  /** Create a text box at a world point and open the inline editor on it. */
  createTextAt(wp: Point): TextObject {
    const style = this.host.getTextStyle();
    // Anchor the click at the middle of the first line, where a caret would be.
    const y = wp.y - lineHeightFor(style.fontSize) / 2;
    this.doc.closeUndoGroup();
    const obj = this.doc.addText(
      {
        x: wp.x,
        y,
        width: DEFAULT_TEXT_WIDTH,
        text: "",
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        color: style.color,
        textAlign: style.textAlign,
      },
      true,
    );
    this.selectedIds = new Set([obj.id]);
    this.publishSelection();
    this.beginTextEdit(obj.id);
    return obj;
  }

  beginTextEdit(id: string) {
    if (this.editingTextId === id) return;
    if (this.doc.get(id)?.type !== "text") return;
    this.editingTextId = id;
    this.renderer.editingTextId = id;
    this.renderer.invalidateStatic();
    this.host.onEditingTextChange(id);
  }

  /**
   * Leave editing. A box the user never typed into is removed again; because
   * creation and removal share one undo capture group, an abandoned box does
   * not litter the history with a phantom object.
   */
  endTextEdit(removeIfEmpty = true) {
    const id = this.editingTextId;
    if (!id) return;
    this.editingTextId = null;
    this.renderer.editingTextId = null;
    const obj = this.doc.get(id);
    if (removeIfEmpty && obj?.type === "text" && obj.text.trim() === "") {
      this.doc.removeObjects([id], true);
      this.selectedIds.delete(id);
      this.publishSelection();
    } else if (obj?.type === "text") {
      this.doc.touchText(id);
    }
    this.doc.closeUndoGroup();
    this.renderer.invalidateStatic();
    this.host.onEditingTextChange(null);
    this.publishSelection();
  }

  /** Enter editing on the single selected text box (used by the toolbar). */
  editSelectedText() {
    const ids = this.selectedIdsOfType("text");
    if (ids.length === 1) this.beginTextEdit(ids[0]);
  }

  setTextWidth(id: string, width: number) {
    this.doc.setTextProperties([id], { width: clampTextWidth(width) });
  }

  // ---- lasso ---------------------------------------------------------

  /**
   * Objects inside a world-space lasso polygon.
   *
   * The user's type filter is applied *first*, so a disabled type costs one
   * boolean rather than a polygon test per object. That ordering is what makes
   * "select my handwriting, not the PDF page underneath it" cheap as well as
   * possible. Then a bounds prefilter, then the real geometry.
   */
  private objectsInLasso(poly: XY[]): string[] {
    const filter = this.host.getLassoFilter();
    const pb = polygonBounds(poly);
    // Bounds prefilter here (an index query the renderer already keeps lists
    // for), type filter and polygon geometry in lassoHits.
    const candidates: CanvasObject[] = [];
    if (filter.ink) candidates.push(...this.renderer.getStrokesInBounds(pb));
    if (filter.text) candidates.push(...this.renderer.getTextsInBounds(pb));
    if (filter.images) candidates.push(...this.renderer.getPagesInBounds(pb));
    return lassoHits(candidates, poly, filter).map((o) => o.id);
  }

  /** True while the pointer is over the selection's rotation grip. */
  private onRotationHandle(wp: Point): boolean {
    const h = this.renderer.rotationHandle();
    return h !== null && Math.hypot(wp.x - h.x, wp.y - h.y) <= h.radius;
  }

  private beginRotation(wp: Point, pointerId: number): boolean {
    const pivot = this.renderer.selectionPivot();
    if (!pivot) return false;
    this.state = {
      type: "rotatingSelection",
      pointerId,
      pivot,
      // Every frame measures against this starting angle rather than the
      // previous frame, so a long gesture cannot accumulate drift.
      startAngle: Math.atan2(wp.y - pivot.y, wp.x - pivot.x),
      angle: 0,
    };
    this.renderer.selectionPreview = { dx: 0, dy: 0, angle: 0, pivot };
    this.renderer.angleLabel = "0°";
    this.renderer.invalidateStatic();
    this.renderer.invalidateOverlay();
    this.updateCursor();
    return true;
  }

  private pointInSelection(wp: Point): boolean {
    const b = this.renderer.getSelectionBounds();
    if (!b) return false;
    const pad = screenLengthToWorld(SELECTION_GRAB_PAD_PX, this.viewport);
    return wp.x >= b.minX - pad && wp.x <= b.maxX + pad && wp.y >= b.minY - pad && wp.y <= b.maxY + pad;
  }

  private onResizeHandle(wp: Point): boolean {
    const h = this.renderer.textResizeHandle();
    if (!h) return false;
    return Math.hypot(wp.x - h.x, wp.y - h.y) <= h.radius;
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
    else if (this.state.type === "rotatingSelection") cursor = "grabbing";
    else if (this.state.type === "resizingText") cursor = "ew-resize";
    // In View mode the canvas is one big pannable surface, whatever the tool.
    else if (!this.editable) cursor = "grab";
    else if (this.spaceDown || tool === "pan") cursor = "grab";
    else if (tool === "text") cursor = "text";
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

  /** Second tap on the same object within the double-tap window. */
  private isDoubleTap(sp: Point, id: string | null): boolean {
    const now = Date.now();
    const prev = this.lastTap;
    this.lastTap = { t: now, x: sp.x, y: sp.y, id };
    return (
      prev !== null &&
      prev.id === id &&
      id !== null &&
      now - prev.t < DOUBLE_TAP_MS &&
      Math.hypot(sp.x - prev.x, sp.y - prev.y) < DOUBLE_TAP_SLOP_PX
    );
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

    // A press anywhere on the canvas means "outside the editor": commit the
    // text and swallow this press, so finishing an edit never also draws.
    if (this.editingTextId) {
      this.endTextEdit();
      return;
    }

    const tool = this.host.getTool();
    const fingerNavigates = e.pointerType === "touch" && this.host.stylusSeen();
    const wp = screenToWorld(sp, this.viewport);

    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // Some browsers throw if the pointer is already gone; drawing still works.
    }

    // View mode: every press navigates, including a stylus drag. No drawing,
    // no erasing, no lasso, no moving a page by accident.
    if (!this.editable) {
      this.state = { type: "panning", pointerId: e.pointerId, last: sp };
      this.updateCursor();
      return;
    }

    // Grips win over everything else while they are showing.
    if (this.selectedIds.size > 0 && this.onRotationHandle(wp) && this.beginRotation(wp, e.pointerId)) return;

    if ((tool === "lasso" || tool === "text" || tool === "pan") && this.onResizeHandle(wp)) {
      const t = this.renderer.soleSelectedText();
      if (t) {
        this.state = { type: "resizingText", pointerId: e.pointerId, id: t.id, startScreenX: sp.x, startWidth: t.width };
        this.updateCursor();
        return;
      }
    }

    if (e.button === 1 || this.spaceDown || fingerNavigates || tool === "pan") {
      if (tool === "pan" && !this.spaceDown && e.button === 0) {
        // Text sits above pages, so it is hit-tested first.
        const text = this.renderer.hitTestText(wp, screenLengthToWorld(TEXT_HIT_PAD_PX, this.viewport));
        if (text) {
          this.setSelection(null);
          this.beginTextInteraction(text, sp, e);
          return;
        }
        const page = this.renderer.hitTestPage(wp);
        if (page) {
          this.setSelection(page.id);
          this.state = { type: "movingObject", pointerId: e.pointerId, objectId: page.id, start: sp, moved: false };
          this.updateCursor();
          return;
        }
        this.setSelection(null);
        this.clearObjectSelection();
      }
      this.state = { type: "panning", pointerId: e.pointerId, last: sp };
      this.updateCursor();
      return;
    }

    if (tool === "text") {
      const text = this.renderer.hitTestText(wp, screenLengthToWorld(TEXT_HIT_PAD_PX, this.viewport));
      if (text) {
        this.beginTextInteraction(text, sp, e);
        return;
      }
      this.lastTap = null;
      // Cancelling the press suppresses the compatibility mouse events, and
      // with them the browser's default "focus what was clicked" behaviour -
      // which would otherwise pull focus out of the editor we are about to
      // open and end the edit before a single character could be typed.
      e.preventDefault();
      this.createTextAt(wp);
      return;
    }

    if (tool === "pen" || tool === "pencil") {
      const hasPressure = e.pointerType === "pen";
      const points: StrokePoint[] = [{ x: wp.x, y: wp.y, pressure: hasPressure ? e.pressure : 0.5 }];
      this.state = { type: "drawing", pointerId: e.pointerId, points, tool, color: this.host.getColor(), width: this.host.getWidth(), hasPressure };
      this.renderer.activeStroke = { points, tool, color: this.host.getColor(), width: this.host.getWidth(), hasPressure };
      this.renderer.invalidateOverlay();
      return;
    }

    if (tool === "lasso") {
      if (this.selectedIds.size > 0 && this.pointInSelection(wp)) {
        // Double-tapping a selected text box opens it for editing.
        const text = this.renderer.hitTestText(wp);
        if (text && this.selectedIds.has(text.id) && this.isDoubleTap(sp, text.id)) {
          this.beginTextEdit(text.id);
          return;
        }
        this.state = { type: "movingSelection", pointerId: e.pointerId, start: sp, moved: false };
        this.updateCursor();
        return;
      }
      const text = this.renderer.hitTestText(wp, screenLengthToWorld(TEXT_HIT_PAD_PX, this.viewport));
      if (text) {
        this.beginTextInteraction(text, sp, e);
        return;
      }
      this.state = { type: "lassoing", pointerId: e.pointerId, points: [wp], additive: e.shiftKey, startScreen: sp, maxDistPx: 0 };
      this.renderer.lassoPath = this.state.points;
      this.renderer.invalidateOverlay();
      return;
    }

    if (tool === "eraser") {
      this.doc.closeUndoGroup();
      this.state = { type: "erasing", pointerId: e.pointerId, last: wp };
      this.eraseAlong(wp, wp);
      this.showEraserCursor(wp);
    }
  }

  /** Click selects a text box; a second click on the same box edits it. */
  private beginTextInteraction(text: TextObject, sp: Point, e: PointerEvent) {
    const doubled = this.isDoubleTap(sp, text.id);
    if (!e.shiftKey && !this.selectedIds.has(text.id)) this.selectedIds = new Set([text.id]);
    else if (e.shiftKey) this.selectedIds.add(text.id);
    this.publishSelection();
    if (doubled) {
      e.preventDefault(); // keep focus for the editor (see the text tool above)
      this.beginTextEdit(text.id);
      this.state = { type: "idle" };
      return;
    }
    this.state = { type: "movingSelection", pointerId: e.pointerId, start: sp, moved: false };
    this.updateCursor();
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
        // Transient: the CRDT only hears about the move on pointer up.
        this.renderer.selectionPreview = {
          dx: dxPx / this.viewport.scale,
          dy: dyPx / this.viewport.scale,
          angle: 0,
          pivot: { x: 0, y: 0 },
        };
        this.renderer.invalidateStatic();
        return;
      }
      case "rotatingSelection": {
        if (e.pointerId !== s.pointerId) return;
        const wp = screenToWorld(sp, this.viewport);
        const current = Math.atan2(wp.y - s.pivot.y, wp.x - s.pivot.x);
        // Always measured from the gesture's starting angle, never from the
        // previous frame: no accumulated drift over a long rotation.
        s.angle = e.shiftKey ? snapAngle(current - s.startAngle) : current - s.startAngle;
        this.renderer.selectionPreview = { dx: 0, dy: 0, angle: s.angle, pivot: s.pivot };
        this.renderer.angleLabel = `${toDegrees(s.angle)}°`;
        this.renderer.invalidateStatic();
        this.renderer.invalidateOverlay();
        return;
      }
      case "resizingText": {
        if (e.pointerId !== s.pointerId) return;
        const width = clampTextWidth(s.startWidth + (sp.x - s.startScreenX) / this.viewport.scale);
        this.renderer.textResize = { id: s.id, width };
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
        const drag = this.renderer.selectionPreview;
        this.renderer.selectionPreview = null;
        // A tap inside the selection without movement keeps the selection.
        // One drag, one CRDT transaction, one undo entry.
        if (s.moved && drag) this.doc.translateObjects(this.getSelectedIds(), drag.dx, drag.dy);
        this.renderer.invalidateStatic();
        break;
      }
      case "rotatingSelection": {
        this.renderer.selectionPreview = null;
        this.renderer.angleLabel = null;
        // One gesture, one CRDT transaction, one undo entry.
        if (s.angle !== 0) this.doc.rotateObjects(this.getSelectedIds(), s.angle, s.pivot);
        this.renderer.invalidateStatic();
        this.renderer.invalidateOverlay();
        break;
      }
      case "resizingText": {
        const resize = this.renderer.textResize;
        this.renderer.textResize = null;
        if (resize && Math.abs(resize.width - s.startWidth) > 0.5) this.setTextWidth(s.id, resize.width);
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
      if (!s.additive) this.clearObjectSelection();
      return;
    }
    const poly = simplifyPoints(
      s.points.map((p) => ({ x: p.x, y: p.y })),
      screenLengthToWorld(1.5, this.viewport),
    );
    if (poly.length < 3) {
      if (!s.additive) this.clearObjectSelection();
      return;
    }
    const hits = this.objectsInLasso(poly);
    if (s.additive) for (const id of hits) this.selectedIds.add(id);
    else this.selectedIds = new Set(hits);
    this.publishSelection();
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
    } else if (s.type === "movingSelection" || s.type === "rotatingSelection") {
      this.renderer.selectionPreview = null;
      this.renderer.angleLabel = null;
      this.renderer.invalidateStatic();
      this.renderer.invalidateOverlay();
    } else if (s.type === "resizingText") {
      this.renderer.textResize = null;
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

export function clampTextWidth(width: number): number {
  return Math.min(MAX_TEXT_WIDTH, Math.max(MIN_TEXT_WIDTH, width));
}

export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}
