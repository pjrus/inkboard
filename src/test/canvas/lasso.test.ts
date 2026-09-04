import { describe, expect, it } from "vitest";
import { screenToWorld } from "../../canvas/coordinates";
import {
  lassoSelectsStroke,
  pointInPolygon,
  polygonBounds,
} from "../../canvas/strokeGeometry";

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];
const line = (x0: number, x1: number, y: number, n = 11) =>
  Array.from({ length: n }, (_, i) => ({
    x: x0 + ((x1 - x0) * i) / (n - 1),
    y,
  }));

describe("lasso selection", () => {
  it("point in polygon", () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 50 }, square)).toBe(false);
    expect(polygonBounds(square)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 100,
    });
  });

  it("selects a fully enclosed stroke", () => {
    expect(lassoSelectsStroke(line(10, 90, 50), 2, square)).toBe(true);
  });

  it("does not select a stroke entirely outside", () => {
    expect(lassoSelectsStroke(line(110, 200, 50), 2, square)).toBe(false);
    expect(lassoSelectsStroke(line(10, 90, 150), 2, square)).toBe(false);
  });

  it("selects a partially enclosed stroke past the threshold only", () => {
    // 11 points from x=50..150: 6 inside (50..100) -> 55% selected
    expect(lassoSelectsStroke(line(50, 150, 50), 2, square)).toBe(true);
    // 11 points from x=80..180: 3 inside -> 27% not selected
    expect(lassoSelectsStroke(line(80, 180, 50), 2, square)).toBe(false);
  });

  it("accounts for stroke width near the boundary", () => {
    const justOutside = line(10, 90, 103); // 3 units outside the edge
    expect(lassoSelectsStroke(justOutside, 2, square)).toBe(false);
    expect(lassoSelectsStroke(justOutside, 8, square)).toBe(true);
  });

  it("is independent of zoom because it operates in world space", () => {
    const vp = { x: 120, y: -40, scale: 0.37 };
    const worldPoly = square
      .map((p) => ({ x: p.x * vp.scale + vp.x, y: p.y * vp.scale + vp.y }))
      .map((sp) => screenToWorld(sp, vp));
    expect(lassoSelectsStroke(line(10, 90, 50), 2, worldPoly)).toBe(true);
    expect(lassoSelectsStroke(line(110, 200, 50), 2, worldPoly)).toBe(false);
  });
});
