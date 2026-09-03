import type { LassoFilter } from "../document/schema";
import { useToolStore } from "../store/toolStore";

const TYPES: { key: keyof LassoFilter; label: string; hint: string }[] = [
  { key: "ink", label: "Ink", hint: "Pen and pencil strokes" },
  { key: "text", label: "Text", hint: "Text boxes" },
  { key: "images", label: "Images", hint: "Imported images and PDF pages" },
];

/**
 * What the lasso is allowed to pick up.
 *
 * Independent toggles rather than one mode, because the useful combinations
 * are partial: writing over an imported PDF and wanting the handwriting but
 * not the page under it is the whole reason this control exists.
 *
 * Purely local state - it is a preference about how *this* person selects,
 * so it is persisted next to the other tool preferences and never synced.
 */
export function LassoFilterControls() {
  const filter = useToolStore((s) => s.lassoFilter);
  const toggle = useToolStore((s) => s.toggleLassoFilter);
  return (
    <div className="tb-group lasso-filter">
      <span className="tb-label">Select</span>
      <div className="segmented" role="group" aria-label="Lasso can select">
        {TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={filter[t.key]}
            className={filter[t.key] ? "active" : ""}
            title={`${t.hint}${filter[t.key] ? " (selectable)" : " (ignored)"}`}
            onClick={() => toggle(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
