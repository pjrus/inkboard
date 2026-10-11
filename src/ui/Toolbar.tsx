import { type ReactNode, useRef, useState } from "react";
import type { Tool } from "../document/schema";
import { useToolStore } from "../store/toolStore";
import { AppMenu } from "./AppMenu";
import { ColourPicker } from "./ColourPicker";
import { FontSelector } from "./FontSelector";
import { FontSizeSelector } from "./FontSizeSelector";
import {
  ChevronIcon,
  EraserIcon,
  HandIcon,
  LassoIcon,
  PdfIcon,
  PencilIcon,
  PenIcon,
  RedoIcon,
  TextIcon,
  UndoIcon,
} from "./icons";
import { LassoFilterControls } from "./LassoFilterControls";
import { ModeSwitch } from "./ModeSwitch";
import { Popover } from "./Popover";
import { TextAlignmentControls } from "./TextAlignmentControls";
import { ThicknessPicker } from "./ThicknessPicker";

interface Props {
  onInsertPDF: (file: File) => void;
  onUndo: () => void;
  onRedo: () => void;
  onExportPDF: () => void;
  onBackground: (colour: string) => void;
}

const TOOLS: {
  tool: Tool;
  label: string;
  key: string;
  icon: () => JSX.Element;
}[] = [
  { tool: "pan", label: "Hand", key: "H", icon: HandIcon },
  { tool: "pen", label: "Pen", key: "P", icon: PenIcon },
  { tool: "pencil", label: "Pencil", key: "N", icon: PencilIcon },
  { tool: "eraser", label: "Eraser", key: "E", icon: EraserIcon },
  { tool: "strokeEraser", label: "Stroke eraser", key: "X", icon: EraserIcon },
  { tool: "lasso", label: "Lasso", key: "L", icon: LassoIcon },
  { tool: "text", label: "Text", key: "T", icon: TextIcon },
];

export function Toolbar({
  onInsertPDF,
  onUndo,
  onRedo,
  onExportPDF,
  onBackground,
}: Props) {
  const tool = useToolStore((s) => s.tool);
  const setTool = useToolStore((s) => s.setTool);
  const canvasMode = useToolStore((s) => s.canvasMode);
  const canUndo = useToolStore((s) => s.canUndo);
  const canRedo = useToolStore((s) => s.canRedo);
  const selection = useToolStore((s) => s.selection);
  const fileRef = useRef<HTMLInputElement>(null);
  const [openTool, setOpenTool] = useState<Tool | null>(null);

  /**
   * View mode strips the toolbar back to navigation: no tools, no property
   * pickers, no undo, no import. Nothing on the board can be changed from
   * here, which is the entire point of the mode.
   */
  if (canvasMode === "view") {
    return (
      <div className="toolbar" role="toolbar" aria-label="View mode">
        <ModeSwitch />
        <span className="tb-sep" />
        <span className="tb-badge" aria-live="polite">
          View mode &middot; editing off
        </span>
        <span className="tb-sep" />
        <div className="tb-group">
          <AppMenu onExportPDF={onExportPDF} />
        </div>
      </div>
    );
  }

  /**
   * Settings popover for a tool, or null when it has none. Pen and pencil
   * share one colour and width in the store, so both popovers edit those.
   * Selection edits (colour, thickness, text style) live with the lasso.
   */
  const toolSettings = (t: Tool): ReactNode => {
    if (t === "pen" || t === "pencil") {
      return (
        <>
          <div className="popover-hint">Colour</div>
          <ColourPicker inline scope="pen" />
          <div className="popover-hint">Thickness</div>
          <ThicknessPicker inline scope="pen" />
        </>
      );
    }
    if (t === "lasso") {
      return (
        <>
          <LassoFilterControls />
          {selection && (
            <>
              <div className="popover-hint">Selection colour</div>
              <ColourPicker inline scope="selection" />
              {selection.strokeIds.length > 0 && (
                <>
                  <div className="popover-hint">Selection thickness</div>
                  <ThicknessPicker inline />
                </>
              )}
              {selection.textIds.length > 0 && selection.strokeIds.length === 0
                && (
                  <div className="tb-group">
                    <FontSelector />
                    <FontSizeSelector />
                    <TextAlignmentControls />
                  </div>
                )}
            </>
          )}
        </>
      );
    }
    return null;
  };

  return (
    <div className="toolbar" role="toolbar" aria-label="Drawing tools">
      <ModeSwitch />
      <span className="tb-sep" />
      <div className="tb-group" role="radiogroup" aria-label="Tool">
        {TOOLS.map((t) => {
          const btn = (
            <button
              type="button"
              role="radio"
              aria-checked={tool === t.tool}
              aria-label={`${t.label} (${t.key})`}
              title={`${t.label} (${t.key})`}
              className={"tb-btn" + (tool === t.tool ? " active" : "")}
              onClick={() => setTool(t.tool)}
            >
              <t.icon />
            </button>
          );
          const settings = toolSettings(t.tool);
          if (!settings) {
            return <span key={t.tool} className="tb-contents">{btn}</span>;
          }
          const open = openTool === t.tool;
          return (
            <div key={t.tool} className="tb-anchor tb-split">
              {btn}
              <button
                type="button"
                className="tb-chev"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={`${t.label} settings`}
                title={`${t.label} settings`}
                onClick={() => setOpenTool(open ? null : t.tool)}
              >
                <ChevronIcon />
              </button>
              <Popover
                open={open}
                onClose={() => setOpenTool(null)}
                label={`${t.label} settings`}
              >
                {settings}
              </Popover>
            </div>
          );
        })}
      </div>
      <span className="tb-sep" />
      {tool === "text" && (
        <>
          <div className="tb-group">
            <ColourPicker />
            <FontSelector />
            <FontSizeSelector />
            <TextAlignmentControls />
          </div>
          <span className="tb-sep" />
        </>
      )}
      <span className="tb-sep" />
      <div className="tb-group">
        <button
          type="button"
          className="tb-btn"
          aria-label="Undo (Cmd+Z)"
          title="Undo (Cmd+Z)"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <UndoIcon />
        </button>
        <button
          type="button"
          className="tb-btn"
          aria-label="Redo (Cmd+Shift+Z)"
          title="Redo (Cmd+Shift+Z)"
          disabled={!canRedo}
          onClick={onRedo}
        >
          <RedoIcon />
        </button>
      </div>
      <span className="tb-sep" />
      <div className="tb-group">
        <button
          type="button"
          className="tb-btn tb-btn-text"
          title="Insert PDF"
          onClick={() => fileRef.current?.click()}
        >
          <PdfIcon />
          <span>Insert PDF</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onInsertPDF(f);
            e.target.value = "";
          }}
        />
        <AppMenu onExportPDF={onExportPDF} onBackground={onBackground} />
      </div>
    </div>
  );
}
