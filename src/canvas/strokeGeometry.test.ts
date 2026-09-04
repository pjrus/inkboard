import { describe, expect, it } from "vitest";
import {
  computeBounds,
  simplifyPoints,
  strokeHitTest,
  strokeOutline,
  strokeSegmentHitTest,
} from "./strokeGeometry";

describe("stroke geometry", () => {
  const line = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];

  it("hit tests against the stroke body plus radius", () => {
    expect(strokeHitTest(line, 4, { x: 50, y: 3 }, 2)).toBe(true);
    expect(strokeHitTest(line, 4, { x: 50, y: 10 }, 2)).toBe(false);
    expect(strokeHitTest(line, 4, { x: -5, y: 0 }, 6)).toBe(true);
  });

  it("sweeps a segment so fast eraser movement still hits", () => {
    expect(
      strokeSegmentHitTest(line, 2, { x: 50, y: -40 }, { x: 50, y: 40 }, 3),
    ).toBe(true);
    expect(
      strokeSegmentHitTest(line, 2, { x: 50, y: 20 }, { x: 50, y: 40 }, 3),
    ).toBe(false);
  });

  it("simplifies collinear points but keeps corners", () => {
    const pts = [];
    for (let i = 0; i <= 100; i++) pts.push({ x: i, y: 0 });
    pts.push({ x: 100, y: 100 });
    const out = simplifyPoints(pts, 0.5);
    expect(out.length).toBe(3);
    expect(out[1]).toEqual({ x: 100, y: 0 });
  });

  it("computes padded bounds", () => {
    expect(computeBounds(line, 4)).toEqual({
      minX: -4,
      minY: -4,
      maxX: 104,
      maxY: 4,
    });
  });

  it("produces a closed outline polygon", () => {
    const outline = strokeOutline(
      [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 50, y: 20, pressure: 0.5 },
        { x: 100, y: 0, pressure: 0.5 },
      ],
      "pen",
      4,
      false,
    );
    expect(outline.length).toBeGreaterThan(4);
  });
});
