import { useState } from "react";
import { PALETTE, useToolStore } from "../../store/toolStore";
import { PenIcon, PlusIcon } from "../icons";

interface Props {
  onClose?: () => void;
}

export function PenPopover(_props: Props = {}) {
  const color = useToolStore((s) => s.color);
  const setColor = useToolStore((s) => s.setColor);
  const customColors = useToolStore((s) => s.customPenColors ?? []);
  const addCustomColor = useToolStore((s) => s.addCustomColor);
  const removeCustomColor = useToolStore((s) => s.removeCustomColor);
  const stylusSeen = useToolStore((s) => s.stylusSeen);

  const [inputColor, setInputColor] = useState(color);

  const handleAdd = () => {
    addCustomColor("pen", inputColor);
  };

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
          aria-label="Pen ink colour"
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
                onClick={() => {
                  setColor(p.value);
                  setInputColor(p.value);
                }}
              >
                <span className="swatch" style={{ background: p.value }} />
              </button>
            );
          })}
          {customColors.map((c) => {
            const isSelected = color.toLowerCase() === c.toLowerCase();
            return (
              <div key={c} className="custom-swatch-wrapper">
                <button
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  aria-label={`Custom colour ${c}`}
                  title={`Custom colour: ${c}`}
                  className={"swatch-btn" + (isSelected ? " selected" : "")}
                  onClick={() => {
                    setColor(c);
                    setInputColor(c);
                  }}
                >
                  <span className="swatch" style={{ background: c }} />
                </button>
                <button
                  type="button"
                  className="custom-swatch-remove"
                  title={`Remove ${c}`}
                  aria-label={`Remove ${c}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeCustomColor("pen", c);
                  }}
                >
                  &times;
                </button>
              </div>
            );
          })}
        </div>

        <div className="custom-colour">
          <span>Add custom colour</span>
          <div className="custom-colour-row">
            <span className="hex-display">{inputColor}</span>
            <input
              type="color"
              aria-label="Pen custom colour"
              value={inputColor}
              onChange={(e) => {
                const val = e.target.value;
                setInputColor(val);
                setColor(val);
              }}
            />
            <button
              type="button"
              className="add-colour-btn"
              title="Add to ink colours"
              onClick={handleAdd}
            >
              <PlusIcon />
              <span>Add</span>
            </button>
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
