import { useToolStore } from "../../store/toolStore";
import { EraserIcon } from "../icons";

interface Props {
  onClose?: () => void;
}

export function EraserPopover(_props: Props = {}) {
  const tool = useToolStore((s) => s.tool);
  const setTool = useToolStore((s) => s.setTool);

  const isStrokeEraser = tool === "strokeEraser";

  return (
    <div className="tool-popover" role="dialog" aria-label="Eraser settings">
      <div className="tool-popover-header">
        <div className="tool-popover-title">
          <EraserIcon />
          <span>Eraser</span>
        </div>
        <div className="tool-popover-shortcuts">
          <kbd className="tb-kbd" title="Precision eraser">E</kbd>
          <kbd className="tb-kbd" title="Stroke eraser">X</kbd>
        </div>
      </div>

      <div className="tool-popover-section">
        <div className="tool-popover-label">Eraser Type</div>
        <div
          className="eraser-type-segmented"
          role="radiogroup"
          aria-label="Eraser mode"
        >
          <button
            type="button"
            role="radio"
            aria-checked={isStrokeEraser}
            className={"eraser-type-btn" + (isStrokeEraser ? " active" : "")}
            onClick={() =>
              setTool("strokeEraser")}
          >
            <span className="eraser-type-title">Object Eraser</span>
            <span className="eraser-type-desc">
              Erase whole stroke on touch
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!isStrokeEraser}
            className={"eraser-type-btn" + (!isStrokeEraser ? " active" : "")}
            onClick={() =>
              setTool("eraser")}
          >
            <span className="eraser-type-title">Precision Eraser</span>
            <span className="eraser-type-desc">Carve through ink paths</span>
          </button>
        </div>
      </div>

      <div className="tool-popover-footer">
        <div className="tool-popover-hint">
          <span className="hint-bullet">●</span>
          <span>
            {isStrokeEraser
              ? "Object eraser: Touched strokes are cleanly deleted in a single undo step."
              : "Precision eraser: Points are erased as you drag, splitting strokes into pieces."}
          </span>
        </div>
      </div>
    </div>
  );
}
