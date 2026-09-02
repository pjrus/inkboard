import { useState } from "react";
import { THICKNESS_PRESETS, useToolStore } from "../store/toolStore";
import { Popover } from "./Popover";
import { ChevronIcon } from "./icons";

export function ThicknessPicker() {
  const width = useToolStore((s) => s.width);
  const color = useToolStore((s) => s.color);
  const setWidth = useToolStore((s) => s.setWidth);
  const [open, setOpen] = useState(false);
  const current = THICKNESS_PRESETS.find((p) => p.value === width);
  return (
    <div className="tb-anchor">
      <button
        type="button"
        className="tb-btn tb-btn-wide"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Thickness: ${current?.name ?? width}`}
        title="Thickness"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="thickness-dot" style={{ width: Math.min(18, 4 + width * 1.2), height: Math.min(18, 4 + width * 1.2), background: color }} />
        <ChevronIcon />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} label="Choose thickness">
        <div className="thickness-list" role="radiogroup" aria-label="Stroke thickness">
          {THICKNESS_PRESETS.map((p) => {
            const selected = p.value === width;
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
                  <span style={{ height: Math.max(1, p.value * 1.3), background: color }} />
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
