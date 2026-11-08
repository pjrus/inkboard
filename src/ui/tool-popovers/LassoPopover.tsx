import type { LassoFilter } from "../../document/schema";
import { useToolStore } from "../../store/toolStore";
import { LassoIcon } from "../icons";

interface Props {
  onClose?: () => void;
}

const FILTERS: {
  key: keyof LassoFilter;
  label: string;
  icon: string;
  hint: string;
}[] = [
  {
    key: "ink",
    label: "Handwriting & Ink",
    icon: "✍️",
    hint: "Pen, pencil and highlighter strokes",
  },
  {
    key: "text",
    label: "Text Boxes",
    icon: "🔤",
    hint: "Typed collaborative text",
  },
  {
    key: "images",
    label: "Images & PDF Pages",
    icon: "🖼️",
    hint: "Imported PDF documents and images",
  },
];

export function LassoPopover(_props: Props = {}) {
  const filter = useToolStore((s) => s.lassoFilter);
  const toggle = useToolStore((s) => s.toggleLassoFilter);

  const activeCount = Object.values(filter).filter(Boolean).length;

  return (
    <div className="tool-popover" role="dialog" aria-label="Lasso settings">
      <div className="tool-popover-header">
        <div className="tool-popover-title">
          <LassoIcon />
          <span>Lasso Tool</span>
        </div>
        <kbd className="tb-kbd" title="Shortcut">L</kbd>
      </div>

      <div className="tool-popover-section">
        <div className="tool-popover-label">Include in Selection</div>
        <div
          className="filter-toggle-list"
          role="group"
          aria-label="Lasso filters"
        >
          {FILTERS.map((f) => {
            const on = filter[f.key];
            const isOnlyOne = on && activeCount === 1;
            return (
              <label
                key={f.key}
                className={"filter-toggle-row" + (on ? " active" : "")
                  + (isOnlyOne ? " disabled" : "")}
                title={isOnlyOne
                  ? "At least one type must stay enabled"
                  : f.hint}
              >
                <div className="filter-toggle-info">
                  <span className="filter-emoji">{f.icon}</span>
                  <div>
                    <div className="filter-label">{f.label}</div>
                    <div className="filter-hint">{f.hint}</div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={isOnlyOne}
                  onChange={() => toggle(f.key)}
                />
              </label>
            );
          })}
        </div>
      </div>

      <div className="tool-popover-footer">
        <div className="tool-popover-hint">
          <span className="hint-bullet">●</span>
          <span>
            40% enclosed rule: captures objects even when drawn loosely.
          </span>
        </div>
        <div className="tool-popover-hint">
          <span className="hint-bullet">●</span>
          <span>
            Hold <strong>Shift</strong> to add more items to current selection.
          </span>
        </div>
      </div>
    </div>
  );
}
