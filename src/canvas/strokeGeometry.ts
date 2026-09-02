import { getStroke } from "perfect-freehand";
import type { Bounds, PenTool, StrokePoint } from "../document/schema";

/**
 * Stroke geometry helpers: outline generation, bounds, simplification and
 * hit testing. All in world units. Pure functions so they can be unit-tested.
 */

export function strokeOptions(tool: PenTool, width: number, hasPressure: boolean) {
  const base = {
    size: width,
    smoothing: 0.5,
    streamline: 0.45,
    last: true,
    simulatePressure: !hasPressure,
  };
  if (tool === "pencil") {
    // Slightly more responsive to speed than the pen, but never vanishing.
    return { ...base, thinning: 0.4, smoothing: 0.4, streamline: 0.35 };
  }
  return { ...base, thinning: 0.5 };
}

/** Outline polygon (world units) for a stroke. */
export function strokeOutline(points: StrokePoint[], tool: PenTool, width: number, hasPressure: boolean): number[][] {
  const input = points.map((p) => [p.x, p.y, p.pressure ?? 0.5]);
  return getStroke(input, strokeOptions(tool, width, hasPressure));
}

/** Whether a point list carries real pressure data (mouse reports 0.5/0). */
export function hasRealPressure(points: StrokePoint[]): boolean {
  let seen: number | undefined;
  for (const p of points) {
    if (p.pressure === undefined) return false;
    if (seen === undefined) seen = p.pressure;
    else if (Math.abs(seen - p.pressure) > 1e-3) return true;
  }
  return false;
}

export function computeBounds(points: StrokePoint[], width: number): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const pad = width;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/**
 * Ramer-Douglas-Peucker simplification. `epsilon` is in world units and is
 * kept deliberately small (a fraction of stroke width) so handwriting quality
 * is preserved while long slow strokes lose redundant samples.
 */
export function simplifyPoints(points: StrokePoint[], epsilon: number): StrokePoint[] {
  if (points.length < 3 || epsilon <= 0) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxDist = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = pointSegmentDistance(points[i], points[a], points[b]);
      if (d > maxDist) {
        maxDist = d;
        idx = i;
      }
    }
    if (maxDist > epsilon && idx !== -1) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: StrokePoint[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

export function pointSegmentDistance(p: StrokePoint, a: StrokePoint, b: StrokePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 0) {
    t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** True if the circle (centre, radius) touches the stroke polyline. */
export function strokeHitTest(points: StrokePoint[], width: number, centre: StrokePoint, radius: number): boolean {
  const threshold = radius + width / 2;
  if (points.length === 1) return Math.hypot(points[0].x - centre.x, points[0].y - centre.y) <= threshold;
  for (let i = 0; i + 1 < points.length; i++) {
    if (pointSegmentDistance(centre, points[i], points[i + 1]) <= threshold) return true;
  }
  return false;
}

/** True if the segment (a, b) swept with `radius` touches the stroke polyline. */
export function strokeSegmentHitTest(
  points: StrokePoint[],
  width: number,
  a: StrokePoint,
  b: StrokePoint,
  radius: number,
): boolean {
  // Sample the eraser path so quick eraser swipes still catch thin strokes.
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(radius, 1)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const c = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (strokeHitTest(points, width, c, radius)) return true;
  }
  return false;
}
