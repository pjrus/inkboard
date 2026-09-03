import { unpackPoints, type Bounds, type CanvasObject, type LassoFilter, type PDFPageObject, type StrokeObject, type TextObject } from "../document/schema";
import { textBounds } from "../text/textMeasure";
import { lassoInsideQuad, lassoSelectsQuad, lassoSelectsStroke, polygonBounds } from "./strokeGeometry";

/**
 * The one place object transforms are reasoned about.
 *
 * Every object has a world-space position and a rotation about its own centre;
 * strokes are the exception, and deliberately so. A stroke is a bag of points
 * with a cached bounding box, and every consumer of a stroke - the renderer's
 * Path2D cache, the eraser, the lasso, the exporter - already reads those
 * points as world coordinates. Giving strokes a rotation field would mean
 * teaching all of them about it; rotating the points once, when the gesture
 * ends, keeps rotation confined to this module and crdt.ts. Text boxes and
 * imported pages cannot be baked that way (their glyphs and bitmaps stay
 * upright in their own frame), so those carry a `rotation` in radians.
 *
 * Rotation is radians throughout, clockwise on screen (y grows downwards).
 * Degrees exist only where a UI or the PDF format asks for them.
 */

export interface XY {
  x: number;
  y: number;
}

/** Snap increment for a modifier-held rotation, in radians (15 degrees). */
export const ROTATION_SNAP = Math.PI / 12;

export function isInkObject(o: CanvasObject): o is StrokeObject {
  return o.type === "stroke";
}

export function isTextObject(o: CanvasObject): o is TextObject {
  return o.type === "text";
}

/** Images and PDF page images: anything drawn as a rotatable bitmap rectangle. */
export function isImageLikeObject(o: CanvasObject): o is PDFPageObject {
  return o.type === "pdf-page";
}

/** An object's own rotation in radians (strokes bake theirs into their points). */
export function rotationOf(o: CanvasObject): number {
  return o.type === "stroke" ? 0 : o.rotation ?? 0;
}

export function rotatePoint(p: XY, pivot: XY, angle: number): XY {
  if (angle === 0) return { x: p.x, y: p.y };
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
}

/** The object's axis-aligned rectangle *before* its own rotation is applied. */
export function localRect(o: CanvasObject): Bounds {
  if (o.type === "stroke") return o.bounds;
  if (o.type === "text") return textBounds(o);
  return { minX: o.x, minY: o.y, maxX: o.x + o.width, maxY: o.y + o.height };
}

export function boundsCenter(b: Bounds): XY {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** Centre of rotation for a single object: the middle of its own rectangle. */
export function objectCenter(o: CanvasObject): XY {
  return boundsCenter(localRect(o));
}

/** The four world-space corners of an object, with its rotation applied. */
export function objectCorners(o: CanvasObject): XY[] {
  const r = localRect(o);
  const corners = [
    { x: r.minX, y: r.minY },
    { x: r.maxX, y: r.minY },
    { x: r.maxX, y: r.maxY },
    { x: r.minX, y: r.maxY },
  ];
  const angle = rotationOf(o);
  if (angle === 0) return corners;
  const c = boundsCenter(r);
  return corners.map((p) => rotatePoint(p, c, angle));
}

/**
 * Axis-aligned world bounds *after* transforms.
 *
 * Selection, culling, lasso tests, handles, export planning and hit testing
 * all go through this, so a rotated object is never framed by the rectangle it
 * used to occupy.
 */
export function transformedBounds(o: CanvasObject): Bounds {
  if (rotationOf(o) === 0) return localRect(o);
  return pointsBounds(objectCorners(o));
}

export function pointsBounds(points: XY[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return isFinite(minX) ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
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

/** Combined bounds of a group; also the pivot for rotating that group. */
export function groupBounds(objects: CanvasObject[]): Bounds | null {
  return unionBounds(objects.map(transformedBounds));
}

/**
 * Is a world point inside an object's rectangle?
 *
 * The point is rotated back into the object's own frame first, so hit testing
 * follows a rotated text box or page instead of the box it started in.
 */
export function rectContains(o: CanvasObject, p: XY, pad = 0): boolean {
  const r = localRect(o);
  const angle = rotationOf(o);
  const local = angle === 0 ? p : rotatePoint(p, boundsCenter(r), -angle);
  return local.x >= r.minX - pad && local.x <= r.maxX + pad && local.y >= r.minY - pad && local.y <= r.maxY + pad;
}

/** Round an angle to the nearest 15 degrees (used while a modifier is held). */
export function snapAngle(angle: number): number {
  return Math.round(angle / ROTATION_SNAP) * ROTATION_SNAP;
}

/** Radians to the 0..359 degree value shown in the UI. */
export function toDegrees(angle: number): number {
  const deg = Math.round((angle * 180) / Math.PI) % 360;
  return deg < 0 ? deg + 360 : deg;
}

/** Whether the lasso is currently allowed to pick this object up. */
export function matchesLassoFilter(o: CanvasObject, filter: LassoFilter): boolean {
  if (isInkObject(o)) return filter.ink;
  if (isTextObject(o)) return filter.text;
  if (isImageLikeObject(o)) return filter.images;
  return false;
}

/**
 * Which of `candidates` a lasso polygon selects.
 *
 * The type filter runs first, so no geometry is computed for a type the user
 * has switched off - the point of the filter is as much "don't touch the PDF
 * page under my handwriting" as it is "don't spend time testing it".
 *
 * Strokes are tested against their sampled points; text boxes and pages
 * against their four world-space corners, so a rotated object is tested as the
 * shape it actually occupies.
 */
export function lassoHits(candidates: CanvasObject[], poly: XY[], filter: LassoFilter): CanvasObject[] {
  if (poly.length < 3) return [];
  const pb = polygonBounds(poly);
  const out: CanvasObject[] = [];
  for (const o of candidates) {
    if (!matchesLassoFilter(o, filter)) continue;
    const hit = isInkObject(o)
      ? lassoSelectsStroke(unpackPoints(o.points), o.width, poly, pb)
      : lassoSelectsQuad(objectCorners(o), poly, pb);
    if (hit) out.push(o);
  }
  if (out.length > 0) return out;
  // Nothing was picked up, so fall back to the containment case: a lasso drawn
  // *inside* an object selects it. An image or PDF page is routinely larger
  // than the screen, and looping around it is then impossible; looping on it
  // is the only gesture left. Running this only when nothing else was hit is
  // what keeps "lasso my handwriting" from also grabbing the page under it,
  // and the smallest candidate wins so an image sitting on a page takes it.
  let best: CanvasObject | null = null;
  let bestArea = Infinity;
  for (const o of candidates) {
    if (isInkObject(o) || !matchesLassoFilter(o, filter)) continue;
    if (!lassoInsideQuad(poly, objectCorners(o))) continue;
    const b = transformedBounds(o);
    const area = (b.maxX - b.minX) * (b.maxY - b.minY);
    if (area < bestArea) {
      bestArea = area;
      best = o;
    }
  }
  return best ? [best] : out;
}
