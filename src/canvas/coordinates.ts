import type { Bounds, Viewport } from "../document/schema";

/**
 * All screen<->world transform maths lives here. Nothing else in the app
 * should multiply by `scale` by hand.
 *
 * Convention:  screen = world * scale + (x, y)
 */

export interface Point {
  x: number;
  y: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function screenToWorld(p: Point, vp: Viewport): Point {
  return { x: (p.x - vp.x) / vp.scale, y: (p.y - vp.y) / vp.scale };
}

export function worldToScreen(p: Point, vp: Viewport): Point {
  return { x: p.x * vp.scale + vp.x, y: p.y * vp.scale + vp.y };
}

/** Convert a screen-space length to world units. */
export function screenLengthToWorld(len: number, vp: Viewport): number {
  return len / vp.scale;
}

/**
 * Return a viewport with `newScale` applied such that the world point under
 * `focal` (screen coords) stays under `focal`.
 */
export function zoomAt(vp: Viewport, focal: Point, newScale: number): Viewport {
  const scale = clampScale(newScale);
  const before = screenToWorld(focal, vp);
  return {
    scale,
    x: focal.x - before.x * scale,
    y: focal.y - before.y * scale,
  };
}

/** Multiply the scale by `factor`, zooming around `focal`. */
export function zoomBy(vp: Viewport, focal: Point, factor: number): Viewport {
  return zoomAt(vp, focal, vp.scale * factor);
}

export function pan(vp: Viewport, dx: number, dy: number): Viewport {
  return { ...vp, x: vp.x + dx, y: vp.y + dy };
}

/** World-space rectangle currently visible on a screen of the given size. */
export function visibleWorldBounds(
  vp: Viewport,
  screenWidth: number,
  screenHeight: number,
  overscanPx = 0,
): Bounds {
  const tl = screenToWorld({ x: -overscanPx, y: -overscanPx }, vp);
  const br = screenToWorld(
    { x: screenWidth + overscanPx, y: screenHeight + overscanPx },
    vp,
  );
  return { minX: tl.x, minY: tl.y, maxX: br.x, maxY: br.y };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return (
    a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
  );
}

/** Viewport that centres the given world point on screen at the given scale. */
export function centerOn(
  worldPoint: Point,
  scale: number,
  screenWidth: number,
  screenHeight: number,
): Viewport {
  const s = clampScale(scale);
  return {
    scale: s,
    x: screenWidth / 2 - worldPoint.x * s,
    y: screenHeight / 2 - worldPoint.y * s,
  };
}
