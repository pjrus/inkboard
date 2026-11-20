import { PALETTE, useToolStore } from "../../store/toolStore";
import { PenIcon } from "../icons";
import { InkColorPopover } from "./InkColorPopover";

interface Props {
  onClose?: () => void;
}

export function PenPopover(_props: Props = {}) {
  const color = useToolStore((s) => s.penColor ?? s.color);
  const setColor = useToolStore((s) => s.setColor);
  const customColors = useToolStore((s) => s.customPenColors ?? []);
  const stylusSeen = useToolStore((s) => s.stylusSeen);

  return (
    <InkColorPopover
      toolKey="pen"
      title="Pen"
      shortcut="P"
      icon={<PenIcon color={color} />}
      sectionLabel="Ink Colour"
      palette={PALETTE}
      color={color}
      onSelectColor={setColor}
      customColors={customColors}
      addTitle="Add to ink colours"
      footer={
        <>
          <div className="tool-popover-hint">
            <span className="hint-bullet">●</span>
            <span>
              {stylusSeen
                ? "Stylus connected · pressure active"
                : "Pressure dynamics supported with Apple Pencil / stylus."}
            </span>
          </div>
          <div className="tool-popover-hint">
            <span className="hint-bullet">●</span>
            <span>
              Press <strong>[</strong> or <strong>]</strong>{" "}
              to adjust thickness anytime.
            </span>
          </div>
        </>
      }
    />
  );
}
