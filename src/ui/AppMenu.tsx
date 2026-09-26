import { useState } from "react";
import { useToolStore } from "../store/toolStore";
import { BACKGROUNDS } from "../theme/canvasTheme";
import { ExportIcon, MenuIcon } from "./icons";
import { Popover } from "./Popover";
import { ThemeSelector } from "./ThemeSelector";

interface Props {
  onExportPDF: () => void;
  /** Absent in View mode, where the board cannot be changed. */
  onBackground?: (colour: string) => void;
}

/**
 * Overflow menu for board-level actions and preferences. Appearance lives
 * here rather than on the drawing toolbar: it is set once, not per stroke.
 */
export function AppMenu({ onExportPDF, onBackground }: Props) {
  const [open, setOpen] = useState(false);
  const background = useToolStore((s) => s.background);
  return (
    <div className="tb-anchor">
      <button
        type="button"
        className="tb-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Board menu"
        title="Board menu"
        onClick={() => setOpen((o) => !o)}
      >
        <MenuIcon />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} label="Board menu">
        <div className="menu">
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              onExportPDF();
            }}
          >
            <ExportIcon />
            <span>Export PDF...</span>
          </button>
          <hr className="menu-divider" />
          {onBackground && (
            <>
              <div className="menu-section">
                <div className="menu-label" id="background-label">
                  Background
                </div>
                <div
                  className="swatch-grid swatch-grid-row"
                  role="radiogroup"
                  aria-labelledby="background-label"
                >
                  {BACKGROUNDS.map((b) => {
                    const selected = b.value === background;
                    return (
                      <button
                        key={b.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={b.name}
                        title={b.name}
                        className={"swatch-btn" + (selected ? " selected" : "")}
                        onClick={() => onBackground(b.value)}
                      >
                        <span
                          className="swatch"
                          style={{ background: b.value }}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
              <hr className="menu-divider" />
            </>
          )}
          <ThemeSelector />
        </div>
      </Popover>
    </div>
  );
}
