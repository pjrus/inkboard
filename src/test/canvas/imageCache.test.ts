import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { ImageCache } from "../../canvas/ImageCache";
import { getDB, InkboardDB, setDB } from "../../storage/db";

it("evicts the least recently used bitmap", async () => {
  setDB(new InkboardDB(`image-cache-${Date.now()}`));
  for (const id of ["a", "b", "c"]) {
    await getDB().assets.put({
      id,
      boardId: "board",
      mimeType: "image/png",
      blob: new Blob([id]),
      size: 1,
      createdAt: 0,
    });
  }
  const closed: string[] = [];
  vi.stubGlobal("createImageBitmap", async (blob: Blob) => {
    const id = await blob.text();
    return { close: () => closed.push(id) };
  });

  const cache = new ImageCache(() => {}, 2);
  const load = async (id: string) => {
    cache.get(id);
    await vi.waitFor(() => expect(cache.get(id)).toBeDefined());
  };
  await load("a");
  await load("b");
  cache.get("a"); // a is now more recent than b
  await load("c");

  expect(closed).toEqual(["b"]);
  vi.unstubAllGlobals();
});

it("does not evict images touched in the active render pass", async () => {
  setDB(new InkboardDB(`image-cache-pass-${Date.now()}`));
  for (const id of ["a", "b", "c"]) {
    await getDB().assets.put({
      id,
      boardId: "board",
      mimeType: "image/png",
      blob: new Blob([id]),
      size: 1,
      createdAt: 0,
    });
  }
  const closed: string[] = [];
  vi.stubGlobal("createImageBitmap", async (blob: Blob) => {
    const id = await blob.text();
    return { close: () => closed.push(id) };
  });

  const cache = new ImageCache(() => {}, 2);
  cache.beginPass();
  cache.get("a");
  cache.get("b");
  cache.get("c");
  await vi.waitFor(() => {
    expect(cache.get("a")).toBeDefined();
    expect(cache.get("b")).toBeDefined();
    expect(cache.get("c")).toBeDefined();
  });
  expect(closed).toEqual([]);

  // Next pass only uses b and c, so a can now be evicted.
  cache.beginPass();
  cache.get("b");
  cache.get("c");
  await getDB().assets.put({
    id: "d",
    boardId: "board",
    mimeType: "image/png",
    blob: new Blob(["d"]),
    size: 1,
    createdAt: 0,
  });
  cache.get("d");
  await vi.waitFor(() => expect(cache.get("d")).toBeDefined());
  expect(closed).toEqual(["a"]);
  vi.unstubAllGlobals();
});

it("closes stale bitmaps when clear() runs mid-decode", async () => {
  setDB(new InkboardDB(`image-cache-clear-${Date.now()}`));
  await getDB().assets.put({
    id: "a",
    boardId: "board",
    mimeType: "image/png",
    blob: new Blob(["a"]),
    size: 1,
    createdAt: 0,
  });
  let resolveDecode!: (bmp: { close: () => void; }) => void;
  const closed: string[] = [];
  vi.stubGlobal(
    "createImageBitmap",
    () =>
      new Promise((resolve) => {
        resolveDecode = resolve;
      }),
  );

  const cache = new ImageCache(() => {}, 2);
  cache.get("a");
  await vi.waitFor(() => expect(resolveDecode).toBeDefined());
  cache.clear();
  resolveDecode({ close: () => closed.push("a") });
  await Promise.resolve();
  expect(closed).toEqual(["a"]);
  expect(cache.get("a")).toBeUndefined();
  vi.unstubAllGlobals();
});
