import { useState } from "react";
import { summarise } from "../document/strokeCommands";
import type { FontFamilyId } from "../document/schema";
import { FONTS, fontStack, getFont } from "../text/fonts";
import { useToolStore } from "../store/toolStore";
import { Popover } from "./Popover";
import { ChevronIcon } from "./icons";

/**
 * Font picker over the four bundled families.
 *
 * With text selected it retypes the selection; otherwise it configures the
 * next text box. Deliberately a short list: this is a note-taking canvas, not
 * a type foundry.
 */
export function FontSelector() {
  const toolFont = useToolStore((s) => s.textFont);
  const setToolFont = useToolStore((s) => s.setTextFont);
  const selection = useToolStore((s) => s.selection);
  const commands = useToolStore((s) => s.selectionCommands);
  const [open, setOpen] = useState(false);

  const editingSelection = !!selection && selection.textIds.length > 0;
  const summary = editingSelection ? summarise(selection.fonts) : null;
  const mixed = summary?.mixed ?? false;
  const font = summary ? ((summary.value as FontFamilyId | null) ?? toolFont) : toolFont;
  const apply = (f: FontFamilyId) => {
    if (editingSelection && commands) commands.setFont(f);
    else setToolFont(f);
  };
  const label = editingSelection ? "Selection font" : "Font";

  return (
    <div className="tb-anchor">
      <button
        type="button"
        className="tb-btn tb-btn-wide tb-btn-text"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${mixed ? "mixed" : getFont(font).label}`}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-name" style={mixed ? undefined : { fontFamily: fontStack(font) }}>
          {mixed ? "Mixed" : getFont(font).label}
        </span>
        <ChevronIcon />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} label="Choose font">
        {mixed && <div className="popover-hint">Mixed fonts &mdash; pick one to apply to all</div>}
        <div className="font-list" role="radiogroup" aria-label={label}>
          {FONTS.map((f) => {
            const selected = !mixed && f.id === font;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={"font-row" + (selected ? " selected" : "")}
                style={{ fontFamily: f.stack }}
                onClick={() => {
                  apply(f.id);
                  setOpen(false);
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </Popover>
    </div>
  );
}
