import { describe, expect, it } from "vitest";
import { lassoSelectsQuad } from "../../canvas/strokeGeometry";

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

const box = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

describe("lasso selection of text boxes", () => {
  it("selects a box fully inside the lasso", () => {
    expect(lassoSelectsQuad(box(20, 20, 40, 20), square)).toBe(true);
  });

  it("ignores a box that does not touch the lasso at all", () => {
    expect(lassoSelectsQuad(box(200, 200, 40, 20), square)).toBe(false);
    expect(lassoSelectsQuad(box(-100, 0, 40, 20), square)).toBe(false);
  });

  it("selects a box whose centre is inside, even if it overhangs", () => {
    // Overhangs the right edge, but its centre is still in the lasso.
    expect(lassoSelectsQuad(box(60, 40, 70, 20), square)).toBe(true);
  });

  it("rejects a box that only clips the lasso at one corner", () => {
    expect(lassoSelectsQuad(box(90, 90, 100, 100), square)).toBe(false);
  });

  it("selects a large box the lasso is drawn inside", () => {
    // Lasso well within a big text box: the box's centre is inside the lasso.
    expect(lassoSelectsQuad(box(-200, -200, 500, 500), square)).toBe(true);
  });

  it("needs three points to make a polygon", () => {
    expect(
      lassoSelectsQuad(box(20, 20, 10, 10), [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toBe(false);
  });
});
