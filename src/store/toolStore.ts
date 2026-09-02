import { create } from "zustand";
import type { Tool } from "../document/schema";
import type { SaveStatus } from "../document/persistence";
import { boardRepository } from "../boards/BoardRepository";

/**
 * Small UI/tool store. Nothing here changes per pointer event: the canvas
 * controller keeps its own imperative state and only publishes coarse values
 * (current zoom, selection) at a throttled rate.
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

export interface StrokeSelection {
  ids: string[];
  widths: number[];
  colors: string[];
}

/** Document-level commands for the current stroke selection (set by the canvas). */
export interface SelectionCommands {
  setWidth: (width: number) => void;
  adjustWidth: (direction: 1 | -1) => void;
  setColor: (color: string) => void;
  remove: () => void;
  clear: () => void;
}

interface ToolState {
  strokeSelection: StrokeSelection | null;
  selectionCommands: SelectionCommands | null;
  setStrokeSelection: (sel: StrokeSelection | null) => void;
  setSelectionCommands: (cmds: SelectionCommands | null) => void;
  tool: Tool;
  color: string;
  width: number;
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
    const { tool, color, width } = get();
    void boardRepository.saveToolPreferences({ tool, color, width });
  }, 200);
}

export const useToolStore = create<ToolState>((set, get) => ({
  strokeSelection: null,
  selectionCommands: null,
  setStrokeSelection: (strokeSelection) => set({ strokeSelection }),
  setSelectionCommands: (selectionCommands) => set({ selectionCommands }),
  tool: "pen",
  color: "#1b1b1f",
  width: 3,
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
    set({ color });
    persistPrefs(get);
  },
  setWidth: (width) => {
    set({ width });
    persistPrefs(get);
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
    set({ tool: prefs.tool, color: prefs.color, width: prefs.width });
  },
}));
