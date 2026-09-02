import { useEffect, useState } from "react";
import type { CanvasObject } from "../document/schema";
import { hasImportedPages, planPages, type ExportLayout } from "./exportPlan";

export interface ExportChoice {
  scope: "all" | "selection";
  layout: ExportLayout;
}

interface Props {
  objects: CanvasObject[];
  selectedObjects: CanvasObject[];
  busy: { done: number; total: number; label: string } | null;
  error: string | null;
  onCancel: () => void;
  onExport: (choice: ExportChoice) => void;
}

/**
 * Deliberately small: what to export and how to lay it out. Everything else
 * (page size, scaling, ordering) follows from those two answers.
 */
export function ExportDialog({ objects, selectedObjects, busy, error, onCancel, onExport }: Props) {
  const canExportSelection = selectedObjects.length > 0;
  const [scope, setScope] = useState<"all" | "selection">(canExportSelection ? "selection" : "all");
  const subject = scope === "selection" ? selectedObjects : objects;
  const pdfPagesAvailable = hasImportedPages(subject);
  const [layout, setLayout] = useState<ExportLayout>(pdfPagesAvailable ? "pdf-pages" : "fit");

  useEffect(() => {
    if (!pdfPagesAvailable && layout === "pdf-pages") setLayout("fit");
  }, [pdfPagesAvailable, layout]);

  const pageCount = planPages(subject, layout).length;
  const disabled = busy !== null || subject.length === 0;

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="export-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="export-title">Export PDF</h2>
        <p className="modal-meta">Generated on this device. Nothing is uploaded.</p>

        <fieldset className="layout-choice" disabled={busy !== null}>
          <legend>Content</legend>
          <label>
            <input type="radio" name="scope" checked={scope === "all"} onChange={() => setScope("all")} />
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
            <span className="layout-hint">{canExportSelection ? `${selectedObjects.length} selected` : "nothing selected"}</span>
          </label>
        </fieldset>

        <fieldset className="layout-choice" disabled={busy !== null}>
          <legend>Pages</legend>
          <label>
            <input type="radio" name="layout" checked={layout === "fit"} onChange={() => setLayout("fit")} />
            <span>Fit content</span>
            <span className="layout-hint">one page, canvas size</span>
          </label>
          <label>
            <input type="radio" name="layout" checked={layout === "a4"} onChange={() => setLayout("a4")} />
            <span>A4 pages</span>
            <span className="layout-hint">scaled to width, paginated</span>
          </label>
          <label>
            <input
              type="radio"
              name="layout"
              disabled={!pdfPagesAvailable}
              checked={layout === "pdf-pages"}
              onChange={() => setLayout("pdf-pages")}
            />
            <span>Match PDF pages</span>
            <span className="layout-hint">{pdfPagesAvailable ? "one page per import" : "no imported PDF"}</span>
          </label>
        </fieldset>

        {error ? (
          <p className="modal-note modal-error" role="alert">
            {error}
          </p>
        ) : busy ? (
          <div className="export-progress" role="status" aria-live="polite">
            <div className="toast-meta">
              Preparing PDF... {busy.label} ({busy.done} / {busy.total})
            </div>
            <div className="progress" aria-hidden="true">
              <div className="progress-bar" style={{ width: `${busy.total ? (busy.done / busy.total) * 100 : 0}%` }} />
            </div>
          </div>
        ) : (
          <p className="modal-note">
            {subject.length === 0
              ? "Nothing to export yet."
              : `${pageCount} ${pageCount === 1 ? "page" : "pages"}. Toolbars and selection outlines are never included.`}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn" disabled={busy !== null} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => onExport({ scope, layout })}>
            {busy ? "Exporting..." : "Export PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
