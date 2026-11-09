import { useState } from "react";
import { useToolStore } from "../../store/toolStore";
import { HighlighterIcon, PlusIcon } from "../icons";

export const HIGHLIGHTER_PALETTE = [
  { name: "Neon Yellow", value: "#ffe838" },
  { name: "Neon Green", value: "#51cf66" },
  { name: "Sky Blue", value: "#339af0" },
  { name: "Coral Pink", value: "#ff6b81" },
  { name: "Pastel Orange", value: "#ff922b" },
  { name: "Neon Violet", value: "#cc5de8" },
  { name: "Rose Red", value: "#fa5252" },
  { name: "Slate Grey", value: "#868e96" },
];

interface Props {
  onClose?: () => void;
}

export function HighlighterPopover(_props: Props = {}) {
  const color = useToolStore((s) => s.highlighterColor ?? s.color);
  const setHighlighterColor = useToolStore((s) => s.setHighlighterColor);
  const customColors = useToolStore((s) => s.customHighlighterColors ?? []);
  const addCustomColor = useToolStore((s) => s.addCustomColor);
  const removeCustomColor = useToolStore((s) => s.removeCustomColor);

  const [inputColor, setInputColor] = useState(color);

  const handleAdd = () => {
    addCustomColor("highlighter", inputColor);
  };

  return (
    <div
      className="tool-popover"
      role="dialog"
      aria-label="Highlighter settings"
    >
      <div className="tool-popover-header">
        <div className="tool-popover-title">
          <HighlighterIcon color={color} />
          <span>Highlighter</span>
        </div>
        <kbd className="tb-kbd" title="Shortcut">M</kbd>
      </div>

      <div className="tool-popover-section">
        <div className="tool-popover-label">Highlighter Palette</div>
        <div
          className="swatch-grid swatch-grid-row"
          role="radiogroup"
          aria-label="Highlighter palette"
        >
          {HIGHLIGHTER_PALETTE.map((p) => {
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
                  setHighlighterColor(p.value);
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
                    setHighlighterColor(c);
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
                    removeCustomColor("highlighter", c);
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
              aria-label="Highlighter custom colour"
              value={inputColor}
              onChange={(e) => {
                const val = e.target.value;
                setInputColor(val);
                setHighlighterColor(val);
              }}
            />
            <button
              type="button"
              className="add-colour-btn"
              title="Add to highlighter palette"
              onClick={handleAdd}
            >
              <PlusIcon />
              <span>Add</span>
            </button>
          </div>
        </div>
      </div>

      <div className="tool-popover-section">
        <div className="tool-popover-label">Preview on Text</div>
        <div className="highlighter-preview-box">
          <div className="highlighter-preview-text">
            Important notes & key points
          </div>
          <div
            className="highlighter-preview-stroke"
            style={{
              height: "18px",
              backgroundColor: color,
            }}
          />
        </div>
      </div>

      <div className="tool-popover-footer">
        <div className="tool-popover-hint">
          <span className="hint-bullet">●</span>
          <span>Translucent ink with multiply blend.</span>
        </div>
      </div>
    </div>
  );
}
