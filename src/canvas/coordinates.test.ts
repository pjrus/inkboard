import { describe, expect, it } from "vitest";
import { centerOn, clampScale, MAX_SCALE, MIN_SCALE, screenToWorld, visibleWorldBounds, worldToScreen, zoomAt, zoomBy } from "./coordinates";

describe("coordinate transforms", () => {
  const vp = { x: 100, y: -50, scale: 2 };

  it("round-trips screen -> world -> screen", () => {
    const s = { x: 333.3, y: 12.7 };
    const back = worldToScreen(screenToWorld(s, vp), vp);
    expect(back.x).toBeCloseTo(s.x, 9);
    expect(back.y).toBeCloseTo(s.y, 9);
  });

  it("maps the world origin to the viewport translation", () => {
    expect(worldToScreen({ x: 0, y: 0 }, vp)).toEqual({ x: 100, y: -50 });
  });

  it("keeps the focal world point fixed when zooming", () => {
    const focal = { x: 400, y: 300 };
    const before = screenToWorld(focal, vp);
    const zoomed = zoomAt(vp, focal, 3.5);
    const after = worldToScreen(before, zoomed);
    expect(after.x).toBeCloseTo(focal.x, 9);
    expect(after.y).toBeCloseTo(focal.y, 9);
    expect(zoomed.scale).toBe(3.5);
  });

  it("zoomBy multiplies the scale and clamps to the allowed range", () => {
    expect(zoomBy(vp, { x: 0, y: 0 }, 2).scale).toBe(4);
    expect(zoomBy(vp, { x: 0, y: 0 }, 1000).scale).toBe(MAX_SCALE);
    expect(zoomBy(vp, { x: 0, y: 0 }, 0.0001).scale).toBe(MIN_SCALE);
    expect(clampScale(0)).toBe(MIN_SCALE);
  });

  it("computes visible world bounds with overscan", () => {
    const b = visibleWorldBounds({ x: 0, y: 0, scale: 2 }, 800, 600, 100);
    expect(b).toEqual({ minX: -50, minY: -50, maxX: 450, maxY: 350 });
  });

  it("centerOn puts the world point in the middle of the screen", () => {
    const c = centerOn({ x: 1000, y: 2000 }, 1, 800, 600);
    expect(worldToScreen({ x: 1000, y: 2000 }, c)).toEqual({ x: 400, y: 300 });
  });
});
