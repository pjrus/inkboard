import type { CanvasObject } from "../document/schema";
import {
  boundsHeight,
  boundsWidth,
  contentBounds,
  EXPORT_PADDING,
} from "./exportBounds";
import type { PageGeometry } from "./exportCoordinates";

/**
 * Turning an infinite canvas into a PDF: one page exactly the size of the
 * content. No page breaks and no pagination - imported PDF pages are ordinary
 * images on the canvas by now, so their original boundaries are not recreated.
 */

/** The PDF format caps a page at 200 inches; keep the page inside that. */
const MAX_PAGE_POINTS = 14400;

export function planPages(
  objects: CanvasObject[],
  padding = EXPORT_PADDING,
): PageGeometry[] {
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
