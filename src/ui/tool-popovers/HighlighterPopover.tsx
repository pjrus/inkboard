import { useToolStore } from "../../store/toolStore";
import { HighlighterIcon } from "../icons";
import { InkColorPopover, type SwatchOption } from "./InkColorPopover";

const HIGHLIGHTER_PALETTE: SwatchOption[] = [
  { name: "Neon Yellow", value: "#ffe838" },
  { name: "Neon Green", value: "#51cf66" },
  { name: "Sky Blue", value: "#339af0" },
  { name: "Coral Pink", value: "#ff6b81" },
  { name: "Pastel Orange", value: "#ff922b" },
  { name: "Neon Violet", value: "#cc5de8" },
  { name: "Rose Red", value: "#fa5252" },
  { name: "Slate Grey", value: "#868e96" },
];

interface Props {
  onClose?: () => void;
}

export function HighlighterPopover(_props: Props = {}) {
  const color = useToolStore((s) => s.highlighterColor ?? s.color);
  const setHighlighterColor = useToolStore((s) => s.setHighlighterColor);
  const customColors = useToolStore((s) => s.customHighlighterColors ?? []);

  return (
    <InkColorPopover
      toolKey="highlighter"
      title="Highlighter"
      shortcut="M"
      icon={<HighlighterIcon color={color} />}
      sectionLabel="Highlighter Palette"
      palette={HIGHLIGHTER_PALETTE}
      color={color}
      onSelectColor={setHighlighterColor}
      customColors={customColors}
      addTitle="Add to highlighter palette"
      extraSections={
        <div className="tool-popover-section">
          <div className="tool-popover-label">Preview on Text</div>
          <div className="highlighter-preview-box">
            <div className="highlighter-preview-text">
              Important notes & key points
            </div>
            <div
              className="highlighter-preview-stroke"
              style={{
                height: "18px",
                backgroundColor: color,
              }}
            />
          </div>
        </div>
      }
      footer={
        <div className="tool-popover-hint">
          <span className="hint-bullet">●</span>
          <span>Translucent ink with multiply blend.</span>
        </div>
      }
    />
  );
}
