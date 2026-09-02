import type { ResolvedTheme } from "./themePreferences";

/**
 * Colours the 2D canvas needs. The DOM chrome themes itself from the CSS
 * variables in styles.css; a <canvas> cannot, so the same palette is mirrored
 * here and handed to the renderer.
 *
 * Only *presentation* lives in this file. Nothing here is ever written into a
 * document: imported PDF pages keep their own appearance in both themes, and
 * ink the user has already drawn keeps the colour it was drawn with.
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

const LIGHT: CanvasTheme = {
  background: "#f3f1ec",
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

const DARK: CanvasTheme = {
  background: "#1c1d21",
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

export function canvasTheme(theme: ResolvedTheme): CanvasTheme {
  return theme === "dark" ? DARK : LIGHT;
}

/** Ink colour new content defaults to before the user has chosen one. */
export function defaultInk(theme: ResolvedTheme): string {
  return canvasTheme(theme).defaultInk;
}
