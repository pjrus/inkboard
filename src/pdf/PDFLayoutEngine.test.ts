import { describe, expect, it } from "vitest";
import { layoutPages } from "./PDFLayoutEngine";

const sizes = [
  { width: 612, height: 792 },
  { width: 612, height: 792 },
  { width: 842, height: 595 }, // a landscape page in the middle
];

describe("PDF layout engine", () => {
  it("stacks pages vertically with a constant gap, left-aligned", () => {
    const p = layoutPages(sizes, "vertical", { x: 10, y: 20 }, 40);
    expect(p[0]).toEqual({ x: 10, y: 20, width: 612, height: 792 });
    expect(p[1]).toEqual({ x: 10, y: 20 + 792 + 40, width: 612, height: 792 });
    expect(p[2]).toEqual({ x: 10, y: 20 + (792 + 40) * 2, width: 842, height: 595 });
  });

  it("lays pages out horizontally with a constant gap, top-aligned", () => {
    const p = layoutPages(sizes, "horizontal", { x: 10, y: 20 }, 40);
    expect(p[0]).toEqual({ x: 10, y: 20, width: 612, height: 792 });
    expect(p[1]).toEqual({ x: 10 + 612 + 40, y: 20, width: 612, height: 792 });
    expect(p[2]).toEqual({ x: 10 + (612 + 40) * 2, y: 20, width: 842, height: 595 });
  });

  it("preserves each page's aspect ratio", () => {
    for (const layout of ["vertical", "horizontal"] as const) {
      const p = layoutPages(sizes, layout, { x: 0, y: 0 });
      p.forEach((pl, i) => expect(pl.width / pl.height).toBeCloseTo(sizes[i].width / sizes[i].height));
    }
  });
});
