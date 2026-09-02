import { getDB } from "../storage/db";

/**
 * Appearance is a *local* preference, not document content: it lives in the
 * IndexedDB preferences table and never enters the CRDT, so opening the same
 * board on another device does not drag your theme along with it.
 */

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const KEY = "theme";
/** Mirror of the same value, for the one read that cannot wait. */
const CACHE_KEY = "inkboard.theme";
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

function isPreference(v: unknown): v is ThemePreference {
  return v === "light" || v === "dark" || v === "system";
}

function cache(preference: ThemePreference): void {
  try {
    globalThis.localStorage?.setItem(CACHE_KEY, preference);
  } catch {
    // Private browsing and blocked site data: the IndexedDB copy still works.
  }
}

/**
 * The preference as far as we can tell without waiting.
 *
 * IndexedDB is the record of truth, but reading it is asynchronous, and a
 * theme that arrives a frame late is a theme that visibly flashes the wrong
 * one first. The provider paints from this and reconciles a moment later.
 */
export function cachedThemePreference(): ThemePreference {
  try {
    const v = globalThis.localStorage?.getItem(CACHE_KEY);
    return isPreference(v) ? v : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

export async function loadThemePreference(): Promise<ThemePreference> {
  try {
    const row = await getDB().preferences.get(KEY);
    const preference = isPreference(row?.value) ? row.value : DEFAULT_THEME_PREFERENCE;
    cache(preference);
    return preference;
  } catch {
    // A board can still be used if preferences are unreadable.
    return DEFAULT_THEME_PREFERENCE;
  }
}

export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  cache(preference);
  await getDB().preferences.put({ key: KEY, value: preference });
}

function systemQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  return window.matchMedia("(prefers-color-scheme: dark)");
}

export function systemTheme(): ResolvedTheme {
  return systemQuery()?.matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

/** Watch the OS setting. Only meaningful while the preference is "system". */
export function onSystemThemeChange(fn: (theme: ResolvedTheme) => void): () => void {
  const q = systemQuery();
  if (!q) return () => {};
  const handler = (e: MediaQueryListEvent) => fn(e.matches ? "dark" : "light");
  q.addEventListener("change", handler);
  return () => q.removeEventListener("change", handler);
}
