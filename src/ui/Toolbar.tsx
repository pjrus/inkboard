import { useRef } from "react";
import type { Tool } from "../document/schema";
import { useToolStore } from "../store/toolStore";
import { ColourPicker } from "./ColourPicker";
import { ThicknessPicker } from "./ThicknessPicker";
import { EraserIcon, HandIcon, LassoIcon, PdfIcon, PenIcon, PencilIcon, RedoIcon, UndoIcon } from "./icons";

interface Props {
  onInsertPDF: (file: File) => void;
  onUndo: () => void;
  onRedo: () => void;
}

const TOOLS: { tool: Tool; label: string; key: string; icon: () => JSX.Element }[] = [
  { tool: "pan", label: "Hand", key: "H", icon: HandIcon },
  { tool: "pen", label: "Pen", key: "P", icon: PenIcon },
  { tool: "pencil", label: "Pencil", key: "N", icon: PencilIcon },
  { tool: "eraser", label: "Eraser", key: "E", icon: EraserIcon },
  { tool: "lasso", label: "Lasso", key: "L", icon: LassoIcon },
];

export function Toolbar({ onInsertPDF, onUndo, onRedo }: Props) {
  const tool = useToolStore((s) => s.tool);
  const setTool = useToolStore((s) => s.setTool);
  const canUndo = useToolStore((s) => s.canUndo);
  const canRedo = useToolStore((s) => s.canRedo);
  const hasSelection = useToolStore((s) => s.strokeSelection !== null);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="toolbar" role="toolbar" aria-label="Drawing tools">
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
      <span className="tb-sep" />
      <div className={"tb-group" + (hasSelection ? " tb-group-selection" : "")} title={hasSelection ? "Editing selected strokes" : undefined}>
        {hasSelection && <span className="tb-badge">Selection</span>}
        <ColourPicker />
        <ThicknessPicker />
      </div>
      <span className="tb-sep" />
      <div className="tb-group">
        <button type="button" className="tb-btn" aria-label="Undo (⌘Z)" title="Undo (⌘Z)" disabled={!canUndo} onClick={onUndo}>
          <UndoIcon />
        </button>
        <button type="button" className="tb-btn" aria-label="Redo (⌘⇧Z)" title="Redo (⌘⇧Z)" disabled={!canRedo} onClick={onRedo}>
          <RedoIcon />
        </button>
      </div>
      <span className="tb-sep" />
      <div className="tb-group">
        <button type="button" className="tb-btn tb-btn-text" title="Insert PDF" onClick={() => fileRef.current?.click()}>
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
      </div>
    </div>
  );
}
