import { useState } from "react";
import { summarise } from "../document/strokeCommands";
import { TEXT_BACKGROUND_PALETTE, useToolStore } from "../store/toolStore";
import { ChevronIcon } from "./icons";
import { Popover } from "./Popover";

/**
 * Background colour picker for text boxes.
 *
 * When text is selected, it updates the selection's background colour (or clears
 * it back to transparent). Otherwise, it configures the default background for
 * subsequent text boxes.
 */
export function TextBackgroundPicker() {
  const toolBg = useToolStore((s) => s.textBackgroundColor);
  const setToolBg = useToolStore((s) => s.setTextBackgroundColor);
  const selection = useToolStore((s) => s.selection);
  const commands = useToolStore((s) => s.selectionCommands);
  const [open, setOpen] = useState(false);

  const editingSelection = !!selection && selection.textIds.length > 0;
  const summary = editingSelection && selection.backgroundColors
    ? summarise(selection.backgroundColors)
    : null;
  const mixed = summary?.mixed ?? false;
  const rawBg = summary ? summary.value : toolBg;
  const currentBg = rawBg ?? "transparent";
  const isTransparent = currentBg === "transparent";

  const apply = (color?: string) => {
    if (editingSelection && commands) commands.setTextBackground(color);
    else setToolBg(color);
  };

  const currentPreset = TEXT_BACKGROUND_PALETTE.find(
    (p) => p.value.toLowerCase() === currentBg.toLowerCase(),
  );
  const label = editingSelection
    ? "Text background"
    : "Default text background";

  return (
    <div className="tb-anchor">
      <button
        type="button"
        className="tb-btn tb-btn-wide"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${
          mixed
            ? "mixed"
            : (currentPreset?.name ?? (isTransparent ? "None" : currentBg))
        }`}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className={"swatch swatch-lg"
            + (mixed
              ? " swatch-mixed"
              : isTransparent
              ? " swatch-transparent"
              : "")}
          style={mixed || isTransparent ? undefined : { background: currentBg }}
        />
        <ChevronIcon />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label="Choose text background"
      >
        {mixed && <div className="popover-hint">Mixed backgrounds</div>}
        <div className="swatch-grid" role="radiogroup" aria-label={label}>
          {TEXT_BACKGROUND_PALETTE.map((p) => {
            const isNone = p.value === "transparent";
            const selected = !mixed
              && (isNone
                ? isTransparent
                : !isTransparent
                  && p.value.toLowerCase() === currentBg.toLowerCase());
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
                  apply(isNone ? undefined : p.value);
                  setOpen(false);
                }}
              >
                {isNone
                  ? <span className="swatch swatch-transparent" />
                  : <span className="swatch" style={{ background: p.value }} />}
              </button>
            );
          })}
        </div>
        <label className="custom-colour">
          <span>Custom</span>
          <input
            type="color"
            value={isTransparent ? "#ffffff" : currentBg}
            onChange={(e) => {
              apply(e.target.value);
            }}
            aria-label="Custom background colour"
          />
        </label>
      </Popover>
    </div>
  );
}
