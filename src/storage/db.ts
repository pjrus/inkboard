import Dexie, { type EntityTable } from "dexie";
import type { CanvasMode, FontFamilyId, LassoFilter, TextAlign, Tool, Viewport } from "../document/schema";

/**
 * IndexedDB layout (via Dexie).
 *
 *  boards       one row per board: metadata + local-only view state
 *  updates      incremental Yjs updates, appended as the user works and
 *               periodically compacted into a single snapshot row
 *  assets       binary blobs (rendered PDF pages, original PDFs) keyed by id
 *  preferences  small key/value store for tool and appearance preferences
 */

export interface BoardRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  viewport?: Viewport;
}

export interface UpdateRecord {
  id?: number;
  boardId: string;
  update: Uint8Array;
  createdAt: number;
}

export interface AssetRecord {
  id: string;
  boardId: string;
  mimeType: string;
  blob: Blob;
  width?: number;
  height?: number;
  size: number;
  createdAt: number;
}

export interface PreferenceRecord {
  key: string;
  value: unknown;
}

export interface ToolPreferences {
  tool: Tool;
  color: string;
  width: number;
  /**
   * Whether the user picked the ink colour themselves. While false the colour
   * tracks the theme's default ink, so a dark board starts with light ink
   * without ever rewriting colours the user chose.
   */
  colorExplicit: boolean;
  textColor: string;
  textColorExplicit: boolean;
  textFont: FontFamilyId;
  textFontSize: number;
  textAlign: TextAlign;
  /** Edit or View. A local interface preference; never shared with peers. */
  canvasMode: CanvasMode;
  /** Which object types the lasso may pick up. Also local-only. */
  lassoFilter: LassoFilter;
}

export class InkboardDB extends Dexie {
  boards!: EntityTable<BoardRecord, "id">;
  updates!: EntityTable<UpdateRecord, "id">;
  assets!: EntityTable<AssetRecord, "id">;
  preferences!: EntityTable<PreferenceRecord, "key">;

  constructor(name = "inkboard") {
    super(name);
    this.version(1).stores({
      boards: "id, updatedAt",
      updates: "++id, boardId",
      assets: "id, boardId",
      preferences: "key",
    });
  }
}

let instance: InkboardDB | null = null;

export function getDB(): InkboardDB {
  if (!instance) instance = new InkboardDB();
  return instance;
}

/** For tests: swap in a fresh database. */
export function setDB(db: InkboardDB) {
  instance = db;
}
