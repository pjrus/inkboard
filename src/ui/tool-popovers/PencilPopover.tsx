import { useState } from "react";
import { PALETTE, useToolStore } from "../../store/toolStore";
import { PencilIcon, PlusIcon } from "../icons";

interface Props {
  onClose?: () => void;
}

export function PencilPopover(_props: Props = {}) {
  const color = useToolStore((s) => s.pencilColor ?? s.color);
  const setPencilColor = useToolStore((s) => s.setPencilColor);
  const customColors = useToolStore((s) => s.customPencilColors ?? []);
  const addCustomColor = useToolStore((s) => s.addCustomColor);
  const removeCustomColor = useToolStore((s) => s.removeCustomColor);

  const [inputColor, setInputColor] = useState(color);

  const handleAdd = () => {
    addCustomColor("pencil", inputColor);
  };

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
          aria-label="Lead colour"
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
                  setPencilColor(p.value);
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
                    setPencilColor(c);
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
                    removeCustomColor("pencil", c);
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
              aria-label="Pencil custom colour"
              value={inputColor}
              onChange={(e) => {
                const val = e.target.value;
                setInputColor(val);
                setPencilColor(val);
              }}
            />
            <button
              type="button"
              className="add-colour-btn"
              title="Add to lead colours"
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
          <span>82% textured opacity for natural graphite feel.</span>
        </div>
      </div>
    </div>
  );
}
