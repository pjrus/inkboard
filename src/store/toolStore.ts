import { create } from "zustand";
import { boardRepository, DEFAULT_TOOL_PREFS } from "../boards/BoardRepository";
import type { SaveStatus } from "../document/persistence";
import type {
  CanvasMode,
  FontFamilyId,
  LassoFilter,
  TextAlign,
  Tool,
} from "../document/schema";
import type { ToolPreferences } from "../storage/db";
import { canvasTheme, DEFAULT_BACKGROUND } from "../theme/canvasTheme";

/**
 * Small UI/tool store. Nothing here changes per pointer event: the canvas
 * controller keeps its own imperative state and only publishes coarse values
 * (current zoom, selection) at a throttled rate.
 *
 * Pen settings and text settings are deliberately separate, so configuring a
 * text box never silently changes the pen the user is drawing with.
 */

export const PALETTE = [
  { name: "Black", value: "#1b1b1f" },
  { name: "Dark grey", value: "#5f6368" },
  { name: "Red", value: "#d93025" },
  { name: "Orange", value: "#f2994a" },
  { name: "Yellow", value: "#f2c94c" },
  { name: "Green", value: "#2e9e5b" },
  { name: "Blue", value: "#2b6de9" },
  { name: "Purple", value: "#8e44ad" },
  { name: "White", value: "#f2f1ee" },
];

export const THICKNESS_PRESETS = [
  { name: "Extra thin", value: 1.5 },
  { name: "Thin", value: 2.5 },
  { name: "Medium", value: 4 },
  { name: "Thick", value: 7 },
  { name: "Extra thick", value: 12 },
];

export interface ImportProgress {
  fileName: string;
  done: number;
  total: number;
  error?: string;
}

/**
 * The current local selection, summarised for the UI. Never synced: what one
 * person has selected is nobody else's business.
 */
export interface CanvasSelection {
  ids: string[];
  strokeIds: string[];
  textIds: string[];
  /** Imported images and PDF page images. */
  imageIds: string[];
  /** Widths of the selected strokes only. */
  widths: number[];
  /** Colours of every selected object (strokes and text both have one). */
  colors: string[];
  fonts: FontFamilyId[];
  fontSizes: number[];
  aligns: TextAlign[];
}

/** Document-level commands for the current selection (set by the canvas). */
export interface SelectionCommands {
  setWidth: (width: number) => void;
  adjustWidth: (direction: 1 | -1) => void;
  setColor: (color: string) => void;
  setFont: (font: FontFamilyId) => void;
  setFontSize: (size: number) => void;
  adjustFontSize: (direction: 1 | -1) => void;
  setAlign: (align: TextAlign) => void;
  /** Rotate the whole selection about its shared centre, in radians. */
  rotate: (angleDelta: number) => void;
  /** Enter inline editing on the single selected text box. */
  editText: () => void;
  remove: () => void;
  clear: () => void;
}

interface ToolState extends ToolPreferences {
  selection: CanvasSelection | null;
  selectionCommands: SelectionCommands | null;
  setSelection: (sel: CanvasSelection | null) => void;
  setSelectionCommands: (cmds: SelectionCommands | null) => void;
  /** Id of the text box with the inline editor open, if any. */
  editingTextId: string | null;
  setEditingTextId: (id: string | null) => void;

  /**
   * The open board's background colour, mirrored from its document so the
   * menu can show it and default ink can contrast with it.
   */
  background: string;

  /** Once a stylus has been seen, fingers navigate instead of drawing. */
  stylusSeen: boolean;
  saveStatus: SaveStatus;
  zoom: number;
  selectedObjectId: string | null;
  importProgress: ImportProgress | null;
  canUndo: boolean;
  canRedo: boolean;

  setTool: (tool: Tool) => void;
  setCanvasMode: (mode: CanvasMode) => void;
  toggleLassoFilter: (key: keyof LassoFilter) => void;
  setColor: (color: string) => void;
  setWidth: (width: number) => void;
  setTextColor: (color: string) => void;
  setTextFont: (font: FontFamilyId) => void;
  setTextFontSize: (size: number) => void;
  setTextAlign: (align: TextAlign) => void;
  setBackground: (background: string) => void;
  markStylusSeen: () => void;
  setSaveStatus: (s: SaveStatus) => void;
  setZoom: (z: number) => void;
  setSelectedObjectId: (id: string | null) => void;
  setImportProgress: (p: ImportProgress | null) => void;
  setHistory: (canUndo: boolean, canRedo: boolean) => void;
  hydrate: () => Promise<void>;
}

