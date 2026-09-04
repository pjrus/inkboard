import type { FontFamilyId } from "../document/schema";

/**
 * The curated set of bundled text fonts.
 *
 * All four are permissively licensed (Open Sans, Roboto and Lato are Apache
 * 2.0 / OFL, Inter is OFL) and ship with the app as self-hosted WOFF/WOFF2
 * files from @fontsource, so text renders identically offline and the same
 * bytes can be embedded into an exported PDF.
 *
 * `ascent` / `descent` are the font's own vertical metrics as a fraction of
 * the em. They are baked in here so the canvas renderer and the PDF exporter
 * put baselines in exactly the same place without either having to ask a
 * platform text engine. fonts.test.ts checks them against the real files.
 */
export interface FontDefinition {
  id: FontFamilyId;
  label: string;
  /** The family name as declared by @fontsource's @font-face rules. */
  cssFamily: string;
  /** Full CSS stack, with fallbacks so text is never invisible. */
  stack: string;
  ascent: number;
  descent: number;
}

const FALLBACK = "system-ui, -apple-system, Segoe UI, sans-serif";

export const FONTS: FontDefinition[] = [
  {
    id: "open-sans",
    label: "Open Sans",
    cssFamily: "Open Sans",
    stack: `"Open Sans", ${FALLBACK}`,
    ascent: 1.0688,
    descent: -0.293,
  },
  {
    id: "inter",
    label: "Inter",
    cssFamily: "Inter",
    stack: `"Inter", ${FALLBACK}`,
    ascent: 0.9688,
    descent: -0.2412,
  },
  {
    id: "roboto",
    label: "Roboto",
    cssFamily: "Roboto",
    stack: `"Roboto", ${FALLBACK}`,
    ascent: 0.9277,
    descent: -0.2441,
  },
  {
    id: "lato",
    label: "Lato",
    cssFamily: "Lato",
    stack: `"Lato", ${FALLBACK}`,
    ascent: 0.987,
    descent: -0.213,
  },
];

const BY_ID = new Map(FONTS.map((f) => [f.id, f]));

export const DEFAULT_FONT = FONTS[0];

/** Never throws: an unknown id (older document, future release) falls back. */
export function getFont(id: string | undefined): FontDefinition {
  return (id && BY_ID.get(id as FontFamilyId)) || DEFAULT_FONT;
}

export function fontStack(id: string | undefined): string {
  return getFont(id).stack;
}

/** A CSS `font` shorthand for canvas 2D measurement and drawing. */
export function canvasFont(id: string | undefined, sizePx: number): string {
  return `${sizePx}px ${getFont(id).stack}`;
}
