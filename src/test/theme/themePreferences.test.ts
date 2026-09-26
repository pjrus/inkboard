import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { CanvasDocument } from "../../document/crdt";
import { type CanvasObject, DEFAULT_TEXT_WIDTH } from "../../document/schema";
import { InkboardDB, setDB } from "../../storage/db";
import {
  canvasTheme,
  DEFAULT_BACKGROUND,
  legacyBackground,
} from "../../theme/canvasTheme";
import {
  DEFAULT_THEME_PREFERENCE,
  loadThemePreference,
  saveThemePreference,
} from "../../theme/themePreferences";

let counter = 0;
beforeEach(() => {
  setDB(new InkboardDB(`theme-test-${Date.now()}-${counter++}`));
  // Node has no Storage by default; a minimal stand-in is enough here.
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
});

describe("theme preference", () => {
  it("defaults to following the system", async () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe("system");
    expect(loadThemePreference()).toBe("system");
  });

  it("persists locally across sessions", () => {
    saveThemePreference("dark");
    expect(loadThemePreference()).toBe("dark");
    saveThemePreference("light");
    expect(loadThemePreference()).toBe("light");
  });

  it("ignores a corrupted stored value instead of breaking the app", () => {
    localStorage.setItem("inkboard.theme", "chartreuse");
    expect(loadThemePreference()).toBe("system");
  });

  it("is never written into the shared document", async () => {
    const doc = new CanvasDocument();
    doc.addText({
      x: 0,
      y: 0,
      width: DEFAULT_TEXT_WIDTH,
      text: "note",
      fontFamily: "open-sans",
      fontSize: 20,
      color: "#1b1b1f",
    });
    saveThemePreference("dark");
    const json = JSON.stringify(doc.ydoc.toJSON());
    expect(json).not.toContain("theme");
    expect(json).not.toContain("dark");
  });
});

describe("canvas theme", () => {
  const PAPER = "#f3f1ec";
  const CHARCOAL = "#1c1d21";

  it("keeps imported pages looking like paper on every background", () => {
    // A dark board must never invert or recolour a source PDF page.
    expect(canvasTheme(PAPER).pageFill).toBe("#ffffff");
    expect(canvasTheme(CHARCOAL).pageFill).toBe("#ffffff");
    // A white page on a dark board needs its own edge to read as a page.
    expect(canvasTheme(CHARCOAL).pageBorder).not.toBe(
      canvasTheme(PAPER).pageBorder,
    );
  });

  it("paints the board's own colour and gives new ink contrast with it", () => {
    expect(canvasTheme(PAPER).background).toBe(PAPER);
    expect(canvasTheme(PAPER).defaultInk).toBe("#1b1b1f");
    expect(canvasTheme(CHARCOAL).defaultInk).toBe("#f2f1ee");
    expect(canvasTheme("#233a30").defaultInk).toBe("#f2f1ee");
  });

  it("gives an old board the background its ink was drawn on", () => {
    const ink = (color: string) => ({ type: "stroke", color }) as CanvasObject;
    expect(legacyBackground([])).toBe(DEFAULT_BACKGROUND);
    expect(legacyBackground([ink("#1b1b1f"), ink("#d93025")])).toBe(
      DEFAULT_BACKGROUND,
    );
    // Drawn in dark mode, where default ink was light.
    expect(legacyBackground([ink("#f2f1ee"), ink("#f2f1ee"), ink("#1b1b1f")]))
      .toBe(CHARCOAL);
  });
});

describe("board background", () => {
  it("is undoable when picked, but a legacy board's is not", () => {
    const doc = new CanvasDocument();
    doc.ensureBackground();
    expect(doc.getBackground()).toBe(DEFAULT_BACKGROUND);
    expect(doc.canUndo()).toBe(false);

    doc.setBackground("#233a30");
    expect(doc.getBackground()).toBe("#233a30");
    doc.undo();
    expect(doc.getBackground()).toBe(DEFAULT_BACKGROUND);

    // Never overwrites a background the board already has.
    doc.setBackground("#ffffff");
    doc.ensureBackground();
    expect(doc.getBackground()).toBe("#ffffff");
  });
});
