import { summarise } from "../document/strokeCommands";
import { THICKNESS_PRESETS, useToolStore } from "../store/toolStore";

export function ThicknessPicker() {
  const tool = useToolStore((s) => s.tool);
  const isHighlighter = tool === "highlighter";

  const penWidth = useToolStore((s) => s.width);
  const penColor = useToolStore((s) => s.color);
  const setPenWidth = useToolStore((s) => s.setWidth);

  const highlighterWidth = useToolStore((s) => s.highlighterWidth ?? s.width);
  const highlighterColor = useToolStore((s) => s.highlighterColor ?? s.color);
  const setHighlighterWidth = useToolStore((s) => s.setHighlighterWidth);

  const rawSelection = useToolStore((s) => s.selection);
  const commands = useToolStore((s) => s.selectionCommands);

  // Thickness applies to handwriting: selection with ink, or pen/pencil/highlighter
  const selection = rawSelection && rawSelection.strokeIds.length > 0
    ? rawSelection
    : null;
  const wSummary = selection ? summarise(selection.widths) : null;
  const cSummary = selection ? summarise(selection.colors) : null;
  const mixed = wSummary?.mixed ?? false;

  const width = wSummary
    ? (wSummary.value ?? penWidth)
    : isHighlighter
    ? highlighterWidth
    : penWidth;

  const color = cSummary
    ? (cSummary.value ?? "#1b1b1f")
    : isHighlighter
    ? highlighterColor
    : penColor;

  const setWidth = (w: number) => {
    if (selection && commands) commands.setWidth(w);
    else if (isHighlighter) setHighlighterWidth(w);
    else setPenWidth(w);
  };

  const displayWidth = isHighlighter
    ? `${Math.round(width * 5)}px`
    : `${width}px`;

  return (
    <div
      className="tb-thickness-widget"
      role="radiogroup"
      aria-label="Stroke thickness"
    >
      <div className="tb-thickness-pills">
        {THICKNESS_PRESETS.map((p) => {
          const selected = !mixed && Math.abs(p.value - width) < 0.2;
          const nib = isHighlighter ? Math.round(p.value * 5) : p.value;
          return (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${p.name} (${nib}px)`}
              title={`${p.name}: ${nib}px`}
              className={"tb-thickness-btn" + (selected ? " active" : "")}
              onClick={() => setWidth(p.value)}
            >
              <span
                className="tb-thickness-bar"
                style={{
                  height: `${
                    Math.min(
                      12,
                      Math.max(
                        2,
                        isHighlighter ? p.value * 1.4 : p.value * 1.3,
                      ),
                    )
                  }px`,
                  background: color,
                  opacity: tool === "pencil" ? 0.82 : 1,
                }}
              />
              <span className="tb-thickness-label">{p.name}</span>
            </button>
          );
        })}
      </div>
      <span className="tb-thickness-badge" title="Current stroke thickness">
        {mixed ? "Mixed" : displayWidth}
      </span>
    </div>
  );
}
