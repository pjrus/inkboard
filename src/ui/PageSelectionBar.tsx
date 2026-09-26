import type { CanvasDocument } from "../document/crdt";
import type { ImageObject, PDFLayout } from "../document/schema";
import { layoutPages } from "../pdf/PDFLayoutEngine";

interface Props {
  doc: CanvasDocument;
  page: ImageObject;
  onDeselect: () => void;
}

/**
 * Small contextual bar shown while an image is selected with the hand tool.
 * The PDF controls appear only for pages still attached to their import;
 * copies are plain images and only get Delete.
 */
export function PageSelectionBar({ doc, page, onDeselect }: Props) {
  const pdfId = page.pdfDocumentId;
  const meta = pdfId ? doc.getPDFDocument(pdfId) : undefined;
  const layout = meta?.layout ?? "vertical";

  const relayout = (next: PDFLayout) => {
    if (!pdfId || next === layout) return;
    const pages = doc.pagesOf(pdfId);
    if (pages.length === 0) return;
    const first = pages[0];
    const placements = layoutPages(pages, next, { x: first.x, y: first.y });
    doc.setPDFLayout(
      pdfId,
      next,
      pages.map((p, i) => ({
        id: p.id,
        x: placements[i].x,
        y: placements[i].y,
      })),
    );
  };

  return (
    <div
      className="selection-bar"
      role="toolbar"
      aria-label={meta ? "Selected PDF page" : "Selected image"}
    >
      <span className="selection-title" title={meta?.fileName}>
        {meta
          ? `${meta.fileName} · page ${page.pageNumber} of ${meta.pageCount}`
          : "Image"}
      </span>
      {meta && (
        <div
          className="segmented"
          role="radiogroup"
          aria-label="Page arrangement"
        >
          <button
            type="button"
            role="radio"
            aria-checked={layout === "vertical"}
            className={layout === "vertical" ? "active" : ""}
            onClick={() => relayout("vertical")}
          >
            Vertical
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={layout === "horizontal"}
            className={layout === "horizontal" ? "active" : ""}
            onClick={() => relayout("horizontal")}
          >
            Horizontal
          </button>
        </div>
      )}
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => {
          doc.removeObjects([page.id]);
          onDeselect();
        }}
      >
        {meta ? "Delete page" : "Delete"}
      </button>
      {pdfId && meta && (
        <button
          type="button"
          className="btn btn-sm btn-danger"
          onClick={() => {
            if (
              window.confirm(
                `Remove all ${
                  doc.pagesOf(pdfId).length
                } pages of ${meta.fileName} from the board?`,
              )
            ) {
              doc.removePDFDocument(pdfId);
              onDeselect();
            }
          }}
        >
          Remove PDF
        </button>
      )}
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        aria-label="Deselect"
        onClick={onDeselect}
      >
        ✕
      </button>
    </div>
  );
}
