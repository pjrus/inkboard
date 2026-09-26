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
