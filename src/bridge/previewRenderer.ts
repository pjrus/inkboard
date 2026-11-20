import {
  hasVaryingPressure,
  strokeAlpha,
  strokeOutline,
} from "../canvas/strokeGeometry";
import { objectCenter } from "../canvas/transform";
import type { CanvasDocument } from "../document/crdt";
import {
  type ImageObject,
  type StrokeObject,
  type TextObject,
  unpackPoints,
} from "../document/schema";
import {
  boundsHeight,
  boundsWidth,
  contentBounds,
} from "../export/exportBounds";
import { getDB } from "../storage/db";
import { canvasFont } from "../text/fonts";
import { measureText } from "../text/textMeasure";

export interface BoardPreviewResult {
  dataBase64: string;
  mimeType: "image/png";
  width: number;
  height: number;
}

/**
 * Render the board's content bounds to an offscreen PNG for the
 * `inkboard://boards/{boardId}/preview` MCP resource.
 */
export async function renderBoardPreview(
  doc: CanvasDocument,
  maxDimension = 1200,
): Promise<BoardPreviewResult> {
  if (typeof document === "undefined") {
    throw new Error("PNG preview rendering requires a browser DOM context.");
  }

  const all = doc.getAll();
  const bounds = contentBounds(all, 40) ?? {
    minX: -400,
    minY: -300,
    maxX: 400,
    maxY: 300,
  };
  const worldW = Math.max(1, boundsWidth(bounds));
  const worldH = Math.max(1, boundsHeight(bounds));
  const scale = Math.min(1, maxDimension / Math.max(worldW, worldH));
  const pxW = Math.max(1, Math.round(worldW * scale));
  const pxH = Math.max(1, Math.round(worldH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not acquire 2D canvas context for board preview.");
  }

  ctx.fillStyle = doc.getBackground();
  ctx.fillRect(0, 0, pxW, pxH);

  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-bounds.minX, -bounds.minY);

  const images: ImageObject[] = [];
  const strokes: StrokeObject[] = [];
  const texts: TextObject[] = [];
  for (const o of all) {
    if (o.type === "image") images.push(o);
    else if (o.type === "stroke") strokes.push(o);
    else if (o.type === "text") texts.push(o);
  }
  images.sort(
    (a, b) =>
      a.createdAt - b.createdAt || (a.pageNumber ?? 0) - (b.pageNumber ?? 0),
  );
  strokes.sort((a, b) => a.createdAt - b.createdAt);
  texts.sort((a, b) => a.createdAt - b.createdAt);

  for (const img of images) {
    await drawImage(ctx, img);
  }
  for (const stroke of strokes) {
    drawStroke(ctx, stroke);
  }
  for (const text of texts) {
    drawText(ctx, text);
  }

  ctx.restore();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("Canvas PNG encoding failed."));
    }, "image/png");
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    dataBase64: bytesToBase64(bytes),
    mimeType: "image/png",
    width: pxW,
    height: pxH,
  };
}

async function drawImage(
  ctx: CanvasRenderingContext2D,
  obj: ImageObject,
): Promise<void> {
  const rec = await getDB().assets.get(obj.assetId);
  if (!rec) return;
  const bitmap = await createImageBitmap(rec.blob);
  try {
    const angle = obj.rotation ?? 0;
    const c = objectCenter(obj);
    ctx.save();
    if (angle !== 0) {
      ctx.translate(c.x, c.y);
      ctx.rotate(angle);
      ctx.translate(-c.x, -c.y);
    }
    if (obj.crop) {
      ctx.drawImage(
        bitmap,
        obj.crop.x * bitmap.width,
        obj.crop.y * bitmap.height,
        obj.crop.width * bitmap.width,
        obj.crop.height * bitmap.height,
        obj.x,
        obj.y,
        obj.width,
        obj.height,
      );
    } else {
      ctx.drawImage(bitmap, obj.x, obj.y, obj.width, obj.height);
    }
    ctx.restore();
  } finally {
    bitmap.close();
  }
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: StrokeObject,
): void {
  const pts = unpackPoints(stroke.points);
  const outline = strokeOutline(
    pts,
    stroke.tool,
    stroke.width,
    stroke.tool === "pen" && hasVaryingPressure(pts),
  );
  if (outline.length === 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    const [x1, y1] = outline[i];
    const [x2, y2] = outline[(i + 1) % outline.length];
    ctx.quadraticCurveTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2);
  }
  ctx.closePath();
  ctx.fillStyle = stroke.color;
  ctx.globalAlpha = strokeAlpha(stroke.tool);
  if (stroke.tool === "highlighter") {
    ctx.globalCompositeOperation = "multiply";
  }
  ctx.fill();
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, text: TextObject): void {
  const layout = measureText(text);
  const angle = text.rotation ?? 0;
  const c = objectCenter(text);

  ctx.save();
  if (angle !== 0) {
    ctx.translate(c.x, c.y);
    ctx.rotate(angle);
    ctx.translate(-c.x, -c.y);
  }
  if (text.backgroundColor && text.backgroundColor !== "transparent") {
    ctx.fillStyle = text.backgroundColor;
    ctx.fillRect(text.x, text.y, text.width, layout.height);
  }
  ctx.fillStyle = text.color;
  ctx.font = canvasFont(text.fontFamily, text.fontSize);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  for (const line of layout.lines) {
    if (line.text !== "") {
      ctx.fillText(line.text, text.x + line.x, text.y + line.baseline);
    }
  }
  ctx.restore();
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    parts.push(
      String.fromCharCode(...bytes.subarray(i, i + chunkSize)),
    );
  }
  return btoa(parts.join(""));
}
