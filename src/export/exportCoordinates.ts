import type { Bounds } from "../document/schema";

/**
 * World space to PDF page space.
 *
 * The canvas has a top-left origin with y growing downwards; PDF has a
 * bottom-left origin with y growing upwards. Every conversion goes through
 * this module so no `pageHeight - y` ever has to be written by hand in the
 * exporter, and so document coordinates are never mutated to suit the output.
 *
 * Two spaces are useful:
 *   content - PDF points, top-left origin, y down. Convenient because it is
 *             just world space scaled and shifted, and because pdf-lib's
 *             `drawSvgPath` flips y for us when anchored at the page top.
 *   pdf     - PDF points, bottom-left origin, y up. What `drawText`,
 *             `drawImage` and raw operators expect.
 */
export interface PageGeometry {
  /** The world rectangle this page shows. */
  source: Bounds;
  pageWidth: number;
  pageHeight: number;
  /** World units per PDF point. */
  scale: number;
  /** Offset of source's top-left corner from the page's top-left, in points. */
  marginX: number;
  marginY: number;
  /** Shown in progress messages. */
  label: string;
}

export interface Point2 {
  x: number;
  y: number;
}

export function contentX(g: PageGeometry, worldX: number): number {
  return g.marginX + (worldX - g.source.minX) * g.scale;
}

export function contentY(g: PageGeometry, worldY: number): number {
  return g.marginY + (worldY - g.source.minY) * g.scale;
}

/** Content space (y down) to PDF space (y up). */
export function contentToPdfY(g: PageGeometry, cy: number): number {
  return g.pageHeight - cy;
}

export function toPdf(g: PageGeometry, worldX: number, worldY: number): Point2 {
  return { x: contentX(g, worldX), y: contentToPdfY(g, contentY(g, worldY)) };
}

/**
 * Anchor for `drawSvgPath`, which translates to (x, y) and then flips y.
 * Anchoring at the page's top-left makes SVG path coordinates content space.
 */
export function svgAnchor(g: PageGeometry): Point2 {
  return { x: 0, y: g.pageHeight };
}

/** The page's drawable content rectangle, in PDF space. */
export function contentRect(g: PageGeometry): { x: number; y: number; width: number; height: number } {
  const width = (g.source.maxX - g.source.minX) * g.scale;
  const height = (g.source.maxY - g.source.minY) * g.scale;
  return { x: g.marginX, y: g.pageHeight - g.marginY - height, width, height };
}
