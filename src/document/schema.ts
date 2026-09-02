/**
 * Canvas document schema.
 *
 * These are the plain-object shapes that live inside the CRDT (see crdt.ts).
 * Everything here is serialisable JSON; binary assets (PDF page images, source
 * PDFs) are stored separately in IndexedDB and referenced by `assetId`.
 */

export type Tool = "pan" | "pen" | "pencil" | "eraser";

export type PenTool = "pen" | "pencil";

export interface StrokePoint {
  x: number;
  y: number;
  /** 0..1, absent for devices without pressure. */
  pressure?: number;
  /** ms since stroke start (kept small on purpose). */
  t?: number;
}

export interface StrokeObject {
  id: string;
  type: "stroke";
  tool: PenTool;
  color: string;
  /** World-space width. */
  width: number;
  /** Flat array [x0, y0, p0, x1, y1, p1, ...] for compact CRDT storage. */
  points: number[];
  /** Cached bounding box in world space. */
  bounds: Bounds;
  createdAt: number;
  createdBy?: string;
}

export interface PDFPageObject {
  id: string;
  type: "pdf-page";
  assetId: string;
  pdfDocumentId: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  createdAt: number;
}

/** Reserved for a later milestone. Not rendered or created yet. */
export interface TextObject {
  id: string;
  type: "text";
  x: number;
  y: number;
  width?: number;
  height?: number;
  text: string;
  fontSize: number;
  fontFamily?: string;
  color: string;
  createdAt: number;
}

export type CanvasObject = StrokeObject | PDFPageObject | TextObject;

export type PDFLayout = "vertical" | "horizontal";

export interface PDFDocumentMetadata {
  id: string;
  fileName: string;
  pageCount: number;
  layout: PDFLayout;
  /** Asset id of the retained original PDF blob, if kept. */
  sourceAssetId?: string;
  createdAt: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Viewport {
  /** Screen-space translation (CSS px) of world origin. */
  x: number;
  y: number;
  /** Screen px per world unit. */
  scale: number;
}

export interface BoardMetadata {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  viewport?: Viewport;
}

/** Deterministic z-order for rendering layers. */
export const LAYER = {
  background: 0,
  pdfPages: 10,
  strokes: 20,
  text: 30,
  selection: 100,
  ui: 1000,
} as const;

/** Explode a flat stroke point array into StrokePoint objects. */
export function unpackPoints(flat: number[]): StrokePoint[] {
  const out: StrokePoint[] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    out.push({ x: flat[i], y: flat[i + 1], pressure: flat[i + 2] });
  }
  return out;
}

export function packPoints(points: StrokePoint[]): number[] {
  const flat: number[] = new Array(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    flat[i * 3] = p.x;
    flat[i * 3 + 1] = p.y;
    flat[i * 3 + 2] = p.pressure ?? 0.5;
  }
  return flat;
}
