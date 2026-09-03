import type { Bounds, CanvasObject } from "../document/schema";
import { transformedBounds, unionBounds } from "../canvas/transform";

/** Breathing room around exported content, in world units. */
export const EXPORT_PADDING = 40;

/** Bounding rectangle of every given object, expanded by `padding`. */
export function contentBounds(objects: CanvasObject[], padding = EXPORT_PADDING): Bounds | null {
  const b = unionBounds(objects.map(transformedBounds));
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
