import {
  clip,
  endPath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  degrees,
  rgb,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import {
  unpackPoints,
  type CanvasObject,
  type FontFamilyId,
  type PDFPageObject,
  type StrokeObject,
  type StrokePoint,
  type TextObject,
} from "../document/schema";
import { strokeOutline } from "../canvas/strokeGeometry";
import { objectCenter, rotatePoint } from "../canvas/transform";
import { getFont } from "../text/fonts";
import { loadFontBytes } from "../text/fontLoader";
import { layoutText } from "../text/textLayout";
import { assetRepository } from "../storage/assetRepository";
import { objectBounds, overlaps } from "./exportBounds";
import { contentX, contentY, contentRect, svgAnchor, toPdf, type PageGeometry } from "./exportCoordinates";

/**
 * Draws persistent canvas objects onto a PDF page.
 *
 * Nothing here knows about the application UI: toolbars, selection outlines,
 * lasso paths, handles, cursors and the zoom chip simply do not exist in this
 * pipeline, which is why exports can never contain them.
 *
 * Output stays vector wherever it can - handwriting as filled paths from the
 * same perfect-freehand geometry the screen uses, text as real embedded text -
 * with imported PDF pages placed as the JPEGs they were rasterised to. That
 * keeps exports sharp, small and searchable rather than one giant bitmap.
 */
export class ExportResources {
  private fonts = new Map<string, PDFFont>();
  private images = new Map<string, PDFImage | null>();

  constructor(private readonly pdf: PDFDocument) {}

  async font(id: FontFamilyId): Promise<PDFFont> {
    const key = getFont(id).id;
    const hit = this.fonts.get(key);
    if (hit) return hit;
    // Subsetting keeps a four-font export in the tens of kilobytes; the bytes
    // are the same self-hosted files the canvas renders with, so the exported
    // PDF looks right on a machine that has none of these fonts installed.
    const font = await this.pdf.embedFont(await loadFontBytes(key), { subset: true });
    this.fonts.set(key, font);
    return font;
  }

  /** Embedded page bitmap, or null when its asset is missing. */
  async image(assetId: string): Promise<PDFImage | null> {
    if (this.images.has(assetId)) return this.images.get(assetId)!;
    let image: PDFImage | null = null;
    try {
      const rec = await assetRepository.get(assetId);
      if (rec) {
        const bytes = new Uint8Array(await rec.blob.arrayBuffer());
        image = rec.mimeType === "image/png" ? await this.pdf.embedPng(bytes) : await this.pdf.embedJpg(bytes);
      }
    } catch (err) {
      console.error("Could not embed page image", assetId, err);
    }
    this.images.set(assetId, image);
    return image;
  }
}

/** Objects that touch this page's world rectangle, in draw order. */
export function objectsOnPage(objects: CanvasObject[], geometry: PageGeometry): CanvasObject[] {
  const order = { "pdf-page": 0, stroke: 1, text: 2 } as const;
  return objects
    .filter((o) => overlaps(objectBounds(o), geometry.source))
    .sort((a, b) => order[a.type] - order[b.type] || a.createdAt - b.createdAt);
}

export async function renderPage(
  page: PDFPage,
  objects: CanvasObject[],
  geometry: PageGeometry,
  resources: ExportResources,
): Promise<void> {
  const rect = contentRect(geometry);
  // Clip to the page's slice of the world so an object spanning a page break
  // is cut cleanly instead of bleeding into the margins.
  page.pushOperators(
    pushGraphicsState(),
    moveTo(rect.x, rect.y),
    lineTo(rect.x + rect.width, rect.y),
    lineTo(rect.x + rect.width, rect.y + rect.height),
    lineTo(rect.x, rect.y + rect.height),
    clip(),
    endPath(),
  );

  for (const object of objectsOnPage(objects, geometry)) {
    if (object.type === "pdf-page") await drawPDFPage(page, object, geometry, resources);
    else if (object.type === "stroke") drawStroke(page, object, geometry);
    else await drawText(page, object, geometry, resources);
  }

  page.pushOperators(popGraphicsState());
}

/**
 * World rotation to a pdf-lib angle.
 *
 * The canvas turns clockwise about a y-down axis; PDF measures anticlockwise
 * about a y-up one, so the same visual rotation is the negated angle here.
 */
function pdfRotation(radians: number) {
  return degrees((-radians * 180) / Math.PI);
}

async function drawPDFPage(page: PDFPage, obj: PDFPageObject, g: PageGeometry, resources: ExportResources) {
  const image = await resources.image(obj.assetId);
  if (!image) return;
  const angle = obj.rotation ?? 0;
  // drawImage anchors at the image's bottom-left corner and rotates about it,
  // so the corner is rotated into place first and the angle applied there.
  // The stored bitmap is never re-rendered: rotation is purely a transform.
  const corner = rotatePoint({ x: obj.x, y: obj.y + obj.height }, objectCenter(obj), angle);
  const bottomLeft = toPdf(g, corner.x, corner.y);
  page.drawImage(image, {
    x: bottomLeft.x,
    y: bottomLeft.y,
    width: obj.width * g.scale,
    height: obj.height * g.scale,
    rotate: pdfRotation(angle),
  });
}

function drawStroke(page: PDFPage, stroke: StrokeObject, g: PageGeometry) {
  const points = unpackPoints(stroke.points);
  const outline = strokeOutline(points, stroke.tool, stroke.width, stroke.tool === "pen" && hasVaryingPressure(points));
  if (outline.length < 3) return;
  const anchor = svgAnchor(g);
  page.drawSvgPath(outlineToSvgPath(outline, g), {
    x: anchor.x,
    y: anchor.y,
    scale: 1,
    color: pdfColor(stroke.color),
    // Pencil is drawn slightly translucent on screen; matching it here keeps
    // pencil and pen visibly different in the export.
    opacity: stroke.tool === "pencil" ? 0.82 : 1,
  });
}

async function drawText(page: PDFPage, text: TextObject, g: PageGeometry, resources: ExportResources) {
  if (text.text === "") return;
  const font = await resources.font(text.fontFamily);
  const size = text.fontSize * g.scale;
  const width = text.width * g.scale;
  // Wrapping uses the embedded font's own metrics, running the same algorithm
  // the canvas uses, so exported lines break where the screen broke them.
  const measure = (t: string) => safeWidth(font, t, size);
  const layout = layoutText(text.text, { width, fontSize: size, fontFamily: text.fontFamily, align: text.textAlign }, measure);
  const left = contentX(g, text.x);
  const top = contentY(g, text.y);
  const color = pdfColor(text.color);
  const angle = text.rotation ?? 0;
  // The box turns as a unit: each line keeps its wrapped position and is
  // rotated about the box's centre, so the exported text reads exactly as the
  // canvas draws it.
  const centre = objectCenter(text);
  const pivot = { x: contentX(g, centre.x), y: contentY(g, centre.y) };
  for (const line of layout.lines) {
    if (line.text === "") continue;
    const anchor = rotatePoint({ x: left + line.x, y: top + line.baseline }, pivot, angle);
    page.drawText(safeText(font, line.text), {
      x: anchor.x,
      y: g.pageHeight - anchor.y,
      size,
      font,
      color,
      rotate: pdfRotation(angle),
    });
  }
}

function hasVaryingPressure(pts: StrokePoint[]): boolean {
  if (pts.length < 2) return false;
  const first = pts[0].pressure ?? 0.5;
  for (const p of pts) if (Math.abs((p.pressure ?? 0.5) - first) > 1e-3) return true;
  return false;
}

/**
 * The perfect-freehand outline, smoothed through midpoints exactly as the
 * canvas renderer does, expressed as an SVG path in content space.
 */
function outlineToSvgPath(outline: number[][], g: PageGeometry): string {
  const px = (x: number) => contentX(g, x).toFixed(2);
  const py = (y: number) => contentY(g, y).toFixed(2);
  const parts: string[] = [`M ${px(outline[0][0])} ${py(outline[0][1])}`];
  for (let i = 1; i < outline.length; i++) {
    const [x1, y1] = outline[i];
    const [x2, y2] = outline[(i + 1) % outline.length];
    parts.push(`Q ${px(x1)} ${py(y1)} ${px((x1 + x2) / 2)} ${py((y1 + y2) / 2)}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

/** Characters outside the embedded subset must not abort a whole export. */
function safeText(font: PDFFont, text: string): string {
  try {
    font.widthOfTextAtSize(text, 12);
    return text;
  } catch {
    // Latin-1 plus Latin Extended-A/B, which the bundled subsets cover.
    return text.replace(/[^\u0020-\u007E\u00A0-\u024F]/g, "?");
  }
}

function safeWidth(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return font.widthOfTextAtSize(safeText(font, text), size);
  }
}

/** #rgb / #rrggbb / rgb() to a pdf-lib colour. Unknown formats render black. */
export function pdfColor(css: string) {
  const c = css.trim();
  let r = 0, gr = 0, b = 0;
  if (/^#[0-9a-f]{3}$/i.test(c)) {
    r = parseInt(c[1] + c[1], 16);
    gr = parseInt(c[2] + c[2], 16);
    b = parseInt(c[3] + c[3], 16);
  } else if (/^#[0-9a-f]{6}$/i.test(c)) {
    r = parseInt(c.slice(1, 3), 16);
    gr = parseInt(c.slice(3, 5), 16);
    b = parseInt(c.slice(5, 7), 16);
  } else {
    const m = c.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    if (m) {
      r = Number(m[1]);
      gr = Number(m[2]);
      b = Number(m[3]);
    }
  }
  return rgb(r / 255, gr / 255, b / 255);
}
