import { create } from "zustand";
import type { FontFamilyId, TextAlign, Tool } from "../document/schema";
import type { SaveStatus } from "../document/persistence";
import { boardRepository } from "../boards/BoardRepository";
import { defaultInk } from "../theme/canvasTheme";
import type { ResolvedTheme } from "../theme/themePreferences";

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
  /** Enter inline editing on the single selected text box. */
  editText: () => void;
  remove: () => void;
  clear: () => void;
}

interface ToolState {
  selection: CanvasSelection | null;
  selectionCommands: SelectionCommands | null;
  setSelection: (sel: CanvasSelection | null) => void;
  setSelectionCommands: (cmds: SelectionCommands | null) => void;
  /** Id of the text box with the inline editor open, if any. */
  editingTextId: string | null;
  setEditingTextId: (id: string | null) => void;

  tool: Tool;
  color: string;
  colorExplicit: boolean;
  width: number;
  textColor: string;
  textColorExplicit: boolean;
  textFont: FontFamilyId;
  textFontSize: number;
  textAlign: TextAlign;
  /** Mirrored from the ThemeProvider so default ink can follow the theme. */
  theme: ResolvedTheme;

  /** Once a stylus has been seen, fingers navigate instead of drawing. */
  stylusSeen: boolean;
  saveStatus: SaveStatus;
  zoom: number;
  selectedObjectId: string | null;
  importProgress: ImportProgress | null;
  canUndo: boolean;
  canRedo: boolean;

  setTool: (tool: Tool) => void;
  setColor: (color: string) => void;
  setWidth: (width: number) => void;
  setTextColor: (color: string) => void;
  setTextFont: (font: FontFamilyId) => void;
  setTextFontSize: (size: number) => void;
  setTextAlign: (align: TextAlign) => void;
  setTheme: (theme: ResolvedTheme) => void;
  markStylusSeen: () => void;
  setSaveStatus: (s: SaveStatus) => void;
  setZoom: (z: number) => void;
  setSelectedObjectId: (id: string | null) => void;
  setImportProgress: (p: ImportProgress | null) => void;
  setHistory: (canUndo: boolean, canRedo: boolean) => void;
  hydrate: () => Promise<void>;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persistPrefs(get: () => ToolState) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const s = get();
    void boardRepository.saveToolPreferences({
      tool: s.tool,
      color: s.color,
      colorExplicit: s.colorExplicit,
      width: s.width,
      textColor: s.textColor,
      textColorExplicit: s.textColorExplicit,
      textFont: s.textFont,
      textFontSize: s.textFontSize,
      textAlign: s.textAlign,
    });
  }, 200);
}

export const useToolStore = create<ToolState>((set, get) => ({
  selection: null,
  selectionCommands: null,
  setSelection: (selection) => set({ selection }),
  setSelectionCommands: (selectionCommands) => set({ selectionCommands }),
  editingTextId: null,
  setEditingTextId: (editingTextId) => set({ editingTextId }),

  tool: "pen",
  color: "#1b1b1f",
  colorExplicit: false,
  width: 3,
  textColor: "#1b1b1f",
  textColorExplicit: false,
  textFont: "open-sans",
  textFontSize: 20,
  textAlign: "left",
  theme: "light",

  stylusSeen: false,
  saveStatus: "idle",
  zoom: 1,
  selectedObjectId: null,
  importProgress: null,
  canUndo: false,
  canRedo: false,

  setTool: (tool) => {
    set({ tool, selectedObjectId: tool === "pan" ? get().selectedObjectId : null });
    persistPrefs(get);
  },
  setColor: (color) => {
    set({ color, colorExplicit: true });
    persistPrefs(get);
  },
  setWidth: (width) => {
    set({ width });
    persistPrefs(get);
  },
  setTextColor: (textColor) => {
    set({ textColor, textColorExplicit: true });
    persistPrefs(get);
  },
  setTextFont: (textFont) => {
    set({ textFont });
    persistPrefs(get);
  },
  setTextFontSize: (textFontSize) => {
    set({ textFontSize });
    persistPrefs(get);
  },
  setTextAlign: (textAlign) => {
    set({ textAlign });
    persistPrefs(get);
  },
  /**
   * Following the theme only ever moves colours the user has not chosen.
   * Explicit picks, and every colour already on the board, are left alone.
   */
  setTheme: (theme) => {
    const s = get();
    if (s.theme === theme) return;
    const ink = defaultInk(theme);
    const patch: Partial<ToolState> = { theme };
    if (!s.colorExplicit) patch.color = ink;
    if (!s.textColorExplicit) patch.textColor = ink;
    set(patch);
    if (patch.color || patch.textColor) persistPrefs(get);
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
    if (s.canUndo !== canUndo || s.canRedo !== canRedo) set({ canUndo, canRedo });
  },
  hydrate: async () => {
    const prefs = await boardRepository.getToolPreferences();
    const ink = defaultInk(get().theme);
    set({
      tool: prefs.tool,
      color: prefs.colorExplicit ? prefs.color : ink,
      colorExplicit: prefs.colorExplicit,
      width: prefs.width,
      textColor: prefs.textColorExplicit ? prefs.textColor : ink,
      textColorExplicit: prefs.textColorExplicit,
      textFont: prefs.textFont,
      textFontSize: prefs.textFontSize,
      textAlign: prefs.textAlign,
    });
  },
}));
