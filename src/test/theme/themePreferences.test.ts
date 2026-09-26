import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { CanvasDocument } from "../../document/crdt";
import { DEFAULT_TEXT_WIDTH } from "../../document/schema";
import { InkboardDB, setDB } from "../../storage/db";
import { canvasTheme } from "../../theme/canvasTheme";
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
  it("keeps imported pages looking like paper in both themes", () => {
    // Dark mode must never invert or recolour a source PDF page.
    expect(canvasTheme("light").pageFill).toBe("#ffffff");
    expect(canvasTheme("dark").pageFill).toBe("#ffffff");
    // A white page on a dark canvas needs its own edge to read as a page.
    expect(canvasTheme("dark").pageBorder).not.toBe(
      canvasTheme("light").pageBorder,
    );
  });

  it("gives new content light ink on dark and dark ink on light", () => {
    expect(canvasTheme("light").defaultInk).toBe("#1b1b1f");
    expect(canvasTheme("dark").defaultInk).toBe("#f2f1ee");
    expect(canvasTheme("dark").background).not.toBe(
      canvasTheme("light").background,
    );
  });
});
