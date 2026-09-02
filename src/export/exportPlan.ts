import type { Bounds, CanvasObject, PDFPageObject } from "../document/schema";
import { boundsHeight, boundsWidth, contentBounds, EXPORT_PADDING, objectBounds, overlaps } from "./exportBounds";
import type { PageGeometry } from "./exportCoordinates";

/**
 * Turning an infinite canvas into a finite set of pages.
 *
 * Three layouts, in increasing amounts of structure:
 *   fit       one page the size of the content
 *   a4        the content scaled to A4 width and paginated down the page
 *   pdf-pages one output page per imported PDF page, so an annotated import
 *             comes back out looking like the original document
 */
export type ExportLayout = "fit" | "a4" | "pdf-pages";
export type ExportOrientation = "auto" | "portrait" | "landscape";

export const A4_PORTRAIT = { width: 595.28, height: 841.89 };
/** Margin used by the paginated layouts, in PDF points. */
export const PAGE_MARGIN = 36;
/** The PDF format caps a page at 200 inches; keep "fit" pages inside that. */
const MAX_PAGE_POINTS = 14400;

export interface ExportPlan {
  pages: PageGeometry[];
  /** Objects the plan will draw, in document order. */
  objects: CanvasObject[];
}

function pageSize(orientation: ExportOrientation, content: Bounds | null) {
  const landscape =
    orientation === "landscape" ||
    (orientation === "auto" && content !== null && boundsWidth(content) > boundsHeight(content));
  return landscape
    ? { width: A4_PORTRAIT.height, height: A4_PORTRAIT.width }
    : { width: A4_PORTRAIT.width, height: A4_PORTRAIT.height };
}

/** One page exactly the size of the content. */
export function planFitPages(objects: CanvasObject[], padding = EXPORT_PADDING): PageGeometry[] {
  const b = contentBounds(objects, padding);
  if (!b) return [];
  const w = boundsWidth(b);
  const h = boundsHeight(b);
  const scale = Math.min(1, MAX_PAGE_POINTS / Math.max(w, h));
  return [
    {
      source: b,
      pageWidth: Math.max(1, w * scale),
      pageHeight: Math.max(1, h * scale),
      scale,
      marginX: 0,
      marginY: 0,
      label: "Canvas",
    },
  ];
}

/** Content scaled to fit the page width, then sliced into page-height strips. */
export function planA4Pages(objects: CanvasObject[], orientation: ExportOrientation, padding = EXPORT_PADDING): PageGeometry[] {
  const b = contentBounds(objects, padding);
  if (!b) return [];
  const { width: pageWidth, height: pageHeight } = pageSize(orientation, b);
  const innerW = pageWidth - PAGE_MARGIN * 2;
  const innerH = pageHeight - PAGE_MARGIN * 2;
  const scale = Math.min(innerW / boundsWidth(b), 1000);
  const sliceHeight = innerH / scale;
  const total = Math.max(1, Math.ceil(boundsHeight(b) / sliceHeight - 1e-9));
  const pages: PageGeometry[] = [];
  for (let i = 0; i < total; i++) {
    const minY = b.minY + i * sliceHeight;
    pages.push({
      source: { minX: b.minX, maxX: b.maxX, minY, maxY: minY + sliceHeight },
      pageWidth,
      pageHeight,
      scale,
      marginX: PAGE_MARGIN,
      // A single short page is centred; a paginated run stays top-aligned so
      // the slices join up.
      marginY: total === 1 ? Math.max(PAGE_MARGIN, (pageHeight - boundsHeight(b) * scale) / 2) : PAGE_MARGIN,
      label: `Page ${i + 1} of ${total}`,
    });
  }
  return pages;
}

/**
 * One output page per imported PDF page, at the page's own size, plus a final
 * page for anything drawn outside every imported page so nothing is dropped.
 */
export function planPDFPages(objects: CanvasObject[], padding = EXPORT_PADDING): PageGeometry[] {
  const pdfPages = objects.filter((o): o is PDFPageObject => o.type === "pdf-page");
  if (pdfPages.length === 0) return planFitPages(objects, padding);
  pdfPages.sort((a, b) => a.createdAt - b.createdAt || a.pageNumber - b.pageNumber);

  const pages: PageGeometry[] = pdfPages.map((p, i) => ({
    source: { minX: p.x, minY: p.y, maxX: p.x + p.width, maxY: p.y + p.height },
    pageWidth: p.width,
    pageHeight: p.height,
    scale: 1,
    marginX: 0,
    marginY: 0,
    label: `Page ${i + 1} of ${pdfPages.length}`,
  }));

  const pageRects = pages.map((g) => g.source);
  const strays = objects.filter((o) => o.type !== "pdf-page" && !pageRects.some((r) => overlaps(objectBounds(o), r)));
  if (strays.length) {
    for (const extra of planFitPages(strays, padding)) {
      pages.push({ ...extra, label: `Canvas notes (page ${pages.length + 1})` });
    }
  }
  return pages;
}

export function planPages(objects: CanvasObject[], layout: ExportLayout, orientation: ExportOrientation = "auto"): PageGeometry[] {
  if (objects.length === 0) return [];
  if (layout === "a4") return planA4Pages(objects, orientation);
  if (layout === "pdf-pages") return planPDFPages(objects);
  return planFitPages(objects);
}

/** Whether "match PDF pages" makes sense for this board. */
export function hasImportedPages(objects: CanvasObject[]): boolean {
  return objects.some((o) => o.type === "pdf-page");
}
