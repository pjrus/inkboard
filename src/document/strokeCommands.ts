import { MAX_STROKE_WIDTH, MIN_STROKE_WIDTH } from "./schema";

/**
 * Shared thickness scale for pen presets and the +/- selection controls, so
 * there is exactly one notion of "the next thicker stroke" in the app.
 */
export const THICKNESS_STEPS = [1, 1.5, 2.5, 4, 7, 12, 18, 26, 40];

export function clampWidth(w: number): number {
  return Math.min(MAX_STROKE_WIDTH, Math.max(MIN_STROKE_WIDTH, w));
}

/** Next step above (direction 1) or below (-1) the given width, relative to it. */
export function nextWidthStep(width: number, direction: 1 | -1): number {
  const eps = 1e-6;
  if (direction === 1) {
    const next = THICKNESS_STEPS.find((s) => s > width + eps);
    return clampWidth(next ?? MAX_STROKE_WIDTH);
  }
  let prev: number | undefined;
  for (const s of THICKNESS_STEPS) if (s < width - eps) prev = s;
  return clampWidth(prev ?? MIN_STROKE_WIDTH);
}

/** Summarise a set of values as a single value or "mixed". */
export function summarise<T>(values: T[]): { value: T | null; mixed: boolean } {
  if (values.length === 0) return { value: null, mixed: false };
  const first = values[0];
  const mixed = values.some((v) => v !== first);
  return { value: mixed ? null : first, mixed };
}
