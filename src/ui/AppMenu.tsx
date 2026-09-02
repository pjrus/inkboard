import { useState } from "react";
import { Popover } from "./Popover";
import { ThemeSelector } from "./ThemeSelector";
import { ExportIcon, MenuIcon } from "./icons";

interface Props {
  onExportPDF: () => void;
}

/**
 * Overflow menu for board-level actions and preferences. Appearance lives
 * here rather than on the drawing toolbar: it is set once, not per stroke.
 */
export function AppMenu({ onExportPDF }: Props) {
  const [open, setOpen] = useState(false);
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
          <ThemeSelector />
        </div>
      </Popover>
    </div>
  );
}
