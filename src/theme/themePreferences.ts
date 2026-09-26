/**
 * Appearance is a *local* preference, not document content: it lives in
 * localStorage and never enters the CRDT, so opening the same
 * board on another device does not drag your theme along with it.
 */

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const KEY = "inkboard.theme";
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

function isPreference(v: unknown): v is ThemePreference {
  return v === "light" || v === "dark" || v === "system";
}

/**
 * Synchronous on purpose: a theme that arrives a frame late visibly flashes
 * the wrong one first. Blocked storage just means "follow the system".
 */
export function loadThemePreference(): ThemePreference {
  try {
    const v = globalThis.localStorage?.getItem(KEY);
    return isPreference(v) ? v : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

// ponytail: blocked localStorage means the choice lasts only this session;
// add an IndexedDB fallback if that ever matters.
export function saveThemePreference(preference: ThemePreference): void {
  try {
    globalThis.localStorage?.setItem(KEY, preference);
  } catch {
    // Private browsing and blocked site data: nothing to persist to.
  }
}

function systemQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  return window.matchMedia("(prefers-color-scheme: dark)");
}

export function systemTheme(): ResolvedTheme {
  return systemQuery()?.matches ? "dark" : "light";
}

/** Watch the OS setting. Only meaningful while the preference is "system". */
export function onSystemThemeChange(
  fn: (theme: ResolvedTheme) => void,
): () => void {
  const q = systemQuery();
  if (!q) return () => {};
  const handler = (e: MediaQueryListEvent) => fn(e.matches ? "dark" : "light");
  q.addEventListener("change", handler);
  return () => q.removeEventListener("change", handler);
}
