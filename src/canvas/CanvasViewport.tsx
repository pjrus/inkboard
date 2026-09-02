import { useEffect, useRef } from "react";
import type { CanvasDocument } from "../document/crdt";
import type { Viewport } from "../document/schema";
import { useToolStore } from "../store/toolStore";
import { CanvasInteractionController } from "./CanvasInteractionController";
import { CanvasRenderer } from "./CanvasRenderer";

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
 * pointer movement; everything hot lives in the renderer/controller.
 */
export function CanvasViewport({ doc, initialViewport, onViewportChange, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const staticRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const tool = useToolStore((s) => s.tool);
  const handlesRef = useRef<CanvasHandles | null>(null);

  useEffect(() => {
    const container = containerRef.current!;
    const renderer = new CanvasRenderer(staticRef.current!, overlayRef.current!, doc);
    renderer.setViewport(initialViewport);

    const store = useToolStore;
    const controller = new CanvasInteractionController(container, renderer, doc, {
      getTool: () => store.getState().tool,
      getColor: () => store.getState().color,
      getWidth: () => store.getState().width,
      stylusSeen: () => store.getState().stylusSeen,
      onStylusSeen: () => store.getState().markStylusSeen(),
      onViewportChange: (vp) => {
        store.getState().setZoom(vp.scale);
        onViewportChange(vp);
      },
      onSelectionChange: (id) => store.getState().setSelectedObjectId(id),
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

  useEffect(() => {
    handlesRef.current?.controller.updateCursor();
    if (tool !== "pan") handlesRef.current?.controller.setSelection(null);
  }, [tool]);

  return (
    <div ref={containerRef} className="canvas-host" role="application" aria-label="Drawing canvas">
      <canvas ref={staticRef} className="canvas-layer" />
      <canvas ref={overlayRef} className="canvas-layer" />
    </div>
  );
}
