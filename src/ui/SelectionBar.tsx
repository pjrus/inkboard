import { summarise } from "../document/strokeCommands";
import { useToolStore } from "../store/toolStore";
import { RotateIcon } from "./icons";

/** A quarter turn, in radians: the useful preset for pages and images. */
const QUARTER_TURN = Math.PI / 2;

function formatWidth(w: number) {
  return Number.isInteger(w) ? String(w) : w.toFixed(1);
}

/**
 * Contextual bar for the current selection.
 *
 * It only offers what the selection actually supports: thickness for
 * handwriting, "Edit text" for a single text box, and move/delete for
 * everything. Font and size controls live in the toolbar, which already knows
 * to hide them when the selection contains handwriting.
 */
export function SelectionBar() {
  const selection = useToolStore((s) => s.selection);
  const commands = useToolStore((s) => s.selectionCommands);
  const editing = useToolStore((s) => s.editingTextId);
  if (!selection || !commands || editing) return null;

  const { value, mixed } = summarise(selection.widths);
  const n = selection.ids.length;
  const strokes = selection.strokeIds.length;
  const texts = selection.textIds.length;
  const images = selection.imageIds.length;
  const kinds = [strokes && "ink", texts && "text", images && "images"].filter(
    Boolean,
  ).length;
  const what =
    kinds > 1
      ? `${n} items`
      : texts
        ? `${texts} text ${texts === 1 ? "box" : "boxes"}`
        : images
          ? `${images} ${images === 1 ? "image" : "images"}`
          : `${n} ${n === 1 ? "item" : "items"}`;

  return (
    <div className="selection-bar" role="toolbar" aria-label="Selection">
      <span className="selection-title">{what} selected</span>
      {strokes > 0 && (
        <div className="stepper" role="group" aria-label="Thickness">
          <button
            type="button"
            aria-label="Thinner ([)"
            title="Thinner ([)"
            onClick={() => commands.adjustWidth(-1)}
          >
            &minus;
          </button>
          <span className="stepper-value" aria-live="polite">
            {mixed ? "Mixed" : formatWidth(value ?? 0)}
          </span>
          <button
            type="button"
            aria-label="Thicker (])"
            title="Thicker (])"
            onClick={() => commands.adjustWidth(1)}
          >
            +
          </button>
        </div>
      )}
      <div className="stepper" role="group" aria-label="Rotate">
        <button
          type="button"
          aria-label="Rotate 90° left"
          title="Rotate 90° left"
          onClick={() => commands.rotate(-QUARTER_TURN)}
        >
          &#8630;
        </button>
        <span className="stepper-value stepper-icon" aria-hidden="true">
          <RotateIcon />
        </span>
        <button
          type="button"
          aria-label="Rotate 90° right"
          title="Rotate 90° right"
          onClick={() => commands.rotate(QUARTER_TURN)}
        >
          &#8631;
        </button>
      </div>
      {texts === 1 && strokes === 0 && images === 0 && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => commands.editText()}
        >
          Edit text
        </button>
      )}
      <button
        type="button"
        className="btn btn-sm btn-danger"
        onClick={() => commands.remove()}
      >
        Delete
      </button>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        aria-label="Deselect (Esc)"
        onClick={() => commands.clear()}
      >
        &#10005;
      </button>
    </div>
  );
}
