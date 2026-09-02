import { useTheme } from "../theme/ThemeProvider";
import type { ThemePreference } from "../theme/themePreferences";
import { MoonIcon, SunIcon, SystemIcon } from "./icons";

const OPTIONS: { value: ThemePreference; label: string; icon: () => JSX.Element }[] = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: SystemIcon },
];

/**
 * Appearance control. Lives in the overflow menu rather than the drawing
 * toolbar: it is a preference, not a tool.
 */
export function ThemeSelector() {
  const { preference, theme, setPreference } = useTheme();
  return (
    <div className="menu-section">
      <div className="menu-label" id="appearance-label">
        Appearance
      </div>
      <div className="segmented segmented-wide" role="radiogroup" aria-labelledby="appearance-label">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={preference === o.value}
            className={preference === o.value ? "active" : ""}
            onClick={() => setPreference(o.value)}
          >
            <o.icon />
            <span>{o.label}</span>
          </button>
        ))}
      </div>
      {preference === "system" && (
        <p className="menu-hint" aria-live="polite">
          Following this device: {theme}
        </p>
      )}
    </div>
  );
}
