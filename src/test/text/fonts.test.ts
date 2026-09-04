import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { describe, expect, it } from "vitest";
import {
  canvasFont,
  DEFAULT_FONT,
  FONTS,
  fontStack,
  getFont,
} from "../../text/fonts";

/**
 * The registry bakes in each family's vertical metrics so the canvas and the
 * PDF exporter agree on baselines without asking a text engine. These tests
 * hold those constants to the actual bundled font files, so a font upgrade
 * that shifts metrics fails here rather than silently misplacing text.
 */
const FILE: Record<string, string> = {
  "open-sans":
    "node_modules/@fontsource/open-sans/files/open-sans-latin-400-normal.woff",
  inter: "node_modules/@fontsource/inter/files/inter-latin-400-normal.woff",
  roboto: "node_modules/@fontsource/roboto/files/roboto-latin-400-normal.woff",
  lato: "node_modules/@fontsource/lato/files/lato-latin-400-normal.woff",
};

describe("bundled fonts", () => {
  it("offers a small curated set with Open Sans as the default", () => {
    expect(FONTS.map((f) => f.id)).toEqual([
      "open-sans",
      "inter",
      "roboto",
      "lato",
    ]);
    expect(DEFAULT_FONT.id).toBe("open-sans");
  });

  it("always has a fallback so text can never be invisible", () => {
    for (const f of FONTS) {
      expect(f.stack).toContain(`"${f.cssFamily}"`);
      expect(f.stack).toMatch(/sans-serif$/);
    }
    expect(canvasFont("open-sans", 24)).toBe(`24px ${fontStack("open-sans")}`);
  });

  it("falls back rather than throwing on an unknown family id", () => {
    expect(getFont("not-a-font").id).toBe("open-sans");
    expect(getFont(undefined).id).toBe("open-sans");
  });

  it("records each family's real ascent and descent", () => {
    for (const f of FONTS) {
      const font = fontkit.create(readFileSync(FILE[f.id]));
      expect(f.ascent).toBeCloseTo(font.ascent / font.unitsPerEm, 3);
      expect(f.descent).toBeCloseTo(font.descent / font.unitsPerEm, 3);
      expect(font.familyName).toBe(f.cssFamily);
    }
  });

  it("ships every family in a form the PDF exporter can embed", async () => {
    const { PDFDocument } = await import("pdf-lib");
    for (const f of FONTS) {
      const pdf = await PDFDocument.create();
      pdf.registerFontkit(fontkit);
      const embedded = await pdf.embedFont(readFileSync(FILE[f.id]), {
        subset: true,
      });
      expect(
        embedded.widthOfTextAtSize("Sphinx of black quartz", 20),
      ).toBeGreaterThan(0);
    }
  });
});
