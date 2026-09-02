import { useState } from "react";
import type { PDFLayout } from "../document/schema";

interface Props {
  fileName: string;
  pageCount: number;
  onCancel: () => void;
  onImport: (layout: PDFLayout) => void;
}

export function ImportPDFDialog({ fileName, pageCount, onCancel, onImport }: Props) {
  const [layout, setLayout] = useState<PDFLayout>("vertical");
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="import-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="import-title">Import PDF</h2>
        <p className="modal-file" title={fileName}>{fileName}</p>
        <p className="modal-meta">
          {pageCount} {pageCount === 1 ? "page" : "pages"}
        </p>
        <fieldset className="layout-choice">
          <legend>Arrange pages</legend>
          <label>
            <input type="radio" name="layout" value="vertical" checked={layout === "vertical"} onChange={() => setLayout("vertical")} />
            <span>Vertical</span>
            <span className="layout-hint">▯ ▯ ▯ stacked top to bottom</span>
          </label>
          <label>
            <input type="radio" name="layout" value="horizontal" checked={layout === "horizontal"} onChange={() => setLayout("horizontal")} />
            <span>Horizontal</span>
            <span className="layout-hint">▯▯▯ side by side</span>
          </label>
        </fieldset>
        <p className="modal-note">Pages are rendered in your browser and stored on this device. Nothing is uploaded.</p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary" autoFocus onClick={() => onImport(layout)}>Import</button>
        </div>
      </div>
    </div>
  );
}
