import { TEXT_LINE_HEIGHT, type TextAlign } from "../document/schema";
import { getFont } from "./fonts";

/**
 * Text wrapping and vertical metrics.
 *
 * Pure functions with an injected width measurer, so the canvas renderer can
 * measure with the browser's text engine and the PDF exporter can measure with
 * the embedded font's own metrics while both run the exact same algorithm.
 * That is what keeps an exported PDF wrapping where the canvas wrapped.
 */

/** Width of a run of text at a given size, in the same units as the size. */
export type Measure = (text: string) => number;

export interface LineBox {
  text: string;
  width: number;
  /** Left edge of the line relative to the box's left edge (alignment applied). */
  x: number;
  /** Baseline offset from the top of the box. */
  baseline: number;
}

export interface TextLayoutResult {
  lines: LineBox[];
  lineHeight: number;
  /** Total height of the box: one line height per line. */
  height: number;
  /** Widest laid-out line; useful for "shrink to fit" affordances. */
  maxLineWidth: number;
}

export interface LayoutOptions {
  width: number;
  fontSize: number;
  fontFamily: string;
  align?: TextAlign;
}

/**
 * Baseline offset of the first line from the top of the box.
 *
 * The font's own ascent/descent are centred inside the line box, so changing
 * family or size never shifts text out of its box.
 */
export function firstBaseline(fontFamily: string, fontSize: number): number {
  const f = getFont(fontFamily);
  const lineHeight = fontSize * TEXT_LINE_HEIGHT;
  const content = (f.ascent - f.descent) * fontSize;
  return (lineHeight - content) / 2 + f.ascent * fontSize;
}

export function lineHeightFor(fontSize: number): number {
  return fontSize * TEXT_LINE_HEIGHT;
}

/**
 * Greedy word wrap. Explicit newlines always break; words longer than the box
 * are split by character so nothing ever overflows horizontally.
 */
export function wrapLines(text: string, width: number, measure: Measure): string[] {
  const out: string[] = [];
  const paragraphs = text.split("\n");
  for (const paragraph of paragraphs) {
    if (paragraph === "") {
      out.push("");
      continue;
    }
    // Keep trailing spaces attached to the word before them so a wrapped line
    // does not start with a space.
    const words = paragraph.match(/\S+\s*/g) ?? [paragraph];
    let line = "";
    for (const word of words) {
      const candidate = line + word;
      if (line !== "" && measure(candidate.trimEnd()) > width) {
        out.push(line.trimEnd());
        line = "";
      }
      if (measure(word.trimEnd()) > width) {
        // A single word wider than the box: break it across lines.
        let chunk = line;
        for (const ch of word) {
          if (chunk !== "" && measure((chunk + ch).trimEnd()) > width) {
            out.push(chunk.trimEnd());
            chunk = "";
          }
          chunk += ch;
        }
        line = chunk;
      } else {
        line += word;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

export function layoutText(text: string, opts: LayoutOptions, measure: Measure): TextLayoutResult {
  const { width, fontSize, fontFamily } = opts;
  const align = opts.align ?? "left";
  const lineHeight = lineHeightFor(fontSize);
  const base = firstBaseline(fontFamily, fontSize);
  const raw = wrapLines(text, width, measure);
  let maxLineWidth = 0;
  const lines: LineBox[] = raw.map((t, i) => {
    const w = t === "" ? 0 : measure(t);
    if (w > maxLineWidth) maxLineWidth = w;
    return {
      text: t,
      width: w,
      x: align === "center" ? (width - w) / 2 : align === "right" ? width - w : 0,
      baseline: base + i * lineHeight,
    };
  });
  return { lines, lineHeight, height: Math.max(1, lines.length) * lineHeight, maxLineWidth };
}
