import { useState } from "react";
import { summarise } from "../document/strokeCommands";
import { FONT_SIZE_PRESETS, nextFontSizeStep } from "../text/textCommands";
import { useToolStore } from "../store/toolStore";
import { Popover } from "./Popover";
import { ChevronIcon } from "./icons";

/**
 * Font size as a preset list plus a stepper, matching the thickness control.
 * Sizes are world units, so text zooms with the rest of the canvas.
 */
export function FontSizeSelector() {
  const toolSize = useToolStore((s) => s.textFontSize);
  const setToolSize = useToolStore((s) => s.setTextFontSize);
  const selection = useToolStore((s) => s.selection);
  const commands = useToolStore((s) => s.selectionCommands);
  const [open, setOpen] = useState(false);

  const editingSelection = !!selection && selection.textIds.length > 0;
  const summary = editingSelection ? summarise(selection.fontSizes) : null;
  const mixed = summary?.mixed ?? false;
  const size = summary ? (summary.value ?? toolSize) : toolSize;

  const setSize = (s: number) => {
    if (editingSelection && commands) commands.setFontSize(s);
    else setToolSize(s);
  };
  const step = (direction: 1 | -1) => {
    if (editingSelection && commands) commands.adjustFontSize(direction);
    else setToolSize(nextFontSizeStep(toolSize, direction));
  };
  const label = editingSelection ? "Selection font size" : "Font size";

  return (
    <div className="tb-anchor font-size-control">
      <div className="stepper" role="group" aria-label={label}>
        <button
          type="button"
          aria-label="Smaller text"
          title="Smaller text"
          onClick={() => step(-1)}
        >
          &minus;
        </button>
        <button
          type="button"
          className="stepper-value stepper-menu"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${label}: ${mixed ? "mixed" : size}`}
          title={label}
          onClick={() => setOpen((o) => !o)}
        >
          {mixed ? "Mixed" : size}
          <ChevronIcon />
        </button>
        <button
          type="button"
          aria-label="Larger text"
          title="Larger text"
          onClick={() => step(1)}
        >
          +
        </button>
      </div>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label="Choose font size"
      >
        <div className="size-grid" role="radiogroup" aria-label={label}>
          {FONT_SIZE_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={!mixed && p === size}
              className={"size-btn" + (!mixed && p === size ? " selected" : "")}
              onClick={() => {
                setSize(p);
                setOpen(false);
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}
