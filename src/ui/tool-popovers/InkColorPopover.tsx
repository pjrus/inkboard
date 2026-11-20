import { type ReactNode, useEffect, useState } from "react";
import { useToolStore } from "../../store/toolStore";
import { PlusIcon } from "../icons";

export interface SwatchOption {
  name: string;
  value: string;
}

interface Props {
  toolKey: "pen" | "pencil" | "highlighter";
  title: string;
  shortcut: string;
  icon: ReactNode;
  sectionLabel: string;
  palette: SwatchOption[];
  color: string;
  onSelectColor: (color: string) => void;
  customColors: string[];
  addTitle: string;
  extraSections?: ReactNode;
  footer: ReactNode;
}

/** Shared colour-swatch + custom-colour popover used by pen, pencil, and highlighter. */
export function InkColorPopover({
  toolKey,
  title,
  shortcut,
  icon,
  sectionLabel,
  palette,
  color,
  onSelectColor,
  customColors,
  addTitle,
  extraSections,
  footer,
}: Props) {
  const addCustomColor = useToolStore((s) => s.addCustomColor);
  const removeCustomColor = useToolStore((s) => s.removeCustomColor);
  const [inputColor, setInputColor] = useState(color);

  useEffect(() => {
    setInputColor(color);
  }, [color]);

  return (
    <div
      className="tool-popover"
      role="dialog"
      aria-label={`${title} settings`}
    >
      <div className="tool-popover-header">
        <div className="tool-popover-title">
          {icon}
          <span>{title}</span>
        </div>
        <kbd className="tb-kbd" title="Shortcut">{shortcut}</kbd>
      </div>

      <div className="tool-popover-section">
        <div className="tool-popover-label">{sectionLabel}</div>
        <div
          className="swatch-grid swatch-grid-row"
          role="radiogroup"
          aria-label={sectionLabel}
        >
          {palette.map((p) => {
            const isSelected = color.toLowerCase() === p.value.toLowerCase();
            return (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={p.name}
                title={p.name}
                className={"swatch-btn" + (isSelected ? " selected" : "")}
                onClick={() => {
                  onSelectColor(p.value);
                  setInputColor(p.value);
                }}
              >
                <span className="swatch" style={{ background: p.value }} />
              </button>
            );
          })}
          {customColors.map((c) => {
            const isSelected = color.toLowerCase() === c.toLowerCase();
            return (
              <div key={c} className="custom-swatch-wrapper">
                <button
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  aria-label={`Custom colour ${c}`}
                  title={`Custom colour: ${c}`}
                  className={"swatch-btn" + (isSelected ? " selected" : "")}
                  onClick={() => {
                    onSelectColor(c);
                    setInputColor(c);
                  }}
                >
                  <span className="swatch" style={{ background: c }} />
                </button>
                <button
                  type="button"
                  className="custom-swatch-remove"
                  title={`Remove ${c}`}
                  aria-label={`Remove ${c}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeCustomColor(toolKey, c);
                  }}
                >
                  &times;
                </button>
              </div>
            );
          })}
        </div>

        <div className="custom-colour">
          <span>Add custom colour</span>
          <div className="custom-colour-row">
            <span className="hex-display">{inputColor}</span>
            <input
              type="color"
              aria-label={`${title} custom colour`}
              value={inputColor}
              onChange={(e) => {
                const val = e.target.value;
                setInputColor(val);
                onSelectColor(val);
              }}
            />
            <button
              type="button"
              className="add-colour-btn"
              title={addTitle}
              onClick={() => addCustomColor(toolKey, inputColor)}
            >
              <PlusIcon />
              <span>Add</span>
            </button>
          </div>
        </div>
      </div>

      {extraSections}

      <div className="tool-popover-footer">{footer}</div>
    </div>
  );
}
