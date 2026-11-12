import { describe, expect, it } from "vitest";
import { findLinks, layoutLinks } from "../../text/links";
import { layoutText } from "../../text/textLayout";

/** A predictable measurer: every character is half the font size wide. */
const measure = (size: number) => (t: string) => t.length * size * 0.5;

describe("findLinks", () => {
  it("detects http and https URLs", () => {
    const links = findLinks(
      "Visit https://example.com/path?a=1#b or http://localhost:3000.",
    );
    expect(links).toEqual([
      {
        start: 6,
        end: 36,
        text: "https://example.com/path?a=1#b",
        url: "https://example.com/path?a=1#b",
      },
      {
        start: 40,
        end: 61,
        text: "http://localhost:3000",
        url: "http://localhost:3000/",
      },
    ]);
  });

  it("detects www. URLs and normalizes them to https", () => {
    const links = findLinks("See www.example.com/docs for details.");
    expect(links).toEqual([
      {
        start: 4,
        end: 24,
        text: "www.example.com/docs",
        url: "https://www.example.com/docs",
      },
    ]);
  });

  it("strips trailing prose punctuation while keeping balanced parentheses", () => {
    const links = findLinks(
      "(https://en.wikipedia.org/wiki/Foo_(bar)), and https://example.com!",
    );
    expect(links.map((l) => l.text)).toEqual([
      "https://en.wikipedia.org/wiki/Foo_(bar)",
      "https://example.com",
    ]);
  });

  it("ignores incomplete or invalid URLs", () => {
    expect(findLinks("just https:// or www. nothing")).toEqual([]);
  });
});

describe("layoutLinks", () => {
  it("computes span position and width on a line", () => {
    const m = measure(20); // 10 units per char
    const text = "Go https://a.co now";
    const layout = layoutText(
      text,
      { width: 500, fontSize: 20, fontFamily: "open-sans", align: "left" },
      m,
    );
    const spans = layoutLinks(text, layout, m);
    expect(spans).toHaveLength(1);
    expect(spans[0].x).toBe(30); // "Go " = 3 chars * 10
    expect(spans[0].width).toBe(120); // "https://a.co" = 12 chars * 10
    expect(spans[0].url).toBe("https://a.co/");
  });

  it("respects center alignment", () => {
    const m = measure(20);
    const text = "https://a.co"; // width 120
    const layout = layoutText(
      text,
      { width: 200, fontSize: 20, fontFamily: "open-sans", align: "center" },
      m,
    );
    const spans = layoutLinks(text, layout, m);
    expect(spans).toHaveLength(1);
    expect(spans[0].x).toBe(40);
    expect(spans[0].width).toBe(120);
  });

  it("handles a URL wrapped across multiple lines", () => {
    const m = measure(20); // 10 units per char; box width 100 = 10 chars/line
    const text = "https://example.com/very/long/path";
    const layout = layoutText(
      text,
      { width: 100, fontSize: 20, fontFamily: "open-sans" },
      m,
    );
    expect(layout.lines.length).toBeGreaterThan(1);
    const spans = layoutLinks(text, layout, m);
    expect(spans).toHaveLength(layout.lines.length);
    for (const span of spans) {
      expect(span.url).toBe("https://example.com/very/long/path");
    }
  });

  it("handles empty lines before a URL", () => {
    const m = measure(20);
    const text = "hello\n\nhttps://a.co";
    const layout = layoutText(
      text,
      { width: 300, fontSize: 20, fontFamily: "open-sans" },
      m,
    );
    const spans = layoutLinks(text, layout, m);
    expect(spans).toHaveLength(1);
    expect(spans[0].y).toBeCloseTo(2 * layout.lineHeight);
    expect(spans[0].url).toBe("https://a.co/");
  });
});
