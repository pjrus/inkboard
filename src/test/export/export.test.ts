import { describe, expect, it } from "vitest";
import { transformedBounds, unionBounds } from "../../canvas/transform";
import type {
  Bounds,
  CanvasObject,
  ImageObject,
  StrokeObject,
  TextObject,
} from "../../document/schema";
import { contentBounds, overlaps } from "../../export/exportBounds";
import {
  contentRect,
  contentToPdfY,
  contentX,
  contentY,
  type PageGeometry,
  svgAnchor,
  toPdf,
} from "../../export/exportCoordinates";
import { planPages } from "../../export/exportPlan";
import { objectsOnPage, pdfColor } from "../../export/ExportRenderer";
import { pdfFileName } from "../../export/PDFExporter";

const stroke = (b: Bounds, createdAt = 1): StrokeObject => ({
  id: `s${b.minX}`,
  type: "stroke",
  tool: "pen",
  color: "#1b1b1f",
  width: 3,
  points: [b.minX, b.minY, 0.5, b.maxX, b.maxY, 0.5],
  bounds: b,
  createdAt,
});

const text = (x: number, y: number, createdAt = 2): TextObject => ({
  id: `t${x}`,
  type: "text",
  x,
  y,
  width: 200,
  text: "hello",
  fontFamily: "open-sans",
  fontSize: 20,
  color: "#1b1b1f",
  createdAt,
  updatedAt: createdAt,
});

const pdfPage = (n: number, y: number): ImageObject => ({
  id: `p${n}`,
  type: "image",
  assetId: `doc-p${n}`,
  pdfDocumentId: "doc",
  pageNumber: n,
  x: 0,
  y,
  width: 612,
  height: 792,
  rotation: 0,
  createdAt: 0,
});

describe("export bounds", () => {
  it("takes the union of every object type", () => {
    const objects: CanvasObject[] = [
      stroke({ minX: 0, minY: 0, maxX: 10, maxY: 10 }),
      pdfPage(1, 100),
    ];
    expect(unionBounds(objects.map(transformedBounds))).toEqual({
      minX: 0,
      minY: 0,
      maxX: 612,
      maxY: 892,
    });
    expect(unionBounds([])).toBeNull();
  });

  it("pads the content bounds and returns null for an empty board", () => {
    const b = contentBounds(
      [stroke({ minX: 10, minY: 20, maxX: 30, maxY: 40 })],
      5,
    )!;
    expect(b).toEqual({ minX: 5, minY: 15, maxX: 35, maxY: 45 });
    expect(contentBounds([], 5)).toBeNull();
  });

  it("frames a rotated object by the space it now occupies", () => {
    const turned: ImageObject = { ...pdfPage(1, 0), rotation: Math.PI / 2 };
    const b = transformedBounds(turned);
    // A 612x792 page turned a quarter turn is 792 wide and 612 tall.
    expect(b.maxX - b.minX).toBeCloseTo(792, 6);
    expect(b.maxY - b.minY).toBeCloseTo(612, 6);
  });

  it("sizes the page to a rotated image's turned bounds", () => {
    const turned: ImageObject = { ...pdfPage(1, 0), rotation: Math.PI / 2 };
    const [geometry] = planPages([turned], 0);
    expect(geometry.pageWidth).toBeCloseTo(792, 6);
    expect(geometry.pageHeight).toBeCloseTo(612, 6);
  });

  it("detects overlap without counting edge-only contact", () => {
    const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(overlaps(a, { minX: 5, minY: 5, maxX: 20, maxY: 20 })).toBe(true);
    expect(overlaps(a, { minX: 10, minY: 0, maxX: 20, maxY: 10 })).toBe(false);
  });
});

