import type { ImageCrop, ImageObject } from "../document/schema";
import type { Point } from "./coordinates";
import { objectCenter, rotatePoint } from "./transform";

export type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropSession {
  id: string;
  /** Full uncropped image rectangle in the session's fixed local frame. */
  fullRect: Rect;
  /** Active crop rectangle in the same local frame. */
  cropRect: Rect;
  /** Object rotation at crop start, in radians. */
  rotation: number;
  /** World-space pivot of `rotation` (centre of the object at crop start). */
  pivot: Point;
}

const CROP_EPSILON = 1e-5;
const MIN_CROP_WORLD = 12;
const MIN_CROP_FRACTION = 0.02;

/** Compute the full uncropped rectangle in `obj`'s own local frame. */
export function fullImageLocalRect(obj: ImageObject): Rect {
  const c = obj.crop;
  if (!c || c.width <= 0 || c.height <= 0) {
    return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
  }
  const fullWidth = obj.width / c.width;
  const fullHeight = obj.height / c.height;
  return {
    x: obj.x - c.x * fullWidth,
    y: obj.y - c.y * fullHeight,
    width: fullWidth,
    height: fullHeight,
  };
}

/** Start an interactive crop session for an image or PDF page. */
export function startCropSession(obj: ImageObject): CropSession {
  return {
    id: obj.id,
    fullRect: fullImageLocalRect(obj),
    cropRect: { x: obj.x, y: obj.y, width: obj.width, height: obj.height },
    rotation: obj.rotation ?? 0,
    pivot: objectCenter(obj),
  };
}

/** Reset the crop rectangle to the full uncropped image. */
export function resetCropSession(session: CropSession): CropSession {
  return { ...session, cropRect: { ...session.fullRect } };
}

/** Whether the session's active crop covers the entire image. */
export function isFullCrop(session: CropSession): boolean {
  const { fullRect: f, cropRect: c } = session;
  return (
    Math.abs(c.x - f.x) <= f.width * CROP_EPSILON
    && Math.abs(c.y - f.y) <= f.height * CROP_EPSILON
    && Math.abs(c.width - f.width) <= f.width * CROP_EPSILON
    && Math.abs(c.height - f.height) <= f.height * CROP_EPSILON
  );
}

/** All 8 crop handle centres in world space. */
export function cropHandlePositions(
  session: CropSession,
): Record<CropHandle, Point> {
  const { x, y, width, height } = session.cropRect;
  const mx = x + width / 2;
  const my = y + height / 2;
  const rx = x + width;
  const by = y + height;
  const toWorld = (p: Point) => rotatePoint(p, session.pivot, session.rotation);
  return {
    nw: toWorld({ x, y }),
    n: toWorld({ x: mx, y }),
    ne: toWorld({ x: rx, y }),
    e: toWorld({ x: rx, y: my }),
    se: toWorld({ x: rx, y: by }),
    s: toWorld({ x: mx, y: by }),
    sw: toWorld({ x, y: by }),
    w: toWorld({ x, y: my }),
  };
}

/** Find the closest crop handle within `hitRadiusWorld`, or null. */
export function hitTestCropHandle(
  session: CropSession,
  wp: Point,
  hitRadiusWorld: number,
): CropHandle | null {
  const positions = cropHandlePositions(session);
  const r2 = hitRadiusWorld * hitRadiusWorld;
  let best: CropHandle | null = null;
  let bestDist2 = r2;
  for (const handle of Object.keys(positions) as CropHandle[]) {
    const p = positions[handle];
    const dx = wp.x - p.x;
    const dy = wp.y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestDist2) {
      bestDist2 = d2;
      best = handle;
    }
  }
  return best;
}

/** Whether world point `wp` lies inside the full uncropped image bounds. */
export function pointInFullCropImage(
  session: CropSession,
  wp: Point,
): boolean {
  const lp = rotatePoint(wp, session.pivot, -session.rotation);
  const f = session.fullRect;
  return (
    lp.x >= f.x
    && lp.x <= f.x + f.width
    && lp.y >= f.y
    && lp.y <= f.y + f.height
  );
}

/** Resize the active crop rectangle by dragging `handle` to world point `wp`. */
export function resizeCropSession(
  session: CropSession,
  handle: CropHandle,
  wp: Point,
): CropSession {
  const lp = rotatePoint(wp, session.pivot, -session.rotation);
  const f = session.fullRect;
  const c = session.cropRect;
  const minW = Math.min(
    f.width,
    Math.max(MIN_CROP_WORLD, f.width * MIN_CROP_FRACTION),
  );
  const minH = Math.min(
    f.height,
    Math.max(MIN_CROP_WORLD, f.height * MIN_CROP_FRACTION),
  );

  let minX = c.x;
  let maxX = c.x + c.width;
  let minY = c.y;
  let maxY = c.y + c.height;

  if (handle.includes("w")) {
    minX = clamp(lp.x, f.x, maxX - minW);
  }
  if (handle.includes("e")) {
    maxX = clamp(lp.x, minX + minW, f.x + f.width);
  }
  if (handle.includes("n")) {
    minY = clamp(lp.y, f.y, maxY - minH);
  }
  if (handle.includes("s")) {
    maxY = clamp(lp.y, minY + minH, f.y + f.height);
  }

  return {
    ...session,
    cropRect: {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    },
  };
}

/**
 * Convert the session's active crop rectangle into updated `ImageObject` fields.
 * Accounts for rotation so the uncropped pixels stay stationary in world space.
 */
export function commitCropSession(session: CropSession): {
  x: number;
  y: number;
  width: number;
  height: number;
  crop?: ImageCrop;
} {
  const { fullRect: f, cropRect: c, rotation, pivot } = session;
  const localCenter = { x: c.x + c.width / 2, y: c.y + c.height / 2 };
  const worldCenter = rotatePoint(localCenter, pivot, rotation);
  const x = worldCenter.x - c.width / 2;
  const y = worldCenter.y - c.height / 2;

  if (isFullCrop(session)) {
    return { x, y, width: c.width, height: c.height, crop: undefined };
  }

  return {
    x,
    y,
    width: c.width,
    height: c.height,
    crop: {
      x: clamp((c.x - f.x) / f.width, 0, 1),
      y: clamp((c.y - f.y) / f.height, 0, 1),
      width: clamp(c.width / f.width, 0, 1),
      height: clamp(c.height / f.height, 0, 1),
    },
  };
}

const HANDLE_BASE_ANGLES: Record<CropHandle, number> = {
  n: 0,
  ne: Math.PI / 4,
  e: Math.PI / 2,
  se: (3 * Math.PI) / 4,
  s: Math.PI,
  sw: (5 * Math.PI) / 4,
  w: (3 * Math.PI) / 2,
  nw: (7 * Math.PI) / 4,
};

const CURSORS_BY_OCTANT = [
  "ns-resize",
  "nesw-resize",
  "ew-resize",
  "nwse-resize",
];

/** CSS resize cursor for `handle`, rotated by the image's angle. */
export function cropHandleCursor(handle: CropHandle, rotation: number): string {
  const total = HANDLE_BASE_ANGLES[handle] + rotation;
  const octant = Math.round(total / (Math.PI / 4)) % 4;
  return CURSORS_BY_OCTANT[(octant + 4) % 4];
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
