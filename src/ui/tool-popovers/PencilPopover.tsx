import { PALETTE, useToolStore } from "../../store/toolStore";
import { PencilIcon } from "../icons";
import { InkColorPopover } from "./InkColorPopover";

interface Props {
  onClose?: () => void;
}

export function PencilPopover(_props: Props = {}) {
  const color = useToolStore((s) => s.pencilColor ?? s.color);
  const setPencilColor = useToolStore((s) => s.setPencilColor);
  const customColors = useToolStore((s) => s.customPencilColors ?? []);

  return (
    <InkColorPopover
      toolKey="pencil"
      title="Pencil"
      shortcut="N"
      icon={<PencilIcon color={color} />}
      sectionLabel="Lead Colour"
      palette={PALETTE}
      color={color}
      onSelectColor={setPencilColor}
      customColors={customColors}
      addTitle="Add to lead colours"
      footer={
        <div className="tool-popover-hint">
          <span className="hint-bullet">●</span>
          <span>82% textured opacity for natural graphite feel.</span>
        </div>
      }
    />
  );
}