describe("export coordinates", () => {
  const g: PageGeometry = {
    source: { minX: -100, minY: 50, maxX: 100, maxY: 250 },
    pageWidth: 240,
    pageHeight: 260,
    scale: 1,
    marginX: 20,
    marginY: 30,
    label: "test",
  };

  it("maps the source's top-left to the page's content origin", () => {
    expect(contentX(g, -100)).toBe(20);
    expect(contentY(g, 50)).toBe(30);
    // PDF's y axis points the other way: the content top is near the page top.
    expect(toPdf(g, -100, 50)).toEqual({ x: 20, y: 230 });
  });

  it("flips y exactly once, at the boundary", () => {
    expect(contentToPdfY(g, 0)).toBe(260);
    expect(contentToPdfY(g, 260)).toBe(0);
    // The svg anchor is the page's top-left, because drawSvgPath flips y for us.
    expect(svgAnchor(g)).toEqual({ x: 0, y: 260 });
  });

  it("applies scale to both axes", () => {
    const scaled = { ...g, scale: 0.5, marginX: 0, marginY: 0 };
    expect(contentX(scaled, 0)).toBe(50);
    expect(contentY(scaled, 150)).toBe(50);
  });

  it("describes the drawable rectangle in PDF space", () => {
    expect(contentRect(g)).toEqual({ x: 20, y: 30, width: 200, height: 200 });
  });
});

describe("export page planning", () => {
  const board: CanvasObject[] = [
    stroke({ minX: 0, minY: 0, maxX: 400, maxY: 300 }),
    text(50, 400),
  ];

  it("fits all content onto one page", () => {
    const [page] = planPages(board, 40);
    expect(page.pageWidth).toBeCloseTo(480);
    expect(page.scale).toBe(1);
    expect(page.marginX).toBe(0);
  });

  it("puts imported pages and notes on one continuous page, not one per PDF page", () => {
    const objects: CanvasObject[] = [
      pdfPage(1, 0),
      pdfPage(2, 840),
      stroke({ minX: 2000, minY: 2000, maxX: 2100, maxY: 2100 }),
    ];
    const pages = planPages(objects, 0);
    expect(pages).toHaveLength(1);
    expect(pages[0].source).toEqual({
      minX: 0,
      minY: 0,
      maxX: 2100,
      maxY: 2100,
    });
  });

  it("plans nothing for an empty board", () => {
    expect(planPages([])).toHaveLength(0);
  });
});

describe("export rendering helpers", () => {
  const geometry: PageGeometry = {
    source: { minX: 0, minY: 0, maxX: 612, maxY: 792 },
    pageWidth: 612,
    pageHeight: 792,
    scale: 1,
    marginX: 0,
    marginY: 0,
    label: "p1",
  };

  it("draws pages, then ink, then text - and only what touches the page", () => {
    const objects: CanvasObject[] = [
      text(10, 10, 5),
      stroke({ minX: 20, minY: 20, maxX: 60, maxY: 60 }, 3),
      pdfPage(1, 0),
      stroke({ minX: 5000, minY: 5000, maxX: 5100, maxY: 5100 }, 4),
    ];
    expect(objectsOnPage(objects, geometry).map((o) => o.type)).toEqual([
      "image",
      "stroke",
      "text",
    ]);
  });

  it("parses the colour formats the palette and colour picker produce", () => {
    expect(pdfColor("#000000")).toMatchObject({ red: 0, green: 0, blue: 0 });
    expect(pdfColor("#fff")).toMatchObject({ red: 1, green: 1, blue: 1 });
    expect(pdfColor("#d93025").red).toBeCloseTo(217 / 255);
    expect(pdfColor("rgb(43, 109, 233)").blue).toBeCloseTo(233 / 255);
    expect(pdfColor("nonsense")).toMatchObject({ red: 0, green: 0, blue: 0 });
  });
});

describe("export filenames", () => {
  it("keeps readable names and strips characters filesystems reject", () => {
    expect(pdfFileName("Architecture Notes")).toBe("Architecture Notes.pdf");
    expect(pdfFileName("Lecture 5: intro/outro")).toBe(
      "Lecture 5 intro outro.pdf",
    );
    expect(pdfFileName("   ")).toBe("Untitled board.pdf");
    expect(pdfFileName("../../etc/passwd")).toBe("etc passwd.pdf");
  });
});
