import type { PDFLayout } from "../document/schema";

export interface PageSize {
  width: number;
  height: number;
}

export interface PagePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_PAGE_GAP = 48;

/**
 * Lay out pages starting at `origin` (top-left of page 1) in world units.
 * Vertical layouts left-align pages; horizontal layouts top-align them.
 * Aspect ratios are preserved: page sizes are used verbatim.
 */
export function layoutPages(
  sizes: PageSize[],
  layout: PDFLayout,
  origin: { x: number; y: number },
  gap: number = DEFAULT_PAGE_GAP,
): PagePlacement[] {
  const out: PagePlacement[] = [];
  let cursorX = origin.x;
  let cursorY = origin.y;
  for (const size of sizes) {
    out.push({ x: cursorX, y: cursorY, width: size.width, height: size.height });
    if (layout === "vertical") {
      cursorY += size.height + gap;
    } else {
      cursorX += size.width + gap;
    }
  }
  return out;
}

/** Total extent of a laid-out document (useful for framing the viewport). */
export function layoutExtent(placements: PagePlacement[]): { width: number; height: number } {
  if (placements.length === 0) return { width: 0, height: 0 };
  let maxX = -Infinity;
  let maxY = -Infinity;
  const minX = placements[0].x;
  const minY = placements[0].y;
  for (const p of placements) {
    maxX = Math.max(maxX, p.x + p.width);
    maxY = Math.max(maxY, p.y + p.height);
  }
  return { width: maxX - minX, height: maxY - minY };
}
