import { MAX_FONT_SIZE, MIN_FONT_SIZE } from "../document/schema";

/**
 * Shared font-size scale, mirroring strokeCommands.ts for stroke widths, so
 * the preset list and the +/- stepper always agree on "the next size up".
 * Sizes are world-space, like stroke widths.
 */
export const FONT_SIZE_PRESETS = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64];

export function clampFontSize(size: number): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size));
}

/** Next preset above (direction 1) or below (-1) the given size. */
export function nextFontSizeStep(size: number, direction: 1 | -1): number {
  const eps = 1e-6;
  if (direction === 1) {
    const next = FONT_SIZE_PRESETS.find((s) => s > size + eps);
    return clampFontSize(next ?? size * 1.25);
  }
  let prev: number | undefined;
  for (const s of FONT_SIZE_PRESETS) if (s < size - eps) prev = s;
  return clampFontSize(prev ?? size / 1.25);
}
