import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasInteractionController } from "../../canvas/CanvasInteractionController";
import type { CanvasRenderer } from "../../canvas/CanvasRenderer";
import { DEFAULT_VIEWPORT } from "../../canvas/coordinates";
import { CanvasDocument } from "../../document/crdt";
import { DEFAULT_LASSO_FILTER, type Tool } from "../../document/schema";

function makeFakeElement() {
  const listeners = new Map<string, Set<(e: any) => void>>();
  const captures = new Set<number>();
  return {
    style: { cursor: "default" },
    addEventListener(type: string, fn: (e: any) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (e: any) => void) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type: string, event: any) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    setPointerCapture: (id: number) => captures.add(id),
    releasePointerCapture: (id: number) => captures.delete(id),
    hasPointerCapture: (id: number) => captures.has(id),
  };
}

function makeFakeWindow() {
  const listeners = new Map<string, Set<(e: any) => void>>();
  return {
    addEventListener(type: string, fn: (e: any) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (e: any) => void) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type: string, event: any = {}) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
  };
}

function makePointerEvent(
  overrides: Partial<{
    type: string;
    pointerId: number;
    pointerType: string;
    clientX: number;
    clientY: number;
    button: number;
    pressure: number;
    shiftKey: boolean;
  }> = {},
) {
  return {
    type: "pointerdown",
    pointerId: 1,
    pointerType: "touch",
    clientX: 100,
    clientY: 100,
    button: 0,
    pressure: 0.5,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...overrides,
  };
}

describe("CanvasInteractionController", () => {
  const origWindow = globalThis.window;
  let fakeWindow: ReturnType<typeof makeFakeWindow>;

  beforeEach(() => {
    fakeWindow = makeFakeWindow();
    (globalThis as any).window = fakeWindow;
  });

  afterEach(() => {
    (globalThis as any).window = origWindow;
  });

  function setup(initialTool: Tool = "pen") {
    let tool: Tool = initialTool;
    let viewport = { ...DEFAULT_VIEWPORT };
    const el = makeFakeElement();
    const doc = new CanvasDocument();
    const strokes = () => doc.getAll().filter((o) => o.type === "stroke");

    const renderer = {
      selectedIds: new Set<string>(),
      selectedId: null,
      activeStroke: null,
      eraserCursor: null,
      dragPreview: null,
      selectionPreview: null,
      angleLabel: null,
      textResize: null,
      editingTextId: null,
      lassoPath: null,
      cropSession: null,
      getViewport: () => viewport,
      setViewport: (vp: typeof viewport) => {
        viewport = vp;
      },
      getSize: () => ({ width: 800, height: 600 }),
      invalidateStatic: vi.fn(),
      invalidateOverlay: vi.fn(),
      getStrokes: strokes,
      hitTestText: () => undefined,
      hitTestPage: () => undefined,
      hitTestLink: () => null,
      rotationHandle: () => null,
      textResizeHandle: () => null,
      selectionPivot: () => null,
      getSelectionBounds: () => null,
    } as unknown as CanvasRenderer;

    const controller = new CanvasInteractionController(
      el as unknown as HTMLElement,
      renderer,
      doc,
      {
        getTool: () => tool,
        getMode: () => "edit",
        getLassoFilter: () => DEFAULT_LASSO_FILTER,
        getColor: () => "#1b1b1f",
        getWidth: () => 3,
        getTextStyle: () => ({
          fontFamily: "open-sans",
          fontSize: 20,
          color: "#1b1b1f",
          textAlign: "left",
        }),
        stylusSeen: () => false,
        onStylusSeen: vi.fn(),
        onViewportChange: vi.fn(),
        onSelectionChange: vi.fn(),
        onObjectSelectionChange: vi.fn(),
        onEditingTextChange: vi.fn(),
      },
    );

    return {
      el,
      doc,
      controller,
      setTool: (t: Tool) => {
        tool = t;
      },
    };
  }

  it("clears leaked pinch touch IDs on window pointerup so single-finger drawing recovers", () => {
    const { el, doc, controller } = setup("pen");

    // First finger starts drawing, second finger switches to pinching.
    el.dispatch(
      "pointerdown",
      makePointerEvent({ pointerId: 1, clientX: 50, clientY: 50 }),
    );
    el.dispatch(
      "pointerdown",
      makePointerEvent({ pointerId: 2, clientX: 150, clientY: 50 }),
    );
    expect(doc.getAll()).toHaveLength(0);

    // First finger lifts on element; second finger lifts outside element (window only).
    el.dispatch(
      "pointerup",
      makePointerEvent({ type: "pointerup", pointerId: 1 }),
    );
    fakeWindow.dispatch(
      "pointerup",
      makePointerEvent({ type: "pointerup", pointerId: 2 }),
    );

    // Next single-finger touch must draw a stroke instead of entering pinch mode.
    el.dispatch(
      "pointerdown",
      makePointerEvent({ pointerId: 3, clientX: 20, clientY: 20 }),
    );
    el.dispatch(
      "pointermove",
      makePointerEvent({
        type: "pointermove",
        pointerId: 3,
        clientX: 80,
        clientY: 80,
      }),
    );
    el.dispatch(
      "pointerup",
      makePointerEvent({
        type: "pointerup",
        pointerId: 3,
        clientX: 80,
        clientY: 80,
      }),
    );

    expect(doc.getAll()).toHaveLength(1);
    controller.destroy();
    doc.destroy();
  });

  it("splits a stroke with the precision eraser", () => {
    const { el, doc, controller, setTool } = setup("pen");
    doc.addStroke({
      tool: "pen",
      color: "#000000",
      width: 2,
      points: [0, 50, 0.5, 200, 50, 0.5],
      bounds: { minX: -2, minY: 48, maxX: 202, maxY: 52 },
    });

    setTool("eraser");
    el.dispatch(
      "pointerdown",
      makePointerEvent({
        pointerType: "mouse",
        pointerId: 1,
        clientX: 100,
        clientY: 50,
      }),
    );
    el.dispatch(
      "pointerup",
      makePointerEvent({
        type: "pointerup",
        pointerType: "mouse",
        pointerId: 1,
        clientX: 100,
        clientY: 50,
      }),
    );

    expect(doc.getAll()).toHaveLength(2);
    controller.destroy();
    doc.destroy();
  });

  it("deletes the whole stroke with the object eraser (strokeEraser)", () => {
    const { el, doc, controller, setTool } = setup("pen");
    doc.addStroke({
      tool: "pen",
      color: "#000000",
      width: 2,
      points: [0, 50, 0.5, 200, 50, 0.5],
      bounds: { minX: -2, minY: 48, maxX: 202, maxY: 52 },
    });

    setTool("strokeEraser");
    el.dispatch(
      "pointerdown",
      makePointerEvent({
        pointerType: "mouse",
        pointerId: 1,
        clientX: 100,
        clientY: 50,
      }),
    );
    el.dispatch(
      "pointerup",
      makePointerEvent({
        type: "pointerup",
        pointerType: "mouse",
        pointerId: 1,
        clientX: 100,
        clientY: 50,
      }),
    );

    expect(doc.getAll()).toHaveLength(0);
    controller.destroy();
    doc.destroy();
  });
});
