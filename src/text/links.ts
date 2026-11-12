import type { Measure, TextLayoutResult } from "./textLayout";

/**
 * URL detection and link-span layout for text boxes.
 *
 * Detection runs on the raw text so URLs that wrap across multiple lines
 * still resolve to their full target, and span geometry is computed from the
 * same `TextLayoutResult` and `Measure` function the renderer uses.
 */

export interface LinkMatch {
  start: number;
  end: number;
  text: string;
  url: string;
}

export interface LinkSpan {
  url: string;
  /** Offset from the left edge of the text box. */
  x: number;
  /** Top of the line box relative to the top of the text box. */
  y: number;
  width: number;
  height: number;
  /** Baseline offset from the top of the text box. */
  baseline: number;
}

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?'"]$/;

function hasScheme(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

function countChar(s: string, ch: string): number {
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ch) count++;
  }
  return count;
}

/**
 * Strip trailing prose punctuation (periods, commas, unmatched brackets) from a
 * matched URL while keeping balanced parentheses such as Wikipedia links.
 */
function trimTrailingPunctuation(raw: string): string {
  let s = raw;
  while (s.length > 0) {
    if (TRAILING_PUNCTUATION.test(s)) {
      s = s.slice(0, -1);
      continue;
    }
    if (s.endsWith(")") && countChar(s, ")") > countChar(s, "(")) {
      s = s.slice(0, -1);
      continue;
    }
    if (s.endsWith("]") && countChar(s, "]") > countChar(s, "[")) {
      s = s.slice(0, -1);
      continue;
    }
    break;
  }
  return s;
}

function normalizeUrl(raw: string): string | null {
  const candidate = hasScheme(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname) return null;
    if (!hasScheme(raw) && !parsed.hostname.includes(".")) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/** Quick pre-check to skip full regex matching when text cannot contain a URL. */
export function mayContainUrl(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("http://") || lower.includes("https://")
    || lower.includes("www.");
}

/** Find all valid HTTP(S) and `www.` URLs in `text`. */
export function findLinks(text: string): LinkMatch[] {
  if (!mayContainUrl(text)) return [];
  const matches: LinkMatch[] = [];
  URL_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_PATTERN.exec(text)) !== null) {
    const cleaned = trimTrailingPunctuation(m[0]);
    if (!cleaned) continue;
    const url = normalizeUrl(cleaned);
    if (!url) continue;
    matches.push({
      start: m.index,
      end: m.index + cleaned.length,
      text: cleaned,
      url,
    });
  }
  return matches;
}

/**
 * Map detected URLs onto wrapped `LineBox`es to produce clickable/drawable
 * spans in text-box coordinates.
 */
export function layoutLinks(
  text: string,
  layout: TextLayoutResult,
  measure: Measure,
): LinkSpan[] {
  const links = findLinks(text);
  if (links.length === 0) return [];

  const spans: LinkSpan[] = [];
  let cursor = 0;

  for (let i = 0; i < layout.lines.length; i++) {
    const line = layout.lines[i];
    if (line.text === "") continue;
    const lineStart = text.indexOf(line.text, cursor);
    if (lineStart === -1) continue;
    const lineEnd = lineStart + line.text.length;
    cursor = lineEnd;

    for (const link of links) {
      if (link.end <= lineStart || link.start >= lineEnd) continue;
      const segStart = Math.max(link.start, lineStart) - lineStart;
      const segEnd = Math.min(link.end, lineEnd) - lineStart;
      const prefix = line.text.slice(0, segStart);
      const segment = line.text.slice(segStart, segEnd);
      const offsetX = prefix === "" ? 0 : measure(prefix);
      const width = measure(segment);
      if (width <= 0) continue;
      spans.push({
        url: link.url,
        x: line.x + offsetX,
        y: i * layout.lineHeight,
        width,
        height: layout.lineHeight,
        baseline: line.baseline,
      });
    }
  }

  return spans;
}
