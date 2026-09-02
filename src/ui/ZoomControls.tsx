import { useToolStore } from "../store/toolStore";

interface Props {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

export function ZoomControls({ onZoomIn, onZoomOut, onReset }: Props) {
  const zoom = useToolStore((s) => s.zoom);
  return (
    <div className="zoom-controls" role="group" aria-label="Zoom">
      <button type="button" aria-label="Zoom out" title="Zoom out (⌘−)" onClick={onZoomOut}>−</button>
      <button type="button" className="zoom-value" aria-label="Reset zoom to 100%" title="Reset zoom (⌘0)" onClick={onReset}>
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" aria-label="Zoom in" title="Zoom in (⌘+)" onClick={onZoomIn}>+</button>
    </div>
  );
}
