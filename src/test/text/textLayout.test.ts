import { describe, expect, it } from "vitest";
import { TEXT_LINE_HEIGHT } from "../../document/schema";
import {
  firstBaseline,
  layoutText,
  lineHeightFor,
  wrapLines,
} from "../../text/textLayout";
import { getFont } from "../../text/fonts";

/** A predictable measurer: every character is half the font size wide. */
const measure = (size: number) => (t: string) => t.length * size * 0.5;

describe("text layout", () => {
  it("wraps greedily at word boundaries", () => {
    // 10 units per character at size 20; a 100-unit box holds 10 characters.
    expect(wrapLines("hello world again", 100, measure(20))).toEqual([
      "hello",
      "world",
      "again",
    ]);
    expect(wrapLines("hello world again", 160, measure(20))).toEqual([
      "hello world",
      "again",
    ]);
  });

  it("keeps explicit newlines, including empty ones", () => {
    expect(wrapLines("a\n\nb", 1000, measure(20))).toEqual(["a", "", "b"]);
  });

  it("breaks a word that is wider than the box rather than overflowing", () => {
    const lines = wrapLines("abcdefghijkl", 50, measure(20));
    expect(lines.every((l) => l.length <= 5)).toBe(true);
    expect(lines.join("")).toBe("abcdefghijkl");
  });

  it("never starts a wrapped line with a space", () => {
    for (const line of wrapLines("one two three four five", 120, measure(20))) {
      expect(line.startsWith(" ")).toBe(false);
      expect(line.endsWith(" ")).toBe(false);
    }
  });

  it("height follows the line count, not the box", () => {
    const result = layoutText(
      "hello world again",
      { width: 100, fontSize: 20, fontFamily: "open-sans" },
      measure(20),
    );
    expect(result.lines).toHaveLength(3);
    expect(result.height).toBeCloseTo(3 * lineHeightFor(20));
    expect(lineHeightFor(20)).toBeCloseTo(20 * TEXT_LINE_HEIGHT);
  });

  it("an empty box still occupies one line", () => {
    expect(
      layoutText(
        "",
        { width: 300, fontSize: 20, fontFamily: "open-sans" },
        measure(20),
      ).height,
    ).toBeCloseTo(lineHeightFor(20));
  });

  it("places lines for each alignment", () => {
    const opts = { width: 200, fontSize: 20, fontFamily: "open-sans" as const };
    const left = layoutText("abcd", { ...opts, align: "left" }, measure(20));
    const centre = layoutText(
      "abcd",
      { ...opts, align: "center" },
      measure(20),
    );
    const right = layoutText("abcd", { ...opts, align: "right" }, measure(20));
    expect(left.lines[0].x).toBe(0);
    expect(centre.lines[0].x).toBeCloseTo((200 - 40) / 2);
    expect(right.lines[0].x).toBeCloseTo(200 - 40);
  });

  it("centres the font's own ascent and descent inside the line box", () => {
    const f = getFont("open-sans");
    const size = 20;
    const expected =
      (lineHeightFor(size) - (f.ascent - f.descent) * size) / 2 +
      f.ascent * size;
    expect(firstBaseline("open-sans", size)).toBeCloseTo(expected);
    // Baselines are one line height apart, whatever the family.
    const layout = layoutText(
      "a\nb",
      { width: 500, fontSize: size, fontFamily: "roboto" },
      measure(size),
    );
    expect(layout.lines[1].baseline - layout.lines[0].baseline).toBeCloseTo(
      lineHeightFor(size),
    );
  });

  it("scales with font size, so world-space sizing zooms cleanly", () => {
    const small = layoutText(
      "hello world",
      { width: 100, fontSize: 10, fontFamily: "inter" },
      measure(10),
    );
    const large = layoutText(
      "hello world",
      { width: 200, fontSize: 20, fontFamily: "inter" },
      measure(20),
    );
    expect(large.lines.map((l) => l.text)).toEqual(
      small.lines.map((l) => l.text),
    );
    expect(large.height).toBeCloseTo(small.height * 2);
  });
});
