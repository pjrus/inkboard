import { useToolStore } from "../../store/toolStore";
import { HandIcon } from "../icons";

interface Props {
  onClose?: () => void;
}

export function HandPopover(_props: Props = {}) {
  const zoom = useToolStore((s) => s.zoom);
  const setZoom = useToolStore((s) => s.setZoom);
  const stylusSeen = useToolStore((s) => s.stylusSeen);

  const zoomPercent = Math.round(zoom * 100);

  return (
    <div className="tool-popover" role="dialog" aria-label="Hand tool settings">
      <div className="tool-popover-header">
        <div className="tool-popover-title">
          <HandIcon />
          <span>Hand & Navigation</span>
        </div>
        <kbd className="tb-kbd" title="Shortcut">H</kbd>
      </div>

      <div className="tool-popover-section">
        <div className="tool-popover-label">
          <span>Canvas Zoom</span>
          <span className="tool-popover-val">{zoomPercent}%</span>
        </div>
        <div className="zoom-popover-row">
          <button
            type="button"
            className="tb-btn"
            title="Zoom out"
            onClick={() =>
              setZoom(Math.max(0.2, zoom * 0.8))}
          >
            &minus;
          </button>
          <button
            type="button"
            className="tb-btn tb-btn-text"
            title="Reset to 100%"
            onClick={() =>
              setZoom(1)}
          >
            Reset (100%)
          </button>
          <button
            type="button"
            className="tb-btn"
            title="Zoom in"
            onClick={() =>
              setZoom(Math.min(5, zoom * 1.25))}
          >
            +
          </button>
        </div>
      </div>

      <div className="tool-popover-footer">
        <div className="tool-popover-hint">
          <span className="hint-bullet">●</span>
          <span>Two-finger pinch to zoom and pan smoothly.</span>
        </div>
        <div className="tool-popover-hint">
          <span className="hint-bullet">●</span>
          <span>
            {stylusSeen
              ? "Stylus detected: single-finger touch navigates canvas automatically."
              : "Space + drag or middle mouse button to pan from any tool."}
          </span>
        </div>
      </div>
    </div>
  );
}
