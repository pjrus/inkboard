import { PALETTE, useToolStore } from "../../store/toolStore";
import { PencilIcon } from "../icons";

interface Props {
  onClose?: () => void;
}

export function PencilPopover(_props: Props = {}) {
  const color = useToolStore((s) => s.pencilColor ?? s.color);
  const setPencilColor = useToolStore((s) => s.setPencilColor);

  return (
    <div className="tool-popover" role="dialog" aria-label="Pencil settings">
      <div className="tool-popover-header">
        <div className="tool-popover-title">
          <PencilIcon color={color} />
          <span>Pencil</span>
        </div>
        <kbd className="tb-kbd" title="Shortcut">N</kbd>
      </div>

      <div className="tool-popover-section">
        <div className="tool-popover-label">Lead Colour</div>
        <div
          className="swatch-grid swatch-grid-row"
          role="radiogroup"
          aria-label="Pencil color"
        >
          {PALETTE.map((p) => {
            const isSelected = color.toLowerCase() === p.value.toLowerCase();
            return (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={p.name}
                title={p.name}
                className={"swatch-btn" + (isSelected ? " selected" : "")}
                onClick={() => setPencilColor(p.value)}
              >
                <span className="swatch" style={{ background: p.value }} />
              </button>
            );
          })}
        </div>
        <div className="custom-colour">
          <span>Custom colour</span>
          <div className="custom-colour-row">
            <span className="hex-display">{color}</span>
            <input
              type="color"
              aria-label="Pencil custom colour"
              value={color}
              onChange={(e) =>
                setPencilColor(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="tool-popover-footer">
        <div className="tool-popover-hint">
          <span className="hint-bullet">●</span>
          <span>82% textured opacity for natural graphite feel.</span>
        </div>
      </div>
    </div>
  );
}
