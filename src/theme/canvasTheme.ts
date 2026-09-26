import type { CanvasObject } from "../document/schema";

/**
 * Colours the 2D canvas needs, chosen by the board's background colour.
 *
 * The app theme (light/dark) only restyles the DOM chrome through the CSS
 * variables in styles.css. The canvas is the board itself: it looks the same
 * in both themes, and PDF export fills the page with the same background. So
 * everything drawn on it - selection, handles, the eraser, default ink - is
 * picked for contrast with the board's colour, never with the app theme.
 *
 * Only the background is document content (see CanvasDocument). Imported PDF
 * pages keep their own appearance, and drawn ink keeps the colour it was
 * drawn with.
 */
export interface CanvasTheme {
  background: string;
  /** Paper stays paper-coloured in dark mode; PDFs are never recoloured. */
  pageFill: string;
  pageBorder: string;
  pageShadow: string;
  pagePlaceholderText: string;
  accent: string;
  selectionHalo: string;
  selectionFill: string;
  handleFill: string;
  handleStroke: string;
  eraserFill: string;
  eraserStroke: string;
  /** Ink colour a *new* stroke or text box defaults to on this theme. */
  defaultInk: string;
}

/** Colours a board background can be. Plain fills only. */
export const BACKGROUNDS = [
  { name: "Paper", value: "#f3f1ec" },
  { name: "White", value: "#ffffff" },
  { name: "Yellow", value: "#fbf3d0" },
  { name: "Grey", value: "#dcdde1" },
  { name: "Charcoal", value: "#1c1d21" },
  { name: "Chalkboard", value: "#233a30" },
];

export const DEFAULT_BACKGROUND = BACKGROUNDS[0].value;
/** What dark mode painted every board before boards had a background. */
const LEGACY_DARK_BACKGROUND = "#1c1d21";

const LIGHT: Omit<CanvasTheme, "background"> = {
  pageFill: "#ffffff",
  pageBorder: "rgba(0,0,0,0.12)",
  pageShadow: "rgba(20,16,8,0.10)",
  pagePlaceholderText: "rgba(0,0,0,0.35)",
  accent: "#2b6de9",
  selectionHalo: "rgba(43,109,233,0.35)",
  selectionFill: "rgba(43,109,233,0.08)",
  handleFill: "#ffffff",
  handleStroke: "#2b6de9",
  eraserFill: "rgba(255,255,255,0.6)",
  eraserStroke: "rgba(0,0,0,0.5)",
  defaultInk: "#1b1b1f",
};

const DARK: Omit<CanvasTheme, "background"> = {
  pageFill: "#ffffff",
  // A light rim plus a deeper shadow keeps a white page legible as a page
  // rather than a glowing rectangle.
  pageBorder: "rgba(255,255,255,0.22)",
  pageShadow: "rgba(0,0,0,0.55)",
  pagePlaceholderText: "rgba(0,0,0,0.4)",
  accent: "#6ea0ff",
  selectionHalo: "rgba(110,160,255,0.38)",
  selectionFill: "rgba(110,160,255,0.12)",
  handleFill: "#1c1d21",
  handleStroke: "#6ea0ff",
  eraserFill: "rgba(255,255,255,0.16)",
  eraserStroke: "rgba(255,255,255,0.7)",
  defaultInk: "#f2f1ee",
};

export function canvasTheme(background: string): CanvasTheme {
  return { ...(isDark(background) ? DARK : LIGHT), background };
}

/** For `#rrggbb` colours, which is all the pickers produce. */
export function isDark(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 128;
}

/**
 * Background for a board saved before boards had one. Its default ink
 * followed the app theme, so mostly light ink means it was drawn in dark mode
 * and needs the dark background it was drawn on to stay readable.
 */
export function legacyBackground(objects: CanvasObject[]): string {
  let light = 0;
  let dark = 0;
  for (const o of objects) {
    if (o.type === "image") continue;
    if (isDark(o.color)) dark++;
    else light++;
  }
  return light > dark ? LEGACY_DARK_BACKGROUND : DEFAULT_BACKGROUND;
}
