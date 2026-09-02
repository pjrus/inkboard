import type { CanvasDocument } from "../document/crdt";
import type { PDFLayout, PDFPageObject } from "../document/schema";
import { layoutPages } from "../pdf/PDFLayoutEngine";

interface Props {
  doc: CanvasDocument;
  page: PDFPageObject;
  onDeselect: () => void;
}

/** Small contextual bar shown while a PDF page is selected with the hand tool. */
export function PageSelectionBar({ doc, page, onDeselect }: Props) {
  const meta = doc.getPDFDocument(page.pdfDocumentId);
  const layout = meta?.layout ?? "vertical";

  const relayout = (next: PDFLayout) => {
    if (next === layout) return;
    const pages = doc.pagesOf(page.pdfDocumentId);
    if (pages.length === 0) return;
    const first = pages[0];
    const placements = layoutPages(pages, next, { x: first.x, y: first.y });
    doc.setPDFLayout(
      page.pdfDocumentId,
      next,
      pages.map((p, i) => ({ id: p.id, x: placements[i].x, y: placements[i].y })),
    );
  };

  return (
    <div className="selection-bar" role="toolbar" aria-label="Selected PDF page">
      <span className="selection-title" title={meta?.fileName}>
        {meta?.fileName ?? "PDF"} · page {page.pageNumber}
        {meta ? ` of ${meta.pageCount}` : ""}
      </span>
      <div className="segmented" role="radiogroup" aria-label="Page arrangement">
        <button type="button" role="radio" aria-checked={layout === "vertical"} className={layout === "vertical" ? "active" : ""} onClick={() => relayout("vertical")}>
          Vertical
        </button>
        <button type="button" role="radio" aria-checked={layout === "horizontal"} className={layout === "horizontal" ? "active" : ""} onClick={() => relayout("horizontal")}>
          Horizontal
        </button>
      </div>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => {
          doc.removeObjects([page.id]);
          onDeselect();
        }}
      >
        Delete page
      </button>
      <button
        type="button"
        className="btn btn-sm btn-danger"
        onClick={() => {
          if (window.confirm(`Remove all ${meta?.pageCount ?? ""} pages of ${meta?.fileName ?? "this PDF"} from the board?`)) {
            doc.removePDFDocument(page.pdfDocumentId);
            onDeselect();
          }
        }}
      >
        Remove PDF
      </button>
      <button type="button" className="btn btn-sm btn-ghost" aria-label="Deselect" onClick={onDeselect}>
        ✕
      </button>
    </div>
  );
}
