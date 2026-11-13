import type { ImageObject } from "../document/schema";

interface Props {
  image: ImageObject;
  onReset: () => void;
  onCancel: () => void;
  onDone: () => void;
}

/**
 * Contextual bar shown while interactively cropping an image or PDF page.
 */
export function CropBar({ image, onReset, onCancel, onDone }: Props) {
  const label = image.pdfDocumentId ? "Cropping page" : "Cropping image";
  return (
    <div className="selection-bar" role="toolbar" aria-label={label}>
      <span className="selection-title">{label}</span>
      <button type="button" className="btn btn-sm" onClick={onReset}>
        Reset
      </button>
      <button type="button" className="btn btn-sm" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" className="btn btn-sm btn-primary" onClick={onDone}>
        Done
      </button>
    </div>
  );
}
