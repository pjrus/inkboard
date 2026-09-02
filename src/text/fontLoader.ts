import { FONTS } from "./fonts";
import type { FontFamilyId } from "../document/schema";

/**
 * Font loading for a local-first app.
 *
 * The @font-face declarations come from @fontsource, which Vite bundles
 * together with the WOFF2 files, so nothing is fetched from Google Fonts and
 * the app renders its fonts with no network at all. The same families are
 * needed as raw bytes when exporting a PDF; those come from the WOFF (v1)
 * variants, which are what @pdf-lib/fontkit can subset reliably.
 *
 * Canvas text is measured with the real font, so any layout computed before
 * the faces are ready would be wrong. `onFontsReady` lets the renderer drop
 * its measurement cache and repaint once loading finishes.
 */

// Latin subsets, regular weight only: this milestone deliberately has no
// italics, no bold and no extra weights (see README). Adding one means adding
// its @fontsource CSS and .woff here and a weight to the two maps below.
import "@fontsource/open-sans/latin-400.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/roboto/latin-400.css";
import "@fontsource/lato/latin-400.css";

// WOFF (v1) copies for PDF embedding. Vite turns these into asset URLs that
// are part of the build output, so export works offline too. WOFF rather than
// WOFF2 because it is what @pdf-lib/fontkit subsets reliably.
import openSansRegular from "@fontsource/open-sans/files/open-sans-latin-400-normal.woff?url";
import interRegular from "@fontsource/inter/files/inter-latin-400-normal.woff?url";
import robotoRegular from "@fontsource/roboto/files/roboto-latin-400-normal.woff?url";
import latoRegular from "@fontsource/lato/files/lato-latin-400-normal.woff?url";

const FILES: Record<FontFamilyId, string> = {
  "open-sans": openSansRegular,
  inter: interRegular,
  roboto: robotoRegular,
  lato: latoRegular,
};

let ready = false;
const readyListeners = new Set<() => void>();

/**
 * Ask the browser to load every bundled face, then notify listeners.
 * Safe to call more than once; resolves immediately where the Font Loading
 * API is unavailable (the CSS still applies, only the repaint hint is lost).
 */
export async function loadFonts(): Promise<void> {
  if (ready) return;
  try {
    if (typeof document !== "undefined" && document.fonts) {
      await Promise.all(FONTS.map((f) => document.fonts.load(`400 16px "${f.cssFamily}"`)));
    }
  } catch (err) {
    // A failed load is not fatal: the CSS fallback stack still renders text.
    console.warn("Some bundled fonts could not be loaded", err);
  }
  ready = true;
  for (const l of readyListeners) l();
}

export function onFontsReady(fn: () => void): () => void {
  if (ready) {
    fn();
    return () => {};
  }
  readyListeners.add(fn);
  return () => readyListeners.delete(fn);
}

const byteCache = new Map<string, Promise<Uint8Array>>();

/** Raw font bytes for PDF embedding. Cached, so repeated exports are cheap. */
export function loadFontBytes(id: FontFamilyId): Promise<Uint8Array> {
  const key = id;
  let p = byteCache.get(key);
  if (!p) {
    const url = FILES[id] ?? FILES["open-sans"];
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load font ${key} (${r.status})`);
        return r.arrayBuffer();
      })
      .then((b) => new Uint8Array(b))
      .catch((err) => {
        byteCache.delete(key);
        throw err;
      });
    byteCache.set(key, p);
  }
  return p;
}
