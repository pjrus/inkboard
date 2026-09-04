import { useState } from "react";
import { THICKNESS_PRESETS, useToolStore } from "../store/toolStore";
import { summarise } from "../document/strokeCommands";
import { Popover } from "./Popover";
import { ChevronIcon } from "./icons";

export function ThicknessPicker() {
  const penWidth = useToolStore((s) => s.width);
  const penColor = useToolStore((s) => s.color);
  const setPenWidth = useToolStore((s) => s.setWidth);
  const rawSelection = useToolStore((s) => s.selection);
  const commands = useToolStore((s) => s.selectionCommands);
  const [open, setOpen] = useState(false);
  // Thickness only means something for handwriting: a text-only selection
  // falls back to configuring the pen.
  const selection =
    rawSelection && rawSelection.strokeIds.length > 0 ? rawSelection : null;
  const wSummary = selection ? summarise(selection.widths) : null;
  const cSummary = selection ? summarise(selection.colors) : null;
  const mixed = wSummary?.mixed ?? false;
  const width = wSummary ? (wSummary.value ?? penWidth) : penWidth;
  const color = cSummary ? (cSummary.value ?? "#1b1b1f") : penColor;
  const setWidth = (w: number) =>
    selection && commands ? commands.setWidth(w) : setPenWidth(w);
  const current = THICKNESS_PRESETS.find((p) => p.value === width);
  const label = selection ? "Selection thickness" : "Thickness";
  return (
    <div className="tb-anchor">
      <button
        type="button"
        className="tb-btn tb-btn-wide"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${mixed ? "mixed" : (current?.name ?? width)}`}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        {mixed ? (
          <span className="thickness-mixed">Mixed</span>
        ) : (
          <span
            className="thickness-dot"
            style={{
              width: Math.min(18, 4 + width * 1.2),
              height: Math.min(18, 4 + width * 1.2),
              background: color,
            }}
          />
        )}
        <ChevronIcon />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label="Choose thickness"
      >
        {mixed && <div className="popover-hint">Mixed thicknesses</div>}
        <div className="thickness-list" role="radiogroup" aria-label={label}>
          {THICKNESS_PRESETS.map((p) => {
            const selected = !mixed && p.value === width;
            return (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={selected}
                className={"thickness-row" + (selected ? " selected" : "")}
                onClick={() => {
                  setWidth(p.value);
                  setOpen(false);
                }}
              >
                <span className="thickness-preview">
                  <span
                    style={{
                      height: Math.max(1, p.value * 1.3),
                      background: color,
                    }}
                  />
                </span>
                <span className="thickness-name">{p.name}</span>
              </button>
            );
          })}
        </div>
      </Popover>
    </div>
  );
}
