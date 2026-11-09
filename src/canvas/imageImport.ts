import type { CanvasDocument } from "../document/crdt";
import { newId } from "../document/ids";
import type { ImageObject } from "../document/schema";
import { type AssetRecord, getDB } from "../storage/db";

/** Maximum pixel dimension for raster assets stored in IndexedDB. */
export const MAX_RASTER_DIMENSION = 2800;

/** Default maximum dimension in world space when placing an image on canvas. */
export const MAX_INITIAL_WORLD_SIZE = 800;

export const JPEG_QUALITY = 0.88;

export interface ImageImportOptions {
  boardId: string;
  doc: CanvasDocument;
  fileOrBlob: Blob | File;
  targetCenter: { x: number; y: number; };
  maxInitialWorldSize?: number;
  onAssetReady?: (assetId: string) => void;
}

export function isImageFile(fileOrBlob: Blob | File): boolean {
  if (fileOrBlob.type && fileOrBlob.type.startsWith("image/")) return true;
  if ("name" in fileOrBlob && typeof fileOrBlob.name === "string") {
    const ext = fileOrBlob.name.toLowerCase().split(".").pop();
    if (
      ext
      && ["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "avif"].includes(
        ext,
      )
    ) {
      return true;
    }
  }
  return false;
}

interface DecodedImage {
  width: number;
  height: number;
  source?: ImageBitmap | HTMLImageElement;
  close: () => void;
}

async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        width: bitmap.width,
        height: bitmap.height,
        source: bitmap,
        close: () => bitmap.close?.(),
      };
    } catch {
      // Fall through if createImageBitmap is not supported for this blob format
    }
  }

  if (
    typeof Image !== "undefined"
    && typeof URL !== "undefined"
    && typeof URL.createObjectURL === "function"
  ) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        resolve({
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
          source: img,
          close: () => URL.revokeObjectURL(url),
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not decode image"));
      };
      img.src = url;
    });
  }

  return {
    width: 600,
    height: 400,
    close: () => {},
  };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality = JPEG_QUALITY,
): Promise<Blob> {
  if (typeof canvas.toBlob !== "function") {
    return Promise.reject(new Error("toBlob not supported"));
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      type,
      quality,
    );
  });
}

/**
 * Import an image file or blob into the board.
 *
 * Saves the raster asset in IndexedDB (downscaling and transcoding to PNG or JPEG
 * if needed so PDF export and rendering are always reliable), creates an ImageObject
 * on the CRDT sized to reasonable world dimensions, and centers it at `targetCenter`.
 */
export async function importImage(
  opts: ImageImportOptions,
): Promise<ImageObject> {
  const { boardId, doc, fileOrBlob, targetCenter, onAssetReady } = opts;
  const decoded = await decodeImage(fileOrBlob);

  try {
    let finalBlob: Blob = fileOrBlob;
    let rasterWidth = decoded.width;
    let rasterHeight = decoded.height;
    let mimeType = fileOrBlob.type || "image/png";

    const needsTranscode =
      (mimeType !== "image/png" && mimeType !== "image/jpeg")
      || decoded.width > MAX_RASTER_DIMENSION
      || decoded.height > MAX_RASTER_DIMENSION;

    if (
      needsTranscode
      && typeof document !== "undefined"
      && typeof document.createElement === "function"
      && decoded.source
    ) {
      try {
        const scale = Math.min(
          1,
          MAX_RASTER_DIMENSION / Math.max(decoded.width, decoded.height),
        );
        rasterWidth = Math.max(1, Math.round(decoded.width * scale));
        rasterHeight = Math.max(1, Math.round(decoded.height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = rasterWidth;
        canvas.height = rasterHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(decoded.source, 0, 0, rasterWidth, rasterHeight);
          const targetType = mimeType === "image/png"
              || mimeType === "image/webp"
              || mimeType === "image/svg+xml"
            ? "image/png"
            : "image/jpeg";
          const converted = await canvasToBlob(
            canvas,
            targetType,
            JPEG_QUALITY,
          );
          finalBlob = converted;
          mimeType = targetType;
        }
        canvas.width = canvas.height = 0;
      } catch (err) {
        console.warn("Could not transcode image; keeping original format", err);
      }
    }

    const maxWorldSize = opts.maxInitialWorldSize ?? MAX_INITIAL_WORLD_SIZE;
    let worldWidth = rasterWidth;
    let worldHeight = rasterHeight;
    if (worldWidth > maxWorldSize || worldHeight > maxWorldSize) {
      const fit = Math.min(
        maxWorldSize / worldWidth,
        maxWorldSize / worldHeight,
      );
      worldWidth = Math.max(1, Math.round(worldWidth * fit));
      worldHeight = Math.max(1, Math.round(worldHeight * fit));
    }

    const assetId = newId(12);
    const assetRecord: AssetRecord = {
      id: assetId,
      boardId,
      mimeType,
      blob: finalBlob,
      width: rasterWidth,
      height: rasterHeight,
      size: finalBlob.size,
      createdAt: Date.now(),
    };
    await getDB().assets.put(assetRecord);

    const imageObj = doc.addImage({
      assetId,
      x: Math.round(targetCenter.x - worldWidth / 2),
      y: Math.round(targetCenter.y - worldHeight / 2),
      width: worldWidth,
      height: worldHeight,
      rotation: 0,
    });

    onAssetReady?.(assetId);
    return imageObj;
  } finally {
    decoded.close();
  }
}
