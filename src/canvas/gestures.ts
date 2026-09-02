import type { Viewport } from "../document/schema";
import { clampScale, screenToWorld, type Point } from "./coordinates";

/**
 * Two-finger pinch/pan gesture maths.
 *
 * Every update is derived from the gesture-start snapshot rather than
 * accumulated deltas, so floating-point drift never builds up.
 */

export interface PinchStart {
  startDistance: number;
  startCenter: Point;
  startViewport: Viewport;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function beginPinch(a: Point, b: Point, viewport: Viewport): PinchStart {
  return {
    startDistance: Math.max(distance(a, b), 1),
    startCenter: midpoint(a, b),
    startViewport: viewport,
  };
}

/**
 * Compute the new viewport for the current finger positions. The world point
 * that was under the start centre is placed under the current centre, and the
 * scale follows the ratio of finger distances.
 */
export function updatePinch(start: PinchStart, a: Point, b: Point): Viewport {
  const currentDistance = Math.max(distance(a, b), 1);
  const currentCenter = midpoint(a, b);
  const scale = clampScale(start.startViewport.scale * (currentDistance / start.startDistance));
  const anchorWorld = screenToWorld(start.startCenter, start.startViewport);
  return {
    scale,
    x: currentCenter.x - anchorWorld.x * scale,
    y: currentCenter.y - anchorWorld.y * scale,
  };
}
