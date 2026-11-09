import { useState } from "react";
import { PALETTE, useToolStore } from "../store/toolStore";
import { PlusIcon } from "./icons";
import { Popover } from "./Popover";
import { HIGHLIGHTER_PALETTE } from "./tool-popovers/HighlighterPopover";

export function ToolColorPicker() {
  const tool = useToolStore((s) => s.tool);
  const isHighlighter = tool === "highlighter";
  const isPencil = tool === "pencil";
  const toolKind: "pen" | "pencil" | "highlighter" = isHighlighter
    ? "highlighter"
    : isPencil
    ? "pencil"
    : "pen";

  const penProfiles = useToolStore(
    (s) => s.penColorProfiles ?? ["#1b1b1f", "#2b6de9", "#d93025"],
  );
  const penIdx = useToolStore((s) => s.penColorIndex ?? 0);

  const pencilProfiles = useToolStore(
    (s) => s.pencilColorProfiles ?? ["#1b1b1f", "#5f6368", "#c62828"],
  );
  const pencilIdx = useToolStore((s) => s.pencilColorIndex ?? 0);

  const highlighterProfiles = useToolStore(
    (s) => s.highlighterColorProfiles ?? ["#ffe838", "#51cf66", "#ff6b81"],
  );
  const highlighterIdx = useToolStore((s) => s.highlighterColorIndex ?? 0);

  const setColorProfile = useToolStore((s) => s.setColorProfile);
  const updateColorProfile = useToolStore((s) => s.updateColorProfile);
  const addColorProfile = useToolStore((s) => s.addColorProfile);
  const removeColorProfile = useToolStore((s) => s.removeColorProfile);

  const rawSelection = useToolStore((s) => s.selection);
  const commands = useToolStore((s) => s.selectionCommands);
  const selection = rawSelection && rawSelection.strokeIds.length > 0
    ? rawSelection
    : null;

  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [addingOpen, setAddingOpen] = useState(false);
  const [newColor, setNewColor] = useState(
    isHighlighter ? "#cc5de8" : "#2e9e5b",
  );

  const profiles = isHighlighter
    ? highlighterProfiles
    : isPencil
    ? pencilProfiles
    : penProfiles;

  const activeIdx = isHighlighter
    ? highlighterIdx
    : isPencil
    ? pencilIdx
    : penIdx;

  const palette = isHighlighter ? HIGHLIGHTER_PALETTE : PALETTE;
  const toolLabel = isHighlighter
    ? "Highlighter"
    : isPencil
    ? "Pencil"
    : "Pen";

  const handleSwatchClick = (idx: number) => {
    if (selection && commands) {
      commands.setColor(profiles[idx]);
      setColorProfile(toolKind, idx);
      return;
    }
    if (activeIdx === idx) {
      setEditingIdx(editingIdx === idx ? null : idx);
      setAddingOpen(false);
    } else {
      setColorProfile(toolKind, idx);
      setEditingIdx(null);
      setAddingOpen(false);
    }
  };

  const handleAddColor = (c: string) => {
    addColorProfile(toolKind, c);
    setAddingOpen(false);
  };

  return (
    <div
      className="tb-quick-swatches"
      role="radiogroup"
      aria-label={`${toolLabel} colours`}
    >
      {profiles.map((c, idx) => {
        const isSelected = activeIdx === idx;
        const isPopoverOpen = editingIdx === idx;

        return (
          <div className="tb-anchor" key={idx}>
            <button
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={`${toolLabel} colour ${idx + 1}: ${c}${
                isSelected ? " (Click to edit)" : ""
              }`}
              title={`${toolLabel} colour: ${c}${
                isSelected ? " · Click to customize" : ""
              }`}
              className={"quick-swatch-btn" + (isSelected ? " active" : "")}
              onClick={() => handleSwatchClick(idx)}
            >
              <span className="quick-swatch-dot" style={{ background: c }} />
            </button>

            {isPopoverOpen && (
              <Popover
                open={true}
                onClose={() => setEditingIdx(null)}
                label={`Customize ${toolLabel} colour`}
              >
                <div
                  className="custom-colour-popover"
                  role="dialog"
                  aria-label="Customize colour"
                >
                  <div className="custom-colour-popover-header">
                    <span>Customize Colour</span>
                    <span className="hex-display">{c}</span>
                  </div>

                  <div className="custom-colour-row">
                    <span
                      className="swatch swatch-lg"
                      style={{ background: c }}
                    />
                    <input
                      type="color"
                      aria-label="Custom color picker"
                      value={c}
                      onChange={(e) =>
                        updateColorProfile(toolKind, idx, e.target.value)}
                    />
                  </div>

                  <div
                    className="swatch-grid"
                    role="radiogroup"
                    aria-label="Palette presets"
                  >
                    {palette.map((p) => {
                      const isCur = p.value.toLowerCase() === c.toLowerCase();
                      return (
                        <button
                          key={p.value}
                          type="button"
                          role="radio"
                          aria-checked={isCur}
                          title={p.name}
                          className={"swatch-btn" + (isCur ? " selected" : "")}
                          onClick={() => {
                            updateColorProfile(toolKind, idx, p.value);
                          }}
                        >
                          <span
                            className="swatch"
                            style={{ background: p.value }}
                          />
                        </button>
                      );
                    })}
                  </div>

                  {profiles.length > 1 && (
                    <button
                      type="button"
                      className="custom-colour-delete-btn"
                      onClick={() => {
                        removeColorProfile(toolKind, idx);
                        setEditingIdx(null);
                      }}
                    >
                      Remove swatch
                    </button>
                  )}
                </div>
              </Popover>
            )}
          </div>
        );
      })}

      <div className="tb-anchor">
        <button
          type="button"
          className="quick-swatch-add-btn"
          aria-label={`Add custom ${toolLabel.toLowerCase()} colour`}
          title={`Add custom colour`}
          onClick={() => {
            setAddingOpen((o) => !o);
            setEditingIdx(null);
          }}
        >
          <PlusIcon />
        </button>

        {addingOpen && (
          <Popover
            open={true}
            onClose={() => setAddingOpen(false)}
            label={`Add custom ${toolLabel.toLowerCase()} colour`}
          >
            <div
              className="custom-colour-popover"
              role="dialog"
              aria-label="Add custom colour"
            >
              <div className="custom-colour-popover-header">
                <span>Add Custom Colour</span>
                <span className="hex-display">{newColor}</span>
              </div>

              <div className="custom-colour-row">
                <span
                  className="swatch swatch-lg"
                  style={{ background: newColor }}
                />
                <input
                  type="color"
                  aria-label="Pick custom colour to add"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                />
              </div>

              <div
                className="swatch-grid"
                role="radiogroup"
                aria-label="Select preset colour"
              >
                {palette.map((p) => {
                  const isCur =
                    p.value.toLowerCase() === newColor.toLowerCase();
                  return (
                    <button
                      key={p.value}
                      type="button"
                      role="radio"
                      aria-checked={isCur}
                      title={p.name}
                      className={"swatch-btn" + (isCur ? " selected" : "")}
                      onClick={() => setNewColor(p.value)}
                    >
                      <span
                        className="swatch"
                        style={{ background: p.value }}
                      />
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                className="popover-action-btn"
                onClick={() => handleAddColor(newColor)}
              >
                Add Colour
              </button>
            </div>
          </Popover>
        )}
      </div>
    </div>
  );
}
