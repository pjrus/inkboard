import { newId } from "../document/ids";
import { getDB, type BoardRecord, type ToolPreferences } from "../storage/db";
import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE, DEFAULT_LASSO_FILTER, type Viewport } from "../document/schema";

export const DEFAULT_TOOL_PREFS: ToolPreferences = {
  tool: "pen",
  color: "#1b1b1f",
  colorExplicit: false,
  width: 3,
  textColor: "#1b1b1f",
  textColorExplicit: false,
  textFont: DEFAULT_FONT_FAMILY,
  textFontSize: DEFAULT_FONT_SIZE,
  textAlign: "left",
  canvasMode: "edit",
  lassoFilter: DEFAULT_LASSO_FILTER,
};

export const boardRepository = {
  async list(): Promise<BoardRecord[]> {
    return getDB().boards.orderBy("updatedAt").reverse().toArray();
  },

  async get(id: string): Promise<BoardRecord | undefined> {
    return getDB().boards.get(id);
  },

  async create(name = "Untitled board"): Promise<BoardRecord> {
    const now = Date.now();
    const board: BoardRecord = { id: newId(10), name, createdAt: now, updatedAt: now };
    await getDB().boards.add(board);
    return board;
  },

  async rename(id: string, name: string): Promise<void> {
    await getDB().boards.update(id, { name, updatedAt: Date.now() });
  },

  /** Deletes the board together with its CRDT updates and binary assets. */
  async delete(id: string): Promise<void> {
    const db = getDB();
    await db.transaction("rw", db.boards, db.updates, db.assets, async () => {
      await db.updates.where("boardId").equals(id).delete();
      await db.assets.where("boardId").equals(id).delete();
      await db.boards.delete(id);
    });
  },

  async saveViewport(id: string, viewport: Viewport): Promise<void> {
    // Viewport is a local preference, not document content; no updatedAt bump.
    await getDB().boards.update(id, { viewport });
  },

  async getToolPreferences(): Promise<ToolPreferences> {
    const row = await getDB().preferences.get("tool");
    return { ...DEFAULT_TOOL_PREFS, ...((row?.value as Partial<ToolPreferences>) ?? {}) };
  },

  async saveToolPreferences(prefs: ToolPreferences): Promise<void> {
    await getDB().preferences.put({ key: "tool", value: prefs });
  },

  async storageUsed(): Promise<number> {
    const db = getDB();
    let total = 0;
    await db.assets.each((a) => {
      total += a.size;
    });
    await db.updates.each((u) => {
      total += u.update.byteLength;
    });
    return total;
  },
};
