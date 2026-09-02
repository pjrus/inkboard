import { summarise } from "../document/strokeCommands";
import type { TextAlign } from "../document/schema";
import { useToolStore } from "../store/toolStore";
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon } from "./icons";

const OPTIONS: { value: TextAlign; label: string; icon: () => JSX.Element }[] = [
  { value: "left", label: "Align left", icon: AlignLeftIcon },
  { value: "center", label: "Align centre", icon: AlignCenterIcon },
  { value: "right", label: "Align right", icon: AlignRightIcon },
];

/** Left / centre / right only. Justified text is out of scope by design. */
export function TextAlignmentControls() {
  const toolAlign = useToolStore((s) => s.textAlign);
  const setToolAlign = useToolStore((s) => s.setTextAlign);
  const selection = useToolStore((s) => s.selection);
  const commands = useToolStore((s) => s.selectionCommands);

  const editingSelection = !!selection && selection.textIds.length > 0;
  const summary = editingSelection ? summarise(selection.aligns) : null;
  const align = summary ? ((summary.value as TextAlign | null) ?? undefined) : toolAlign;
  const apply = (a: TextAlign) => {
    if (editingSelection && commands) commands.setAlign(a);
    else setToolAlign(a);
  };

  return (
    <div className="segmented" role="radiogroup" aria-label={editingSelection ? "Selection alignment" : "Text alignment"}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={align === o.value}
          aria-label={o.label}
          title={o.label}
          className={"segmented-icon" + (align === o.value ? " active" : "")}
          onClick={() => apply(o.value)}
        >
          <o.icon />
        </button>
      ))}
    </div>
  );
}
