import { useState } from "react";
import type { CanvasObject } from "../document/schema";

export interface ExportChoice {
  scope: "all" | "selection";
}

interface Props {
  objects: CanvasObject[];
  selectedObjects: CanvasObject[];
  busy: { done: number; total: number; label: string; } | null;
  error: string | null;
  onCancel: () => void;
  onExport: (choice: ExportChoice) => void;
}

/**
 * Deliberately small: the only question is what to export. It always comes
 * out as one page the size of the content.
 */
export function ExportDialog({
  objects,
  selectedObjects,
  busy,
  error,
  onCancel,
  onExport,
}: Props) {
  const canExportSelection = selectedObjects.length > 0;
  const [scope, setScope] = useState<"all" | "selection">(
    canExportSelection ? "selection" : "all",
  );
  const subject = scope === "selection" ? selectedObjects : objects;
  const disabled = busy !== null || subject.length === 0;

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="export-title">Export PDF</h2>
        <p className="modal-meta">
          Generated on this device. Nothing is uploaded.
        </p>

        <fieldset className="layout-choice" disabled={busy !== null}>
          <legend>Content</legend>
          <label>
            <input
              type="radio"
              name="scope"
              checked={scope === "all"}
              onChange={() => setScope("all")}
            />
            <span>Entire canvas</span>
            <span className="layout-hint">{objects.length} objects</span>
          </label>
          <label>
            <input
              type="radio"
              name="scope"
              disabled={!canExportSelection}
              checked={scope === "selection"}
              onChange={() => setScope("selection")}
            />
            <span>Selection</span>
            <span className="layout-hint">
              {canExportSelection
                ? `${selectedObjects.length} selected`
                : "nothing selected"}
            </span>
          </label>
        </fieldset>

        {error
          ? (
            <p className="modal-note modal-error" role="alert">
              {error}
            </p>
          )
          : busy
          ? (
            <div className="export-progress" role="status" aria-live="polite">
              <div className="toast-meta">
                Preparing PDF... {busy.label} ({busy.done} / {busy.total})
              </div>
              <div className="progress" aria-hidden="true">
                <div
                  className="progress-bar"
                  style={{
                    width: `${
                      busy.total ? (busy.done / busy.total) * 100 : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )
          : (
            <p className="modal-note">
              {subject.length === 0
                ? "Nothing to export yet."
                : "One page sized to the content. Toolbars and selection outlines are never included."}
            </p>
          )}

        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={disabled}
            onClick={() => onExport({ scope })}
          >
            {busy ? "Exporting..." : "Export PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
