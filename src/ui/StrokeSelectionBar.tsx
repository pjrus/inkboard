import { summarise } from "../document/strokeCommands";
import { useToolStore } from "../store/toolStore";

function formatWidth(w: number) {
  return Number.isInteger(w) ? String(w) : w.toFixed(1);
}

/** Contextual bar shown while handwriting is lasso-selected. */
export function StrokeSelectionBar() {
  const selection = useToolStore((s) => s.strokeSelection);
  const commands = useToolStore((s) => s.selectionCommands);
  if (!selection || !commands) return null;
  const { value, mixed } = summarise(selection.widths);
  const n = selection.ids.length;
  return (
    <div className="selection-bar" role="toolbar" aria-label="Selected handwriting">
      <span className="selection-title">
        {n} {n === 1 ? "item" : "items"} selected
      </span>
      <div className="stepper" role="group" aria-label="Thickness">
        <button type="button" aria-label="Thinner ([)" title="Thinner ([)" onClick={() => commands.adjustWidth(-1)}>−</button>
        <span className="stepper-value" aria-live="polite">{mixed ? "Mixed" : formatWidth(value ?? 0)}</span>
        <button type="button" aria-label="Thicker (])" title="Thicker (])" onClick={() => commands.adjustWidth(1)}>+</button>
      </div>
      <button type="button" className="btn btn-sm btn-danger" onClick={() => commands.remove()}>
        Delete
      </button>
      <button type="button" className="btn btn-sm btn-ghost" aria-label="Deselect (Esc)" onClick={() => commands.clear()}>
        ✕
      </button>
    </div>
  );
}
