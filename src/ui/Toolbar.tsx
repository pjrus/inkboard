import { useRef, useState } from "react";
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
  HighlighterIcon,
  LassoIcon,
  ObjectEraserIcon,
  PdfIcon,
  PencilIcon,
  PenIcon,
  RedoIcon,
  TextIcon,
  UndoIcon,
} from "./icons";
import { ModeSwitch } from "./ModeSwitch";
import { Popover } from "./Popover";
import { TextAlignmentControls } from "./TextAlignmentControls";
import { TextBackgroundPicker } from "./TextBackgroundPicker";
import { ThicknessPicker } from "./ThicknessPicker";
import { EraserPopover } from "./tool-popovers/EraserPopover";
import { HandPopover } from "./tool-popovers/HandPopover";
import { HighlighterPopover } from "./tool-popovers/HighlighterPopover";
import { LassoPopover } from "./tool-popovers/LassoPopover";
import { PencilPopover } from "./tool-popovers/PencilPopover";
import { PenPopover } from "./tool-popovers/PenPopover";
import { TextPopover } from "./tool-popovers/TextPopover";

interface Props {
  onInsertPDF: (file: File) => void;
  onUndo: () => void;
  onRedo: () => void;
  onExportPDF: () => void;
  onBackground: (colour: string) => void;
}

interface ToolDefinition {
  tool: Tool;
  label: string;
  key: string;
  icon: (props?: { color?: string; }) => JSX.Element;
}

const TOOLS: ToolDefinition[] = [
  { tool: "pan", label: "Hand", key: "H", icon: HandIcon },
  { tool: "pen", label: "Pen", key: "P", icon: PenIcon },
  { tool: "pencil", label: "Pencil", key: "N", icon: PencilIcon },
  {
    tool: "highlighter",
    label: "Highlighter",
    key: "M",
    icon: HighlighterIcon,
  },
  { tool: "eraser", label: "Eraser", key: "E", icon: EraserIcon },
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

  // Colors for tool icon tinting
  const penColor = useToolStore((s) => s.color);
  const pencilColor = useToolStore((s) => s.pencilColor ?? s.color);
  const highlighterColor = useToolStore((s) => s.highlighterColor ?? s.color);

  const fileRef = useRef<HTMLInputElement>(null);
  const [openPopover, setOpenPopover] = useState<Tool | null>(null);

  /**
   * View mode strips the toolbar back to navigation: no tools, no property
   * pickers, no undo, no import.
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

  const hasSelection = selection !== null;
  const showStrokeControls = hasSelection
    ? selection.strokeIds.length > 0
    : tool === "pen" || tool === "pencil" || tool === "highlighter";
  const showTextControls = hasSelection
    ? selection.textIds.length > 0 && selection.strokeIds.length === 0
    : false;

  const isToolActive = (t: Tool) => {
    if (t === "eraser") return tool === "eraser" || tool === "strokeEraser";
    return tool === t;
  };

  const handleToolClick = (targetTool: Tool) => {
    const active = isToolActive(targetTool);
    if (!active) {
      setTool(targetTool);
      setOpenPopover(null);
    } else {
      // Clicking already active tool toggles its GoodNotes popover
      setOpenPopover((prev) => (prev === targetTool ? null : targetTool));
    }
  };

  const renderToolPopover = (t: Tool) => {
    const close = () => setOpenPopover(null);
    switch (t) {
      case "highlighter":
        return <HighlighterPopover onClose={close} />;
      case "pen":
        return <PenPopover onClose={close} />;
      case "pencil":
        return <PencilPopover onClose={close} />;
      case "eraser":
      case "strokeEraser":
        return <EraserPopover onClose={close} />;
      case "lasso":
        return <LassoPopover onClose={close} />;
      case "text":
        return <TextPopover onClose={close} />;
      case "pan":
        return <HandPopover onClose={close} />;
      default:
        return null;
    }
  };

  return (
    <div className="toolbar" role="toolbar" aria-label="Drawing tools">
      <ModeSwitch />
      <span className="tb-sep" />

      {/* Tool items with GoodNotes style pills and popovers */}
      <div className="tb-group" role="radiogroup" aria-label="Tool">
        {TOOLS.map((t) => {
          const active = isToolActive(t.tool);
          const isPopoverOpen = openPopover === t.tool;
          const displayColor = t.tool === "highlighter"
            ? highlighterColor
            : t.tool === "pencil"
            ? pencilColor
            : t.tool === "pen"
            ? penColor
            : undefined;

          const activeLabel = t.tool === "eraser" && tool === "strokeEraser"
            ? "Object Eraser"
            : t.label;

          const ToolIcon = t.tool === "eraser" && tool === "strokeEraser"
            ? ObjectEraserIcon
            : t.icon;

          return (
            <div className="tb-anchor" key={t.tool}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                aria-haspopup="dialog"
                aria-expanded={isPopoverOpen}
                aria-label={`${activeLabel} (${t.key})${
                  active ? " - click to open options" : ""
                }`}
                title={`${activeLabel} (${t.key})${
                  active ? " · Click for options" : ""
                }`}
                className={"tb-tool-btn" + (active ? " active" : "")}
                onClick={() => handleToolClick(t.tool)}
              >
                <ToolIcon color={displayColor} />
                {active && (
                  <span
                    className={"tb-tool-chevron"
                      + (isPopoverOpen ? " open" : "")}
                    aria-hidden="true"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenPopover((
                        prev,
                      ) => (prev === t.tool ? null : t.tool));
                    }}
                  >
                    <ChevronIcon />
                  </span>
                )}
              </button>

              {isPopoverOpen && (
                <Popover
                  open={true}
                  onClose={() => setOpenPopover(null)}
                  label={`${t.label} options`}
                >
                  {renderToolPopover(t.tool)}
                </Popover>
              )}
            </div>
          );
        })}
      </div>

      {/* Toolbar stroke thickness (or contextual selection controls) */}
      {hasSelection
        ? (
          <>
            <span className="tb-sep" />
            <div
              className="tb-group tb-group-selection"
              title="Editing the selection"
            >
              <span className="tb-badge">Selection</span>
              <ColourPicker />
              {showStrokeControls && <ThicknessPicker />}
              {showTextControls && <FontSelector />}
              {showTextControls && <FontSizeSelector />}
              {showTextControls && <TextAlignmentControls />}
              {showTextControls && <TextBackgroundPicker />}
            </div>
          </>
        )
        : showStrokeControls
        ? (
          <>
            <span className="tb-sep" />
            <div className="tb-group" aria-label="Stroke thickness">
              <ThicknessPicker />
            </div>
          </>
        )
        : null}

      <span className="tb-sep" />

      {/* Undo & Redo */}
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

      {/* PDF and Menu */}
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
