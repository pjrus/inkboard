/**
 * Canvas document schema.
 *
 * These are the plain-object shapes that live inside the CRDT (see crdt.ts).
 * Everything here is serialisable JSON; binary assets (PDF page images, source
 * PDFs) are stored separately in IndexedDB and referenced by `assetId`.
 */

export type Tool = "pan" | "pen" | "pencil" | "eraser" | "lasso" | "text";

/**
 * Whether the board can be edited at all.
 *
 * This is deliberately *not* a tool: View mode outranks the tool, so a pen
 * that is still selected simply cannot draw until Edit mode comes back. It is
 * a local user preference and never enters the CRDT.
 */
export type CanvasMode = "edit" | "view";

/** Which object types the lasso is allowed to pick up. Local, never synced. */
export interface LassoFilter {
  /** Pen and pencil strokes. */
  ink: boolean;
  text: boolean;
  /** Imported images and PDF page images. */
  images: boolean;
}

export const DEFAULT_LASSO_FILTER: LassoFilter = { ink: true, text: true, images: true };

export const MIN_STROKE_WIDTH = 0.5;
export const MAX_STROKE_WIDTH = 40;

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
  /** Radians, clockwise on screen, about the page's centre. */
  rotation: number;
  createdAt: number;
}

/** Ids of the bundled open-source families (see text/fonts.ts). */
export type FontFamilyId = "open-sans" | "inter" | "roboto" | "lato";

export type TextAlign = "left" | "center" | "right";

/** World-space defaults for new text boxes. */
export const DEFAULT_TEXT_WIDTH = 300;
export const MIN_TEXT_WIDTH = 80;
export const MAX_TEXT_WIDTH = 1600;
export const DEFAULT_FONT_SIZE = 20;
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 200;
export const DEFAULT_FONT_FAMILY: FontFamilyId = "open-sans";
/** Multiple of the font size used as the distance between baselines. */
export const TEXT_LINE_HEIGHT = 1.35;

/**
 * A freeform text box.
 *
 * `width` is user-controlled and text wraps inside it; the height follows the
 * wrapped content and is therefore derived rather than stored (see
 * text/textMeasure.ts, which is the single place layout is computed so the
 * canvas, hit testing, lasso and the PDF exporter always agree).
 *
 * Inside the CRDT the `text` field is a Y.Text so two replicas can type into
 * the same box without clobbering each other; `toJSON()` flattens it back to a
 * plain string for the shapes used everywhere else in the app.
 */
export interface TextObject {
  id: string;
  type: "text";
  x: number;
  y: number;
  width: number;
  /** Derived from the wrapped layout; present only on snapshots that cached it. */
  height?: number;
  text: string;
  fontFamily: FontFamilyId;
  /** World-space, so text zooms with strokes and pages. */
  fontSize: number;
  color: string;
  textAlign?: TextAlign;
  /** Radians, clockwise on screen, about the box's centre. */
  rotation?: number;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
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
