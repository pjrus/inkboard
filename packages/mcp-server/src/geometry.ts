import {
  type Bounds,
  type CanvasObject,
  type StrokePoint,
  TEXT_LINE_HEIGHT,
  type TextObject,
} from "./schema.js";

export const DEFAULT_BACKGROUND = "#f3f1ec";

export function isDarkColor(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  if (Number.isNaN(n)) return false;
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 128;
}

export function defaultInkForBackground(background: string): string {
  return isDarkColor(background) ? "#f2f1ee" : "#1b1b1f";
}

export function packPoints(points: StrokePoint[]): number[] {
  const flat: number[] = new Array(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    flat[i * 3] = p.x;
    flat[i * 3 + 1] = p.y;
    flat[i * 3 + 2] = p.pressure ?? 0.5;
  }
  return flat;
}

export function unpackPoints(flat: number[]): StrokePoint[] {
  const out: StrokePoint[] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    out.push({ x: flat[i], y: flat[i + 1], pressure: flat[i + 2] });
  }
  return out;
}

export function computeBoundsFlat(flat: number[], width: number): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 2 < flat.length; i += 3) {
    const x = flat[i];
    const y = flat[i + 1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const pad = width;
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
  };
}

/**
 * Headless text height estimation matching `src/text/textMeasure.ts` headless
 * fallback (0.5 * fontSize per char) + greedy word wrap.
 */
export function estimateTextHeight(
  o: Pick<TextObject, "text" | "fontSize" | "width" | "height">,
): number {
  if (
    typeof o.height === "number" && Number.isFinite(o.height) && o.height > 0
  ) {
    return o.height;
  }
  const lineHeight = o.fontSize * TEXT_LINE_HEIGHT;
  const charWidth = o.fontSize * 0.5;
  const measure = (t: string) => t.length * charWidth;
  let lines = 0;
  for (const paragraph of o.text.split("\n")) {
    if (paragraph === "") {
      lines++;
      continue;
    }
    const words = paragraph.match(/\S+\s*/g) ?? [paragraph];
    let line = "";
    for (const word of words) {
      const candidate = line + word;
      if (line !== "" && measure(candidate.trimEnd()) > o.width) {
        lines++;
        line = "";
      }
      if (measure(word.trimEnd()) > o.width) {
        let chunk = line;
        for (const ch of word) {
          if (chunk !== "" && measure((chunk + ch).trimEnd()) > o.width) {
            lines++;
            chunk = "";
          }
          chunk += ch;
        }
        line = chunk;
      } else {
        line += word;
      }
    }
    lines++;
  }
  return Math.max(1, lines) * lineHeight;
}

export function rotatePoint(
  p: { x: number; y: number; },
  pivot: { x: number; y: number; },
  angle: number,
): { x: number; y: number; } {
  if (angle === 0) return { x: p.x, y: p.y };
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  return {
    x: pivot.x + dx * cos - dy * sin,
    y: pivot.y + dx * sin + dy * cos,
  };
}

export function localRect(o: CanvasObject): Bounds {
  if (o.type === "stroke") return o.bounds;
  if (o.type === "text") {
    return {
      minX: o.x,
      minY: o.y,
      maxX: o.x + o.width,
      maxY: o.y + estimateTextHeight(o),
    };
  }
  return { minX: o.x, minY: o.y, maxX: o.x + o.width, maxY: o.y + o.height };
}

export function transformedBounds(o: CanvasObject): Bounds {
  const r = localRect(o);
  const angle = o.type === "stroke" ? 0 : (o.rotation ?? 0);
  if (angle === 0) return r;
  const center = { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 };
  const corners = [
    { x: r.minX, y: r.minY },
    { x: r.maxX, y: r.minY },
    { x: r.maxX, y: r.maxY },
    { x: r.minX, y: r.maxY },
  ].map((p) => rotatePoint(p, center, angle));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  return { minX, minY, maxX, maxY };
}

export function unionBounds(list: Bounds[]): Bounds | null {
  if (list.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of list) {
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return (
    a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
  );
}

export function pdfFileName(boardName: string): string {
  const cleaned = boardName
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "")
    .slice(0, 80)
    .trim();
  return `${cleaned || "Untitled board"}.pdf`;
}
