import { useState } from "react";
import { PALETTE, useToolStore } from "../store/toolStore";
import { summarise } from "../document/strokeCommands";
import { Popover } from "./Popover";
import { ChevronIcon } from "./icons";

export function ColourPicker() {
  const penColor = useToolStore((s) => s.color);
  const setPenColor = useToolStore((s) => s.setColor);
  const selection = useToolStore((s) => s.strokeSelection);
  const commands = useToolStore((s) => s.selectionCommands);
  const [open, setOpen] = useState(false);
  // With a selection, the picker edits the selected strokes instead of the pen.
  const summary = selection ? summarise(selection.colors) : null;
  const mixed = summary?.mixed ?? false;
  const color = summary ? (summary.value ?? penColor) : penColor;
  const setColor = (c: string) => (selection && commands ? commands.setColor(c) : setPenColor(c));
  const current = PALETTE.find((p) => p.value.toLowerCase() === color.toLowerCase());
  const label = selection ? "Selection colour" : "Colour";
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
        <span className={"swatch swatch-lg" + (mixed ? " swatch-mixed" : "")} style={mixed ? undefined : { background: color }} />
        <ChevronIcon />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} label="Choose colour">
        {mixed && <div className="popover-hint">Mixed colours</div>}
        <div className="swatch-grid" role="radiogroup" aria-label={label}>
          {PALETTE.map((p) => {
            const selected = !mixed && p.value.toLowerCase() === color.toLowerCase();
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
