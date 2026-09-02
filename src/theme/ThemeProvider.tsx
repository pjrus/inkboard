import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_THEME_PREFERENCE,
  loadThemePreference,
  onSystemThemeChange,
  resolveTheme,
  saveThemePreference,
  systemTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "./themePreferences";

interface ThemeContextValue {
  preference: ThemePreference;
  theme: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  preference: DEFAULT_THEME_PREFERENCE,
  theme: "light",
  setPreference: () => {},
});

const META_THEME_COLOR: Record<ResolvedTheme, string> = { light: "#f3f1ec", dark: "#1c1d21" };

/**
 * Applies the resolved theme as `data-theme` on <html>, which flips the CSS
 * variable block in styles.css. Switching theme touches one attribute; no
 * document state is rewritten and no object is re-created.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(DEFAULT_THEME_PREFERENCE);
  const [system, setSystem] = useState<ResolvedTheme>(() => systemTheme());

  useEffect(() => {
    let cancelled = false;
    void loadThemePreference().then((p) => {
      if (!cancelled) setPreferenceState(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => onSystemThemeChange(setSystem), []);

  const theme: ResolvedTheme = preference === "system" ? system : resolveTheme(preference);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META_THEME_COLOR[theme]);
  }, [theme]);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    void saveThemePreference(p);
  }, []);

  const value = useMemo(() => ({ preference, theme, setPreference }), [preference, theme, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
