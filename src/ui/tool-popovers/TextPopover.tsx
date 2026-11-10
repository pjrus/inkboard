import type { FontFamilyId, TextAlign } from "../../document/schema";
import { summarise } from "../../document/strokeCommands";
import {
  PALETTE,
  TEXT_BACKGROUND_PALETTE,
  useToolStore,
} from "../../store/toolStore";
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  TextIcon,
} from "../icons";

interface Props {
  onClose?: () => void;
}

const FONTS: { id: FontFamilyId; label: string; sample: string; }[] = [
  { id: "inter", label: "Inter", sample: "Clean & modern" },
  { id: "roboto", label: "Roboto", sample: "Balanced grotesque" },
  { id: "open-sans", label: "Open Sans", sample: "Humanist & open" },
  { id: "lato", label: "Lato", sample: "Warm corporate" },
];

const FONT_SIZES = [14, 18, 24, 32, 48, 64];

export function TextPopover(_props: Props = {}) {
  const font = useToolStore((s) => s.textFont);
  const setFont = useToolStore((s) => s.setTextFont);
  const size = useToolStore((s) => s.textFontSize);
  const setSize = useToolStore((s) => s.setTextFontSize);
  const color = useToolStore((s) => s.textColor);
  const setColor = useToolStore((s) => s.setTextColor);
  const align = useToolStore((s) => s.textAlign);
  const setAlign = useToolStore((s) => s.setTextAlign);
  const textBg = useToolStore((s) => s.textBackgroundColor);
  const setTextBg = useToolStore((s) => s.setTextBackgroundColor);

  const selection = useToolStore((s) => s.selection);
  const commands = useToolStore((s) => s.selectionCommands);
  const editingSelection = !!selection && selection.textIds.length > 0;

  const summaryBg = editingSelection && selection.backgroundColors
    ? summarise(selection.backgroundColors)
    : null;
  const currentBg = editingSelection && summaryBg && !summaryBg.mixed
    ? (summaryBg.value ?? undefined)
    : textBg;
  const isTransparent = !currentBg || currentBg === "transparent";

  const applyFont = (f: FontFamilyId) => {
    if (editingSelection && commands) commands.setFont(f);
    setFont(f);
  };

  const applySize = (sz: number) => {
    if (editingSelection && commands) commands.setFontSize(sz);
    setSize(sz);
  };

  const applyColor = (c: string) => {
    if (editingSelection && commands) commands.setColor(c);
    setColor(c);
  };

  const applyAlign = (a: TextAlign) => {
    if (editingSelection && commands) commands.setAlign(a);
    setAlign(a);
  };

  const applyBg = (bg?: string) => {
    if (editingSelection && commands) commands.setTextBackground(bg);
    setTextBg(bg);
  };

  return (
    <div className="tool-popover" role="dialog" aria-label="Text settings">
      <div className="tool-popover-header">
        <div className="tool-popover-title">
          <TextIcon />
          <span>Text Tool</span>
        </div>
        <kbd className="tb-kbd" title="Shortcut">T</kbd>
      </div>

      <div className="tool-popover-section">
        <div className="tool-popover-label">Font Family</div>
        <div className="font-pills" role="radiogroup" aria-label="Font family">
          {FONTS.map((f) => {
            const isSelected = font === f.id;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                className={"font-pill font-" + f.id
                  + (isSelected ? " selected" : "")}
                onClick={() => applyFont(f.id)}
              >
                <span className="font-pill-name">{f.label}</span>
                <span className="font-pill-sample">{f.sample}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="tool-popover-section">
        <div className="tool-popover-label">
          <span>Font Size</span>
          <span className="tool-popover-val">{size}px</span>
        </div>
        <div className="font-size-row" role="radiogroup" aria-label="Font size">
          {FONT_SIZES.map((sz) => {
            const isSelected = size === sz;
            return (
              <button
                key={sz}
                type="button"
                role="radio"
                aria-checked={isSelected}
                className={"font-size-pill" + (isSelected ? " selected" : "")}
                onClick={() => applySize(sz)}
              >
                {sz}
              </button>
            );
          })}
        </div>
      </div>

      <div className="tool-popover-section">
        <div className="tool-popover-label">Text Colour</div>
        <div
          className="swatch-grid swatch-grid-row"
          role="radiogroup"
          aria-label="Text color"
        >
          {PALETTE.map((p) => {
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
                onClick={() => applyColor(p.value)}
              >
                <span className="swatch" style={{ background: p.value }} />
              </button>
            );
          })}
        </div>
        <div className="custom-colour">
          <span>Custom colour</span>
          <div className="custom-colour-row">
            <span className="hex-display">{color}</span>
            <input
              type="color"
              aria-label="Text custom colour"
              value={color}
              onChange={(e) => applyColor(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="tool-popover-section">
        <div className="tool-popover-label">
          <span>Background Colour</span>
          {editingSelection && summaryBg?.mixed && (
            <span className="tool-popover-val">Mixed</span>
          )}
        </div>
        <div
          className="swatch-grid swatch-grid-row"
          role="radiogroup"
          aria-label="Text background colour"
        >
          {TEXT_BACKGROUND_PALETTE.map((p) => {
            const isNone = p.value === "transparent";
            const isSelected = !summaryBg?.mixed
              && (isNone
                ? isTransparent
                : !isTransparent
                  && currentBg?.toLowerCase() === p.value.toLowerCase());
            return (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={p.name}
                title={p.name}
                className={"swatch-btn" + (isSelected ? " selected" : "")}
                onClick={() => applyBg(isNone ? undefined : p.value)}
              >
                {isNone
                  ? <span className="swatch swatch-transparent" />
                  : <span className="swatch" style={{ background: p.value }} />}
              </button>
            );
          })}
        </div>
        <div className="custom-colour">
          <span>Custom colour</span>
          <div className="custom-colour-row">
            <span className="hex-display">
              {isTransparent ? "None" : currentBg}
            </span>
            <input
              type="color"
              aria-label="Text custom background colour"
              value={isTransparent ? "#ffffff" : currentBg}
              onChange={(e) => applyBg(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="tool-popover-section">
        <div className="tool-popover-label">Alignment</div>
        <div
          className="segmented-controls"
          role="radiogroup"
          aria-label="Text alignment"
        >
          <button
            type="button"
            role="radio"
            aria-checked={align === "left"}
            aria-label="Align left"
            className={"seg-btn" + (align === "left" ? " active" : "")}
            onClick={() => applyAlign("left")}
          >
            <AlignLeftIcon />
            <span>Left</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={align === "center"}
            aria-label="Align center"
            className={"seg-btn" + (align === "center" ? " active" : "")}
            onClick={() => applyAlign("center")}
          >
            <AlignCenterIcon />
            <span>Center</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={align === "right"}
            aria-label="Align right"
            className={"seg-btn" + (align === "right" ? " active" : "")}
            onClick={() => applyAlign("right")}
          >
            <AlignRightIcon />
            <span>Right</span>
          </button>
        </div>
      </div>

      <div className="tool-popover-footer">
        <div className="tool-popover-hint">
          <span className="hint-bullet">●</span>
          <span>
            Click anywhere to type. Drag right handle to adjust wrap width.
          </span>
        </div>
      </div>
    </div>
  );
}
