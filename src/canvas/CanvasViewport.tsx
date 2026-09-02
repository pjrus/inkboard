import { useEffect, useRef } from "react";
import type { CanvasDocument } from "../document/crdt";
import type { Viewport } from "../document/schema";
import { useToolStore } from "../store/toolStore";
import { canvasTheme } from "../theme/canvasTheme";
import { useTheme } from "../theme/ThemeProvider";
import { CanvasInteractionController } from "./CanvasInteractionController";
import { CanvasRenderer } from "./CanvasRenderer";
import { TextEditorOverlay } from "./TextEditorOverlay";

export interface CanvasHandles {
  renderer: CanvasRenderer;
  controller: CanvasInteractionController;
}

interface Props {
  doc: CanvasDocument;
  initialViewport: Viewport;
  onViewportChange: (vp: Viewport) => void;
  onReady: (handles: CanvasHandles | null) => void;
}

/**
 * Thin React host for the imperative canvas. React never re-renders on
 * pointer movement; everything hot lives in the renderer/controller. The one
 * React child is the inline text editor, mounted only while a text box is
 * actually being edited.
 */
export function CanvasViewport({ doc, initialViewport, onViewportChange, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const staticRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const tool = useToolStore((s) => s.tool);
  const editingTextId = useToolStore((s) => s.editingTextId);
  const handlesRef = useRef<CanvasHandles | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const container = containerRef.current!;
    const renderer = new CanvasRenderer(staticRef.current!, overlayRef.current!, doc);
    renderer.setViewport(initialViewport);

    const store = useToolStore;
    const controller = new CanvasInteractionController(container, renderer, doc, {
      getTool: () => store.getState().tool,
      getColor: () => store.getState().color,
      getWidth: () => store.getState().width,
      getTextStyle: () => {
        const s = store.getState();
        return { fontFamily: s.textFont, fontSize: s.textFontSize, color: s.textColor, textAlign: s.textAlign };
      },
      stylusSeen: () => store.getState().stylusSeen,
      onStylusSeen: () => store.getState().markStylusSeen(),
      onViewportChange: (vp) => {
        store.getState().setZoom(vp.scale);
        onViewportChange(vp);
      },
      onSelectionChange: (id) => store.getState().setSelectedObjectId(id),
      onObjectSelectionChange: (sel) => store.getState().setSelection(sel),
      onEditingTextChange: (id) => store.getState().setEditingTextId(id),
    });
    store.getState().setSelectionCommands({
      setWidth: (w) => controller.setSelectionWidth(w),
      adjustWidth: (d) => controller.adjustSelectionWidth(d),
      setColor: (c) => controller.setSelectionColor(c),
      setFont: (f) => controller.setSelectionFont(f),
      setFontSize: (n) => controller.setSelectionFontSize(n),
      adjustFontSize: (d) => controller.adjustSelectionFontSize(d),
      setAlign: (a) => controller.setSelectionAlign(a),
      editText: () => controller.editSelectedText(),
      remove: () => controller.deleteSelection(),
      clear: () => controller.clearObjectSelection(),
    });

    const resize = () => {
      const r = container.getBoundingClientRect();
      renderer.resize(r.width, r.height, Math.min(window.devicePixelRatio || 1, 3));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    window.addEventListener("resize", resize);

    handlesRef.current = { renderer, controller };
    onReady(handlesRef.current);
    store.getState().setZoom(initialViewport.scale);

    return () => {
      store.getState().setSelectionCommands(null);
      store.getState().setSelection(null);
      store.getState().setEditingTextId(null);
      onReady(null);
      handlesRef.current = null;
      ro.disconnect();
      window.removeEventListener("resize", resize);
      controller.destroy();
      renderer.destroy();
    };
    // The document and initial viewport are fixed for the lifetime of a board view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  // A theme change repaints; it never touches the document.
  useEffect(() => {
    handlesRef.current?.renderer.setTheme(canvasTheme(theme));
    useToolStore.getState().setTheme(theme);
  }, [theme]);

  useEffect(() => {
    const controller = handlesRef.current?.controller;
    controller?.updateCursor();
    if (tool !== "pan") controller?.setSelection(null);
    // Selections belong to the tools that can act on them.
    if (tool !== "lasso" && tool !== "text") controller?.clearObjectSelection();
  }, [tool]);

  const handles = handlesRef.current;
  return (
    <div ref={containerRef} className="canvas-host" role="application" aria-label="Drawing canvas">
      <canvas ref={staticRef} className="canvas-layer" />
      <canvas ref={overlayRef} className="canvas-layer" />
      {editingTextId && handles && (
        <TextEditorOverlay
          key={editingTextId}
          doc={doc}
          renderer={handles.renderer}
          objectId={editingTextId}
          onFinish={() => handles.controller.endTextEdit()}
        />
      )}
    </div>
  );
}
