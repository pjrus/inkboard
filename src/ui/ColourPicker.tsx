import { useState } from "react";
import { PALETTE, useToolStore } from "../store/toolStore";
import { Popover } from "./Popover";
import { ChevronIcon } from "./icons";

export function ColourPicker() {
  const color = useToolStore((s) => s.color);
  const setColor = useToolStore((s) => s.setColor);
  const [open, setOpen] = useState(false);
  const current = PALETTE.find((p) => p.value.toLowerCase() === color.toLowerCase());
  return (
    <div className="tb-anchor">
      <button
        type="button"
        className="tb-btn tb-btn-wide"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Colour: ${current?.name ?? color}`}
        title="Colour"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="swatch swatch-lg" style={{ background: color }} />
        <ChevronIcon />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} label="Choose colour">
        <div className="swatch-grid" role="radiogroup" aria-label="Pen colour">
          {PALETTE.map((p) => {
            const selected = p.value.toLowerCase() === color.toLowerCase();
            return (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={p.name}
                title={p.name}
                className={"swatch-btn" + (selected ? " selected" : "")}
                onClick={() => {
                  setColor(p.value);
                  setOpen(false);
                }}
              >
                <span className="swatch" style={{ background: p.value }} />
              </button>
            );
          })}
        </div>
        <label className="custom-colour">
          <span>Custom</span>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Custom colour" />
        </label>
      </Popover>
    </div>
  );
}
