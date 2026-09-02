import type { Bounds, CanvasObject } from "../document/schema";
import { textBounds } from "../text/textMeasure";

/** Breathing room around exported content, in world units. */
export const EXPORT_PADDING = 40;

/**
 * World-space extent of any persistent object. Text boxes get their bounds
 * from the same layout module the canvas draws with, so an exported page
 * frames text exactly as the screen did.
 */
export function objectBounds(o: CanvasObject): Bounds {
  if (o.type === "stroke") return o.bounds;
  if (o.type === "text") return textBounds(o);
  return { minX: o.x, minY: o.y, maxX: o.x + o.width, maxY: o.y + o.height };
}

export function unionBounds(list: Bounds[]): Bounds | null {
  if (list.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of list) {
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** Bounding rectangle of every given object, expanded by `padding`. */
export function contentBounds(objects: CanvasObject[], padding = EXPORT_PADDING): Bounds | null {
  const b = unionBounds(objects.map(objectBounds));
  if (!b) return null;
  return { minX: b.minX - padding, minY: b.minY - padding, maxX: b.maxX + padding, maxY: b.maxY + padding };
}

export function boundsWidth(b: Bounds): number {
  return b.maxX - b.minX;
}

export function boundsHeight(b: Bounds): number {
  return b.maxY - b.minY;
}

export function overlaps(a: Bounds, b: Bounds): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}
