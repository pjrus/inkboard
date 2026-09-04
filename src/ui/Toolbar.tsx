import { useRef } from "react";
import type { Tool } from "../document/schema";
import { useToolStore } from "../store/toolStore";
import { AppMenu } from "./AppMenu";
import { ColourPicker } from "./ColourPicker";
import { FontSelector } from "./FontSelector";
import { FontSizeSelector } from "./FontSizeSelector";
import { TextAlignmentControls } from "./TextAlignmentControls";
import { ThicknessPicker } from "./ThicknessPicker";
import { LassoFilterControls } from "./LassoFilterControls";
import { ModeSwitch } from "./ModeSwitch";
import {
  EraserIcon,
  HandIcon,
  LassoIcon,
  PdfIcon,
  PenIcon,
  PencilIcon,
  RedoIcon,
  TextIcon,
  UndoIcon,
} from "./icons";

interface Props {
  onInsertPDF: (file: File) => void;
  onUndo: () => void;
  onRedo: () => void;
  onExportPDF: () => void;
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
  { tool: "lasso", label: "Lasso", key: "L", icon: LassoIcon },
  { tool: "text", label: "Text", key: "T", icon: TextIcon },
];

export function Toolbar({ onInsertPDF, onUndo, onRedo, onExportPDF }: Props) {
  const tool = useToolStore((s) => s.tool);
  const setTool = useToolStore((s) => s.setTool);
  const canvasMode = useToolStore((s) => s.canvasMode);
  const canUndo = useToolStore((s) => s.canUndo);
  const canRedo = useToolStore((s) => s.canRedo);
  const selection = useToolStore((s) => s.selection);
  const fileRef = useRef<HTMLInputElement>(null);

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

  // Which property controls make sense right now.
  //
  // Colour applies to everything, so it is always offered. Thickness appears
  // whenever the selection contains ink. Font, size and alignment appear only
  // for a text-only selection: a font picker over a selection that includes
  // handwriting would be offering something it cannot change.
  const hasSelection = selection !== null;
  const showStrokeControls = hasSelection
    ? selection.strokeIds.length > 0
    : tool !== "text";
  const showTextControls = hasSelection
    ? selection.textIds.length > 0 && selection.strokeIds.length === 0
    : tool === "text";

  return (
    <div className="toolbar" role="toolbar" aria-label="Drawing tools">
      <ModeSwitch />
      <span className="tb-sep" />
      <div className="tb-group" role="radiogroup" aria-label="Tool">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
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
        ))}
      </div>
      {tool === "lasso" && (
        <>
          <span className="tb-sep" />
          <LassoFilterControls />
        </>
      )}
      <span className="tb-sep" />
      <div
        className={"tb-group" + (hasSelection ? " tb-group-selection" : "")}
        title={hasSelection ? "Editing the selection" : undefined}
      >
        {hasSelection && <span className="tb-badge">Selection</span>}
        <ColourPicker />
        {showStrokeControls && <ThicknessPicker />}
        {showTextControls && <FontSelector />}
        {showTextControls && <FontSizeSelector />}
        {showTextControls && <TextAlignmentControls />}
      </div>
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
        <AppMenu onExportPDF={onExportPDF} />
      </div>
    </div>
  );
}
