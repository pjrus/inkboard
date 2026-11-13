import { describe, expect, it } from "vitest";
import {
  commitCropSession,
  cropHandleCursor,
  cropHandlePositions,
  fullImageLocalRect,
  hitTestCropHandle,
  isFullCrop,
  pointInFullCropImage,
  resetCropSession,
  resizeCropSession,
  startCropSession,
} from "../../canvas/imageCrop";
import { objectCorners, rotatePoint } from "../../canvas/transform";
import { CanvasDocument } from "../../document/crdt";
import type { ImageObject } from "../../document/schema";

const makeImage = (overrides: Partial<ImageObject> = {}): ImageObject => ({
  id: "img1",
  type: "image",
  assetId: "asset1",
  x: 100,
  y: 200,
  width: 400,
  height: 300,
  rotation: 0,
  createdAt: 1,
  ...overrides,
});

describe("imageCrop", () => {
  it("recovers the full uncropped rect from a cropped image", () => {
    const img = makeImage({
      x: 200,
      y: 275,
      width: 200,
      height: 150,
      crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    });
    expect(fullImageLocalRect(img)).toEqual({
      x: 100,
      y: 200,
      width: 400,
      height: 300,
    });
  });

  it("crops from corners and edges and clamps to full image bounds", () => {
    const img = makeImage();
    let session = startCropSession(img);
    expect(isFullCrop(session)).toBe(true);

    // Drag top-left handle inward by (100, 60).
    session = resizeCropSession(session, "nw", { x: 200, y: 260 });
    expect(session.cropRect).toEqual({
      x: 200,
      y: 260,
      width: 300,
      height: 240,
    });
    expect(isFullCrop(session)).toBe(false);

    // Dragging bottom-right beyond full image clamps to full image edge (500, 500).
    session = resizeCropSession(session, "se", { x: 999, y: 999 });
    expect(session.cropRect).toEqual({
      x: 200,
      y: 260,
      width: 300,
      height: 240,
    });

    const committed = commitCropSession(session);
    expect(committed.x).toBe(200);
    expect(committed.y).toBe(260);
    expect(committed.width).toBe(300);
    expect(committed.height).toBe(240);
    expect(committed.crop).toEqual({
      x: 0.25,
      y: 0.2,
      width: 0.75,
      height: 0.8,
    });
  });

  it("prevents collapsing crop below minimum size", () => {
    const img = makeImage();
    let session = startCropSession(img);
    session = resizeCropSession(session, "w", { x: 1000, y: 350 });
    expect(session.cropRect.width).toBeGreaterThanOrEqual(12);
    expect(session.cropRect.x + session.cropRect.width).toBe(500);
  });

  it("keeps cropped world-space corners stationary when image is rotated", () => {
    const angle = Math.PI / 6; // 30 degrees
    const img = makeImage({ rotation: angle });
    let session = startCropSession(img);

    // Move the east edge inward by 100 in local space:
    // Local center of full rect is (300, 350). East edge at local x=400, y=350.
    const localTarget = { x: 400, y: 350 };
    const worldTarget = rotatePoint(localTarget, session.pivot, angle);
    session = resizeCropSession(session, "e", worldTarget);

    // Expected world corners of the cropRect in the fixed session frame:
    const c = session.cropRect;
    const expectedWorldCorners = [
      { x: c.x, y: c.y },
      { x: c.x + c.width, y: c.y },
      { x: c.x + c.width, y: c.y + c.height },
      { x: c.x, y: c.y + c.height },
    ].map((p) => rotatePoint(p, session.pivot, angle));

    const committed = commitCropSession(session);
    const updatedImg: ImageObject = { ...img, ...committed };
    const actualWorldCorners = objectCorners(updatedImg);

    for (let i = 0; i < 4; i++) {
      expect(actualWorldCorners[i].x).toBeCloseTo(expectedWorldCorners[i].x, 6);
      expect(actualWorldCorners[i].y).toBeCloseTo(expectedWorldCorners[i].y, 6);
    }
  });

  it("clears crop field when reset to full image", () => {
    const img = makeImage({
      x: 200,
      y: 275,
      width: 200,
      height: 150,
      crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    });
    const session = resetCropSession(startCropSession(img));
    expect(isFullCrop(session)).toBe(true);
    const committed = commitCropSession(session);
    expect(committed).toEqual({
      x: 100,
      y: 200,
      width: 400,
      height: 300,
      crop: undefined,
    });
  });

  it("hit-tests handles and full image bounds in rotated space", () => {
    const img = makeImage({ rotation: Math.PI / 2 });
    const session = startCropSession(img);
    const handles = cropHandlePositions(session);
    expect(hitTestCropHandle(session, handles.nw, 10)).toBe("nw");
    expect(hitTestCropHandle(session, handles.s, 10)).toBe("s");
    expect(hitTestCropHandle(session, { x: 9999, y: 9999 }, 10)).toBeNull();
    expect(pointInFullCropImage(session, session.pivot)).toBe(true);
    expect(pointInFullCropImage(session, { x: 9999, y: 9999 })).toBe(false);
  });

  it("rotates handle cursors by object angle", () => {
    expect(cropHandleCursor("n", 0)).toBe("ns-resize");
    expect(cropHandleCursor("n", Math.PI / 2)).toBe("ew-resize");
    expect(cropHandleCursor("nw", 0)).toBe("nwse-resize");
    expect(cropHandleCursor("nw", Math.PI / 2)).toBe("nesw-resize");
  });

  it("applies cropImage via CRDT with full undo/redo support", () => {
    const doc = new CanvasDocument();
    const img = doc.addImage({
      assetId: "a1",
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      rotation: 0,
    });
    doc.cropImage(img.id, {
      x: 100,
      y: 50,
      width: 200,
      height: 150,
      crop: { x: 0.25, y: 1 / 6, width: 0.5, height: 0.5 },
    });
    const cropped = doc.get(img.id) as ImageObject;
    expect(cropped.width).toBe(200);
    expect(cropped.crop).toEqual({
      x: 0.25,
      y: 1 / 6,
      width: 0.5,
      height: 0.5,
    });

    doc.undo();
    const undone = doc.get(img.id) as ImageObject;
    expect(undone.width).toBe(400);
    expect(undone.crop).toBeUndefined();

    doc.redo();
    const redone = doc.get(img.id) as ImageObject;
    expect(redone.width).toBe(200);
    expect(redone.crop?.x).toBe(0.25);
  });
});
