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
  setPencilColor: (color: string) => void;
  setWidth: (width: number) => void;
  setHighlighterColor: (color: string) => void;
  setHighlighterWidth: (width: number) => void;
  setColorProfile: (
    tool: "pen" | "pencil" | "highlighter",
    index: number,
  ) => void;
  updateColorProfile: (
    tool: "pen" | "pencil" | "highlighter",
    index: number,
    color: string,
  ) => void;
  addColorProfile: (
    tool: "pen" | "pencil" | "highlighter",
    color: string,
  ) => void;
  removeColorProfile: (
    tool: "pen" | "pencil" | "highlighter",
    index: number,
  ) => void;
  setThicknessProfile: (
    tool: "pen" | "pencil" | "highlighter",
    index: number,
  ) => void;
  updateThicknessProfile: (
    tool: "pen" | "pencil" | "highlighter",
    index: number,
    value: number,
  ) => void;
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
    const s = get();
    const patch: Partial<ToolState> = {
      tool,
      selectedObjectId: tool === "pan" ? s.selectedObjectId : null,
    };
    if (tool === "highlighter") {
      const tIdx = s.highlighterThicknessIndex ?? 1;
      const w = (s.highlighterThicknessProfiles ?? [2, 4, 8])[tIdx];
      patch.highlighterWidth = w;
      patch.width = w;

      const cIdx = s.highlighterColorIndex ?? 0;
      const c =
        (s.highlighterColorProfiles ?? ["#ffe838", "#51cf66", "#ff6b81"])[cIdx]
          ?? "#ffe838";
      patch.highlighterColor = c;
      patch.color = c;
    } else if (tool === "pen") {
      const tIdx = s.penThicknessIndex ?? 1;
      patch.width = (s.penThicknessProfiles ?? [1.5, 3, 6])[tIdx];

      const cIdx = s.penColorIndex ?? 0;
      const c = (s.penColorProfiles ?? ["#1b1b1f", "#2b6de9", "#d93025"])[cIdx]
        ?? "#1b1b1f";
      patch.color = c;
    } else if (tool === "pencil") {
      const tIdx = s.pencilThicknessIndex ?? 1;
      patch.width = (s.pencilThicknessProfiles ?? [1.5, 2.5, 4.5])[tIdx];

      const cIdx = s.pencilColorIndex ?? 0;
      const c =
        (s.pencilColorProfiles ?? ["#1b1b1f", "#5f6368", "#c62828"])[cIdx]
          ?? (s.pencilColor ?? "#1b1b1f");
      patch.pencilColor = c;
      patch.color = c;
    }
    set(patch);
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
  setColor: (color) => {
    const s = get();
    if (s.tool === "highlighter") {
      const profiles = [
        ...(s.highlighterColorProfiles ?? ["#ffe838", "#51cf66", "#ff6b81"]),
      ];
      const idx = s.highlighterColorIndex ?? 0;
      if (profiles[idx]) profiles[idx] = color;
      set({
        color,
        colorExplicit: true,
        highlighterColor: color,
        highlighterColorProfiles: profiles,
      });
    } else if (s.tool === "pencil") {
      const profiles = [
        ...(s.pencilColorProfiles ?? ["#1b1b1f", "#5f6368", "#c62828"]),
      ];
      const idx = s.pencilColorIndex ?? 0;
      if (profiles[idx]) profiles[idx] = color;
      set({
        color,
        colorExplicit: true,
        pencilColor: color,
        pencilColorProfiles: profiles,
      });
    } else {
      const profiles = [
        ...(s.penColorProfiles ?? ["#1b1b1f", "#2b6de9", "#d93025"]),
      ];
      const idx = s.penColorIndex ?? 0;
      if (profiles[idx]) profiles[idx] = color;
      set({
        color,
        colorExplicit: true,
        penColorProfiles: profiles,
      });
    }
  },
  setPencilColor: (pencilColor) => {
    const s = get();
    const profiles = [
      ...(s.pencilColorProfiles ?? ["#1b1b1f", "#5f6368", "#c62828"]),
    ];
    const idx = s.pencilColorIndex ?? 0;
    if (profiles[idx]) profiles[idx] = pencilColor;
    set({
      pencilColor,
      color: pencilColor,
      colorExplicit: true,
      pencilColorProfiles: profiles,
    });
  },
  setWidth: (width) => {
    if (get().tool === "highlighter") {
      set({ width, highlighterWidth: width });
    } else {
      set({ width });
    }
  },
  setHighlighterColor: (highlighterColor) => {
    const s = get();
    const profiles = [
      ...(s.highlighterColorProfiles ?? ["#ffe838", "#51cf66", "#ff6b81"]),
    ];
    const idx = s.highlighterColorIndex ?? 0;
    if (profiles[idx]) profiles[idx] = highlighterColor;
    set({
      highlighterColor,
      color: highlighterColor,
      highlighterColorProfiles: profiles,
    });
  },
  setHighlighterWidth: (highlighterWidth) =>
    set({ highlighterWidth, width: highlighterWidth }),
  setColorProfile: (toolName, index) => {
    const s = get();
    if (toolName === "highlighter") {
      const profiles = s.highlighterColorProfiles
        ?? ["#ffe838", "#51cf66", "#ff6b81"];
      const c = profiles[index] ?? profiles[0];
      set({
        highlighterColorIndex: index,
        highlighterColor: c,
        color: c,
      });
    } else if (toolName === "pencil") {
      const profiles = s.pencilColorProfiles
        ?? ["#1b1b1f", "#5f6368", "#c62828"];
      const c = profiles[index] ?? profiles[0];
      set({
        pencilColorIndex: index,
        pencilColor: c,
        color: c,
        colorExplicit: true,
      });
    } else {
      const profiles = s.penColorProfiles ?? ["#1b1b1f", "#2b6de9", "#d93025"];
      const c = profiles[index] ?? profiles[0];
      set({
        penColorIndex: index,
        color: c,
        colorExplicit: true,
      });
    }
  },
  updateColorProfile: (toolName, index, color) => {
    const s = get();
    if (toolName === "highlighter") {
      const profiles = [
        ...(s.highlighterColorProfiles ?? ["#ffe838", "#51cf66", "#ff6b81"]),
      ];
      profiles[index] = color;
      set({
        highlighterColorProfiles: profiles,
        highlighterColorIndex: index,
        highlighterColor: color,
        color,
      });
    } else if (toolName === "pencil") {
      const profiles = [
        ...(s.pencilColorProfiles ?? ["#1b1b1f", "#5f6368", "#c62828"]),
      ];
      profiles[index] = color;
      set({
        pencilColorProfiles: profiles,
        pencilColorIndex: index,
        pencilColor: color,
        color,
        colorExplicit: true,
      });
    } else {
      const profiles = [
        ...(s.penColorProfiles ?? ["#1b1b1f", "#2b6de9", "#d93025"]),
      ];
      profiles[index] = color;
      set({
        penColorProfiles: profiles,
        penColorIndex: index,
        color,
        colorExplicit: true,
      });
    }
  },
  addColorProfile: (toolName, color) => {
    const s = get();
    if (toolName === "highlighter") {
      const profiles = [
        ...(s.highlighterColorProfiles ?? ["#ffe838", "#51cf66", "#ff6b81"]),
        color,
      ];
      const newIdx = profiles.length - 1;
      set({
        highlighterColorProfiles: profiles,
        highlighterColorIndex: newIdx,
        highlighterColor: color,
        color,
      });
    } else if (toolName === "pencil") {
      const profiles = [
        ...(s.pencilColorProfiles ?? ["#1b1b1f", "#5f6368", "#c62828"]),
        color,
      ];
      const newIdx = profiles.length - 1;
      set({
        pencilColorProfiles: profiles,
        pencilColorIndex: newIdx,
        pencilColor: color,
        color,
        colorExplicit: true,
      });
    } else {
      const profiles = [
        ...(s.penColorProfiles ?? ["#1b1b1f", "#2b6de9", "#d93025"]),
        color,
      ];
      const newIdx = profiles.length - 1;
      set({
        penColorProfiles: profiles,
        penColorIndex: newIdx,
        color,
        colorExplicit: true,
      });
    }
  },
  removeColorProfile: (toolName, index) => {
    const s = get();
    if (toolName === "highlighter") {
      const profiles = [
        ...(s.highlighterColorProfiles ?? ["#ffe838", "#51cf66", "#ff6b81"]),
      ];
      if (profiles.length <= 1) return;
      profiles.splice(index, 1);
      const curIdx = s.highlighterColorIndex ?? 0;
      const nextIdx = curIdx >= profiles.length
        ? profiles.length - 1
        : (curIdx === index
          ? Math.max(0, index - 1)
          : (curIdx > index ? curIdx - 1 : curIdx));
      const nextColor = profiles[nextIdx];
      set({
        highlighterColorProfiles: profiles,
        highlighterColorIndex: nextIdx,
        highlighterColor: nextColor,
        color: nextColor,
      });
    } else if (toolName === "pencil") {
      const profiles = [
        ...(s.pencilColorProfiles ?? ["#1b1b1f", "#5f6368", "#c62828"]),
      ];
      if (profiles.length <= 1) return;
      profiles.splice(index, 1);
      const curIdx = s.pencilColorIndex ?? 0;
      const nextIdx = curIdx >= profiles.length
        ? profiles.length - 1
        : (curIdx === index
          ? Math.max(0, index - 1)
          : (curIdx > index ? curIdx - 1 : curIdx));
      const nextColor = profiles[nextIdx];
      set({
        pencilColorProfiles: profiles,
        pencilColorIndex: nextIdx,
        pencilColor: nextColor,
        color: nextColor,
      });
    } else {
      const profiles = [
        ...(s.penColorProfiles ?? ["#1b1b1f", "#2b6de9", "#d93025"]),
      ];
      if (profiles.length <= 1) return;
      profiles.splice(index, 1);
      const curIdx = s.penColorIndex ?? 0;
      const nextIdx = curIdx >= profiles.length
        ? profiles.length - 1
        : (curIdx === index
          ? Math.max(0, index - 1)
          : (curIdx > index ? curIdx - 1 : curIdx));
      const nextColor = profiles[nextIdx];
      set({
        penColorProfiles: profiles,
        penColorIndex: nextIdx,
        color: nextColor,
      });
    }
  },
  setThicknessProfile: (toolName, index) => {
    const s = get();
    if (toolName === "highlighter") {
      const profiles = s.highlighterThicknessProfiles ?? [2, 4, 8];
      const w = profiles[index];
      set({
        highlighterThicknessIndex: index,
        highlighterWidth: w,
        width: w,
      });
    } else if (toolName === "pencil") {
      const profiles = s.pencilThicknessProfiles ?? [1.5, 2.5, 4.5];
      const w = profiles[index];
      set({ pencilThicknessIndex: index, width: w });
    } else {
      const profiles = s.penThicknessProfiles ?? [1.5, 3, 6];
      const w = profiles[index];
      set({ penThicknessIndex: index, width: w });
    }
  },
  updateThicknessProfile: (toolName, index, value) => {
    const s = get();
    if (toolName === "highlighter") {
      const profiles = [
        ...(s.highlighterThicknessProfiles ?? [2, 4, 8]),
      ] as [number, number, number];
      profiles[index] = value;
      set({
        highlighterThicknessProfiles: profiles,
        highlighterThicknessIndex: index,
        highlighterWidth: value,
        width: value,
      });
    } else if (toolName === "pencil") {
      const profiles = [
        ...(s.pencilThicknessProfiles ?? [1.5, 2.5, 4.5]),
      ] as [number, number, number];
      profiles[index] = value;
      set({
        pencilThicknessProfiles: profiles,
        pencilThicknessIndex: index,
        width: value,
      });
    } else {
      const profiles = [
        ...(s.penThicknessProfiles ?? [1.5, 3, 6]),
      ] as [number, number, number];
      profiles[index] = value;
      set({
        penThicknessProfiles: profiles,
        penThicknessIndex: index,
        width: value,
      });
    }
  },
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
