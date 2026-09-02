import type { Bounds, TextObject } from "../document/schema";
import { canvasFont } from "./fonts";
import { onFontsReady } from "./fontLoader";
import { layoutText, type Measure, type TextLayoutResult } from "./textLayout";

/**
 * The one place on-screen text layout is computed.
 *
 * Hit testing, lasso selection, viewport culling, the renderer and the editing
 * overlay all read layout from here, so a text box's geometry can never drift
 * from what is actually drawn (there is only one layout to drift from).
 *
 * Measurement uses a single offscreen 2D context. Results are memoised on the
 * fields that affect layout - text, family, size, width, alignment - and the
 * whole cache is dropped when the web fonts finish loading, because metrics
 * measured against a fallback face would be wrong.
 */

const MAX_LAYOUTS = 600;
const MAX_MEASUREMENTS = 8000;

/** Measure at a fixed reference size and scale, so one cache serves all sizes. */
const REFERENCE_SIZE = 100;

let ctx: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();
const layouts = new Map<string, TextLayoutResult>();
const invalidationListeners = new Set<() => void>();

function context(): CanvasRenderingContext2D | null {
  if (ctx === undefined) {
    ctx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  }
  return ctx;
}

function measureAt(fontFamily: string, text: string): number {
  const c = context();
  if (!c) return text.length * REFERENCE_SIZE * 0.5; // headless fallback
  const key = `${fontFamily} ${text}`;
  const hit = widths.get(key);
  if (hit !== undefined) return hit;
  c.font = canvasFont(fontFamily, REFERENCE_SIZE);
  const w = c.measureText(text).width;
  if (widths.size > MAX_MEASUREMENTS) widths.clear();
  widths.set(key, w);
  return w;
}

/** A `Measure` for a specific family and size, backed by the shared cache. */
export function measurer(fontFamily: string, fontSize: number): Measure {
  const scale = fontSize / REFERENCE_SIZE;
  return (text: string) => measureAt(fontFamily, text) * scale;
}

type LayoutInput = Pick<TextObject, "text" | "fontFamily" | "fontSize" | "width" | "textAlign">;

function layoutKey(o: LayoutInput): string {
  return `${o.fontFamily} ${o.fontSize} ${o.width} ${o.textAlign ?? "left"} ${o.text}`;
}

export function measureText(o: LayoutInput): TextLayoutResult {
  const key = layoutKey(o);
  const hit = layouts.get(key);
  if (hit) return hit;
  const result = layoutText(
    o.text,
    { width: o.width, fontSize: o.fontSize, fontFamily: o.fontFamily, align: o.textAlign },
    measurer(o.fontFamily, o.fontSize),
  );
  if (layouts.size > MAX_LAYOUTS) layouts.clear();
  layouts.set(key, result);
  return result;
}

/** Height a text box occupies once wrapped. */
export function textHeight(o: LayoutInput): number {
  return measureText(o).height;
}

/** World-space bounds of a text box, optionally offset by a live drag. */
export function textBounds(o: TextObject, dx = 0, dy = 0): Bounds {
  const h = textHeight(o);
  return { minX: o.x + dx, minY: o.y + dy, maxX: o.x + dx + o.width, maxY: o.y + dy + h };
}

/** Drop every cached measurement, e.g. once the real fonts have loaded. */
export function invalidateTextMeasurements(): void {
  widths.clear();
  layouts.clear();
  for (const l of invalidationListeners) l();
}

export function onTextMeasurementsInvalidated(fn: () => void): () => void {
  invalidationListeners.add(fn);
  return () => invalidationListeners.delete(fn);
}

onFontsReady(() => invalidateTextMeasurements());
