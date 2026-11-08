import { useState } from "react";
import { HIGHLIGHTER_WIDTH_FACTOR } from "../canvas/strokeGeometry";
import { summarise } from "../document/strokeCommands";
import { useToolStore } from "../store/toolStore";
import { Popover } from "./Popover";

const PEN_PRESETS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12];
const HIGHLIGHTER_PRESETS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];

export function ThicknessPicker() {
  const tool = useToolStore((s) => s.tool);
  const isHighlighter = tool === "highlighter";
  const isPencil = tool === "pencil";
  const toolKind: "pen" | "pencil" | "highlighter" = isHighlighter
    ? "highlighter"
    : isPencil
    ? "pencil"
    : "pen";

  const penProfiles = useToolStore((s) =>
    s.penThicknessProfiles ?? [1.5, 3, 6]
  );
  const penIdx = useToolStore((s) => s.penThicknessIndex ?? 1);

  const pencilProfiles = useToolStore((s) =>
    s.pencilThicknessProfiles ?? [1.5, 2.5, 4.5]
  );
  const pencilIdx = useToolStore((s) => s.pencilThicknessIndex ?? 1);

  const highlighterProfiles = useToolStore((s) =>
    s.highlighterThicknessProfiles ?? [2, 4, 8]
  );
  const highlighterIdx = useToolStore((s) => s.highlighterThicknessIndex ?? 1);

  const setThicknessProfile = useToolStore((s) => s.setThicknessProfile);
  const updateThicknessProfile = useToolStore((s) => s.updateThicknessProfile);

  const penColor = useToolStore((s) => s.color);
  const highlighterColor = useToolStore((s) => s.highlighterColor ?? s.color);

  const rawSelection = useToolStore((s) => s.selection);
  const commands = useToolStore((s) => s.selectionCommands);
  const selection = rawSelection && rawSelection.strokeIds.length > 0
    ? rawSelection
    : null;
  const wSummary = selection ? summarise(selection.widths) : null;
  const cSummary = selection ? summarise(selection.colors) : null;
  const mixed = wSummary?.mixed ?? false;

  const [editingSlot, setEditingSlot] = useState<number | null>(null);

  const profiles = isHighlighter
    ? highlighterProfiles
    : isPencil
    ? pencilProfiles
    : penProfiles;

  const activeIndex = isHighlighter
    ? highlighterIdx
    : isPencil
    ? pencilIdx
    : penIdx;

  const currentColor = cSummary
    ? (cSummary.value ?? "#1b1b1f")
    : isHighlighter
    ? highlighterColor
    : penColor;

  const handleSlotClick = (idx: number) => {
    if (selection && commands) {
      commands.setWidth(profiles[idx]);
      setThicknessProfile(toolKind, idx);
      return;
    }
    if (activeIndex === idx) {
      // Clicking the already active profile opens the custom thickness editor
      setEditingSlot(editingSlot === idx ? null : idx);
    } else {
      setThicknessProfile(toolKind, idx);
      setEditingSlot(null);
    }
  };

  const currentEditingVal = editingSlot !== null
    ? profiles[editingSlot]
    : profiles[activeIndex];

  const minRange = isHighlighter ? 1 : 0.5;
  const maxRange = isHighlighter ? 18 : 14;
  const step = isHighlighter ? 0.5 : 0.5;

  return (
    <div
      className="tb-thickness-widget"
      role="radiogroup"
      aria-label="Custom stroke thickness profiles"
    >
      <div className="tb-thickness-pills">
        {profiles.map((val, idx) => {
          const isSelected = !mixed && activeIndex === idx;
          const displayPx = isHighlighter
            ? Math.round(val * HIGHLIGHTER_WIDTH_FACTOR)
            : val;

          return (
            <div className="tb-anchor" key={idx}>
              <button
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={`Profile ${idx + 1}: ${displayPx}px${
                  isSelected ? " (Click to edit)" : ""
                }`}
                title={`Profile ${idx + 1}: ${displayPx}px${
                  isSelected ? " · Click to customize" : ""
                }`}
                className={"tb-thickness-btn" + (isSelected ? " active" : "")}
                onClick={() => handleSlotClick(idx)}
              >
                <span
                  className="tb-thickness-bar"
                  style={{
                    height: `${
                      Math.min(
                        14,
                        Math.max(2, isHighlighter ? val * 1.5 : val * 1.3),
                      )
                    }px`,
                    background: currentColor,
                    opacity: isPencil ? 0.82 : 1,
                  }}
                />
                <span className="tb-thickness-label">{displayPx}px</span>
              </button>

              {editingSlot === idx && (
                <Popover
                  open={true}
                  onClose={() => setEditingSlot(null)}
                  label={`Edit profile ${idx + 1} thickness`}
                >
                  <div
                    className="custom-thickness-popover"
                    role="dialog"
                    aria-label="Edit thickness"
                  >
                    <div className="custom-thickness-header">
                      <span>Edit Profile {idx + 1}</span>
                      <span className="custom-thickness-val">
                        {isHighlighter
                          ? `${
                            Math.round(
                              currentEditingVal * HIGHLIGHTER_WIDTH_FACTOR,
                            )
                          }px (${currentEditingVal}×5)`
                          : `${currentEditingVal}px`}
                      </span>
                    </div>

                    <div className="custom-thickness-preview">
                      <span
                        className="custom-thickness-line"
                        style={{
                          height: `${
                            Math.min(
                              22,
                              Math.max(
                                2,
                                isHighlighter
                                  ? currentEditingVal * 1.5
                                  : currentEditingVal * 1.4,
                              ),
                            )
                          }px`,
                          background: currentColor,
                          opacity: isPencil ? 0.82 : 1,
                        }}
                      />
                    </div>

                    <div className="custom-thickness-controls">
                      <button
                        type="button"
                        className="tb-btn"
                        aria-label="Decrease thickness"
                        onClick={() => {
                          const next = Math.max(
                            minRange,
                            Number((currentEditingVal - step).toFixed(1)),
                          );
                          updateThicknessProfile(toolKind, idx, next);
                          if (selection && commands) commands.setWidth(next);
                        }}
                      >
                        &minus;
                      </button>

                      <input
                        type="range"
                        min={minRange}
                        max={maxRange}
                        step={step}
                        value={currentEditingVal}
                        aria-label="Thickness slider"
                        className="custom-thickness-slider"
                        onChange={(e) => {
                          const next = parseFloat(e.target.value);
                          updateThicknessProfile(toolKind, idx, next);
                          if (selection && commands) commands.setWidth(next);
                        }}
                      />

                      <button
                        type="button"
                        className="tb-btn"
                        aria-label="Increase thickness"
                        onClick={() => {
                          const next = Math.min(
                            maxRange,
                            Number((currentEditingVal + step).toFixed(1)),
                          );
                          updateThicknessProfile(toolKind, idx, next);
                          if (selection && commands) commands.setWidth(next);
                        }}
                      >
                        +
                      </button>
                    </div>

                    <div className="custom-thickness-presets">
                      {(isHighlighter ? HIGHLIGHTER_PRESETS : PEN_PRESETS).map(
                        (p) => {
                          const isPresetActive =
                            Math.abs(currentEditingVal - p) < 0.2;
                          const label = isHighlighter ? `${p * 5}` : `${p}`;
                          return (
                            <button
                              key={p}
                              type="button"
                              className={"preset-chip"
                                + (isPresetActive ? " active" : "")}
                              onClick={() => {
                                updateThicknessProfile(toolKind, idx, p);
                                if (selection && commands) {
                                  commands.setWidth(p);
                                }
                              }}
                            >
                              {label}
                            </button>
                          );
                        },
                      )}
                    </div>
                  </div>
                </Popover>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
