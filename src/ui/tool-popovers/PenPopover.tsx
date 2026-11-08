import { PALETTE, useToolStore } from "../../store/toolStore";
import { PenIcon } from "../icons";

interface Props {
  onClose?: () => void;
}

export function PenPopover(_props: Props = {}) {
  const color = useToolStore((s) => s.color);
  const setColor = useToolStore((s) => s.setColor);
  const stylusSeen = useToolStore((s) => s.stylusSeen);

  return (
    <div className="tool-popover" role="dialog" aria-label="Pen settings">
      <div className="tool-popover-header">
        <div className="tool-popover-title">
          <PenIcon color={color} />
          <span>Pen</span>
        </div>
        <kbd className="tb-kbd" title="Shortcut">P</kbd>
      </div>

      <div className="tool-popover-section">
        <div className="tool-popover-label">Ink Colour</div>
        <div
          className="swatch-grid swatch-grid-row"
          role="radiogroup"
          aria-label="Pen color"
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
                onClick={() => setColor(p.value)}
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
              aria-label="Pen custom colour"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="tool-popover-footer">
        <div className="tool-popover-hint">
          <span className="hint-bullet">●</span>
          <span>
            {stylusSeen
              ? "Stylus connected · pressure active"
              : "Pressure dynamics supported with Apple Pencil / stylus."}
          </span>
        </div>
        <div className="tool-popover-hint">
          <span className="hint-bullet">●</span>
          <span>
            Press <strong>[</strong> or <strong>]</strong>{" "}
            to adjust thickness anytime.
          </span>
        </div>
      </div>
    </div>
  );
}
