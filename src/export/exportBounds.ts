import type { Bounds, CanvasObject } from "../document/schema";
import { transformedBounds } from "../canvas/transform";

/** Breathing room around exported content, in world units. */
export const EXPORT_PADDING = 40;

/**
 * World-space extent of any persistent object, rotation included.
 *
 * This is the same `transformedBounds` the canvas culls and selects with, so
 * an exported page frames a rotated object by the space it actually occupies
 * rather than the rectangle it started in.
 */
export function objectBounds(o: CanvasObject): Bounds {
  return transformedBounds(o);
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
