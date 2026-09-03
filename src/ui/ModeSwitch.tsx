import { useToolStore } from "../store/toolStore";
import { EditModeIcon, EyeIcon } from "./icons";

/**
 * Edit / View switch.
 *
 * Deliberately the first control in the toolbar and always visible: the user
 * should never have to guess whether the board can currently be changed.
 */
export function ModeSwitch() {
  const mode = useToolStore((s) => s.canvasMode);
  const setMode = useToolStore((s) => s.setCanvasMode);
  return (
    <div className="segmented" role="radiogroup" aria-label="Canvas mode">
      <button
        type="button"
        role="radio"
        aria-checked={mode === "edit"}
        className={"segmented-icon" + (mode === "edit" ? " active" : "")}
        title="Edit mode (V toggles)"
        onClick={() => setMode("edit")}
      >
        <EditModeIcon />
        <span>Edit</span>
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === "view"}
        className={"segmented-icon" + (mode === "view" ? " active" : "")}
        title="View mode: navigate without editing (V toggles)"
        onClick={() => setMode("view")}
      >
        <EyeIcon />
        <span>View</span>
      </button>
    </div>
  );
}
