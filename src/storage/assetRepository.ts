import { getDB, type AssetRecord } from "./db";

/** Binary asset storage: rendered PDF page images and retained source PDFs. */
export async function putAsset(asset: AssetRecord): Promise<void> {
  await getDB().assets.put(asset);
}

export async function getAsset(id: string): Promise<AssetRecord | undefined> {
  return getDB().assets.get(id);
}
