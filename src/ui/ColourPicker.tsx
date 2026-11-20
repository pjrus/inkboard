import { useState } from "react";
import { summarise } from "../document/strokeCommands";
import { PALETTE, useToolStore } from "../store/toolStore";
import { ChevronIcon } from "./icons";
import { Popover } from "./Popover";

/** Colour picker for the currently selected strokes or text boxes. */
export function ColourPicker() {
  const penColor = useToolStore((s) => s.penColor ?? s.color);
  const selection = useToolStore((s) => s.selection);
  const commands = useToolStore((s) => s.selectionCommands);
  const [open, setOpen] = useState(false);

  const summary = selection ? summarise(selection.colors) : null;
  const mixed = summary?.mixed ?? false;
  const color = summary?.value ?? penColor;
  const setColor = (c: string) => {
    commands?.setColor(c);
  };
  const current = PALETTE.find(
    (p) => p.value.toLowerCase() === color.toLowerCase(),
  );
  const label = "Selection colour";

  return (
    <div className="tb-anchor">
      <button
        type="button"
        className="tb-btn tb-btn-wide"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${mixed ? "mixed" : (current?.name ?? color)}`}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className={"swatch swatch-lg" + (mixed ? " swatch-mixed" : "")}
          style={mixed ? undefined : { background: color }}
        />
        <ChevronIcon />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} label="Choose colour">
        {mixed && <div className="popover-hint">Mixed colours</div>}
        <div className="swatch-grid" role="radiogroup" aria-label={label}>
          {PALETTE.map((p) => {
            const selected = !mixed
              && p.value.toLowerCase() === color.toLowerCase();
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
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            aria-label="Custom colour"
          />
        </label>
      </Popover>
    </div>
  );
}
