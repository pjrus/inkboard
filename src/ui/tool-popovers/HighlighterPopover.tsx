import { useToolStore } from "../../store/toolStore";
import { HighlighterIcon } from "../icons";

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
          aria-label="Highlighter color"
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
                }}
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
              aria-label="Highlighter custom colour"
              value={color}
              onChange={(e) => {
                setHighlighterColor(e.target.value);
              }}
            />
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
        <div className="tool-popover-hint">
          <span className="hint-bullet">●</span>
          <span>
            Hold <strong>Shift</strong> while highlighting to snap straight.
          </span>
        </div>
      </div>
    </div>
  );
}