const PREF_KEYS = Object.keys(DEFAULT_TOOL_PREFS) as (keyof ToolPreferences)[];

export const useToolStore = create<ToolState>((set, get) => ({
  selection: null,
  selectionCommands: null,
  setSelection: (selection) => set({ selection }),
  setSelectionCommands: (selectionCommands) => set({ selectionCommands }),
  editingTextId: null,
  setEditingTextId: (editingTextId) => set({ editingTextId }),

  ...DEFAULT_TOOL_PREFS,
  background: DEFAULT_BACKGROUND,

  stylusSeen: false,
  saveStatus: "idle",
  zoom: 1,
  selectedObjectId: null,
  importProgress: null,
  canUndo: false,
  canRedo: false,

  setTool: (tool) => {
    set({
      tool,
      selectedObjectId: tool === "pan" ? get().selectedObjectId : null,
    });
  },
  setCanvasMode: (canvasMode) => {
    if (get().canvasMode === canvasMode) return;
    // Entering View mode drops the selection and any open editor; the canvas
    // itself does that (see CanvasViewport), and the viewport is left alone.
    set({
      canvasMode,
      selection: canvasMode === "view" ? null : get().selection,
    });
  },
  /**
   * Toggling every type off would make the lasso useless, so the last
   * remaining type stays on rather than silently selecting nothing.
   */
  toggleLassoFilter: (key) => {
    const current = get().lassoFilter;
    const next = { ...current, [key]: !current[key] };
    if (!next.ink && !next.text && !next.images) return;
    set({ lassoFilter: next });
  },
  setColor: (color) => set({ color, colorExplicit: true }),
  setWidth: (width) => set({ width }),
  setTextColor: (textColor) => set({ textColor, textColorExplicit: true }),
  setTextFont: (textFont) => set({ textFont }),
  setTextFontSize: (textFontSize) => set({ textFontSize }),
  setTextAlign: (textAlign) => set({ textAlign }),
  /**
   * Following the background only ever moves colours the user has not
   * chosen. Explicit picks, and every colour already on the board, are left
   * alone.
   */
  setBackground: (background) => {
    const s = get();
    if (s.background === background) return;
    const ink = canvasTheme(background).defaultInk;
    const patch: Partial<ToolState> = { background };
    if (!s.colorExplicit) patch.color = ink;
    if (!s.textColorExplicit) patch.textColor = ink;
    set(patch);
  },
  markStylusSeen: () => {
    if (!get().stylusSeen) set({ stylusSeen: true });
  },
  setSaveStatus: (saveStatus) => set({ saveStatus }),
  setZoom: (zoom) => {
    if (Math.abs(zoom - get().zoom) > 1e-4) set({ zoom });
  },
  setSelectedObjectId: (selectedObjectId) => set({ selectedObjectId }),
  setImportProgress: (importProgress) => set({ importProgress }),
  setHistory: (canUndo, canRedo) => {
    const s = get();
    if (s.canUndo !== canUndo || s.canRedo !== canRedo) {
      set({ canUndo, canRedo });
    }
  },
  hydrate: async () => {
    const prefs = await boardRepository.getToolPreferences();
    const ink = canvasTheme(get().background).defaultInk;
    set({
      ...prefs,
      color: prefs.colorExplicit ? prefs.color : ink,
      textColor: prefs.textColorExplicit ? prefs.textColor : ink,
    });
  },
}));

// Any change to a persisted preference is saved, debounced.
let persistTimer: ReturnType<typeof setTimeout> | null = null;
useToolStore.subscribe((s, prev) => {
  if (!PREF_KEYS.some((k) => s[k] !== prev[k])) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const now = useToolStore.getState();
    void boardRepository.saveToolPreferences({
      ...DEFAULT_TOOL_PREFS,
      ...(Object.fromEntries(
        PREF_KEYS.map((k) => [k, now[k]]),
      ) as Partial<ToolPreferences>),
    });
  }, 200);
});
