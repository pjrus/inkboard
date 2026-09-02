import { describe, expect, it } from "vitest";
import { screenToWorld, worldToScreen } from "./coordinates";
import { beginPinch, updatePinch } from "./gestures";

describe("pinch gesture", () => {
  const vp = { x: 40, y: 80, scale: 1.5 };

  it("scales by the ratio of finger distances", () => {
    const start = beginPinch({ x: 100, y: 100 }, { x: 200, y: 100 }, vp);
    const next = updatePinch(start, { x: 50, y: 100 }, { x: 250, y: 100 });
    expect(next.scale).toBeCloseTo(3);
  });

  it("keeps the world point under the gesture centre fixed while zooming", () => {
    const a0 = { x: 300, y: 200 };
    const b0 = { x: 500, y: 400 };
    const start = beginPinch(a0, b0, vp);
    const anchor = screenToWorld({ x: 400, y: 300 }, vp);
    const next = updatePinch(start, { x: 250, y: 150 }, { x: 550, y: 450 });
    const after = worldToScreen(anchor, next);
    expect(after.x).toBeCloseTo(400);
    expect(after.y).toBeCloseTo(300);
  });

  it("translates when the fingers move together without changing distance", () => {
    const start = beginPinch({ x: 100, y: 100 }, { x: 200, y: 100 }, vp);
    const next = updatePinch(start, { x: 130, y: 160 }, { x: 230, y: 160 });
    expect(next.scale).toBeCloseTo(vp.scale);
    expect(next.x).toBeCloseTo(vp.x + 30);
    expect(next.y).toBeCloseTo(vp.y + 60);
  });

  it("derives from start state so repeated updates do not drift", () => {
    const start = beginPinch({ x: 100, y: 100 }, { x: 200, y: 100 }, vp);
    let last = vp;
    for (let i = 0; i < 500; i++) {
      const spread = 100 + Math.sin(i / 10) * 50;
      last = updatePinch(start, { x: 150 - spread / 2, y: 100 }, { x: 150 + spread / 2, y: 100 });
    }
    // Final spread == 100 * (1 + sin(49.9)/2)
    const finalSpread = 100 + Math.sin(499 / 10) * 50;
    expect(last.scale).toBeCloseTo(vp.scale * (finalSpread / 100));
  });
});
