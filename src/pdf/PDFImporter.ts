import * as pdfjsLib from "pdfjs-dist";
import { newId } from "../document/ids";
import type { CanvasDocument } from "../document/crdt";
import type {
  PDFDocumentMetadata,
  PDFLayout,
  PDFPageObject,
} from "../document/schema";
import { putAsset } from "../storage/assetRepository";
import { layoutPages, type PageSize } from "./PDFLayoutEngine";

// PDF.js does its parsing/rendering work in a worker so the UI stays responsive.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).href;

/** Rasterisation limits: sharp when zoomed, but never absurdly large. */
const RASTER_SCALE = 2;
const MAX_RASTER_DIMENSION = 2800;
const JPEG_QUALITY = 0.86;

export interface InspectedPDF {
  pdf: pdfjsLib.PDFDocumentProxy;
  pageCount: number;
  sizes: PageSize[];
}

export async function inspectPDF(file: File): Promise<InspectedPDF> {
  if (
    file.type &&
    file.type !== "application/pdf" &&
    !file.name.toLowerCase().endsWith(".pdf")
  ) {
    throw new Error("That file does not look like a PDF.");
  }
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const sizes: PageSize[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    sizes.push({ width: vp.width, height: vp.height });
    page.cleanup();
  }
  return { pdf, pageCount: pdf.numPages, sizes };
}

export interface ImportOptions {
  boardId: string;
  doc: CanvasDocument;
  file: File;
  inspected: InspectedPDF;
  layout: PDFLayout;
  /** World-space top-left of the first page. */
  origin: { x: number; y: number };
  keepSource?: boolean;
  onProgress?: (done: number, total: number) => void;
  onPageReady?: (assetId: string) => void;
  /** Called once with every page asset id, before rasterisation begins. */
  onPagesPlanned?: (assetIds: string[]) => void;
  signal?: AbortSignal;
}

export interface ImportResult {
  pdfDocumentId: string;
  pages: PDFPageObject[];
  failedPages: number[];
}

/**
 * Insert a PDF into the board.
 *
 * All page objects are committed to the CRDT up front (one undo step) with
 * their final positions; they render as blank sheets until each page's
 * raster asset lands in IndexedDB, at which point `onPageReady` fires and the
 * renderer swaps the image in. Pages are rasterised sequentially to bound
 * memory use.
 */
export async function importPDF(opts: ImportOptions): Promise<ImportResult> {
  const {
    boardId,
    doc,
    file,
    inspected,
    layout,
    origin,
    onProgress,
    onPageReady,
    onPagesPlanned,
    signal,
  } = opts;
  const pdfDocumentId = newId(10);
  const placements = layoutPages(inspected.sizes, layout, origin);
  const now = Date.now();

  const pages: PDFPageObject[] = placements.map((p, i) => ({
    id: newId(),
    type: "pdf-page",
    assetId: `${pdfDocumentId}-p${i + 1}`,
    pdfDocumentId,
    pageNumber: i + 1,
    x: p.x,
    y: p.y,
    width: p.width,
    height: p.height,
    rotation: 0,
    createdAt: now,
  }));

  let sourceAssetId: string | undefined;
  if (opts.keepSource !== false) {
    sourceAssetId = `${pdfDocumentId}-src`;
    try {
      await putAsset({
        id: sourceAssetId,
        boardId,
        mimeType: "application/pdf",
        blob: file,
        size: file.size,
        createdAt: now,
      });
    } catch (err) {
      console.warn("Could not retain source PDF (continuing without it)", err);
      sourceAssetId = undefined;
    }
  }

  const meta: PDFDocumentMetadata = {
    id: pdfDocumentId,
    fileName: file.name,
    pageCount: inspected.pageCount,
    layout,
    sourceAssetId,
    createdAt: now,
  };
  onPagesPlanned?.(pages.map((p) => p.assetId));
  doc.addPDFDocument(meta, pages);

  const failedPages: number[] = [];
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false })!;

  for (let i = 0; i < pages.length; i++) {
    if (signal?.aborted) break;
    const pageObj = pages[i];
    try {
      const page = await inspected.pdf.getPage(pageObj.pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(
        RASTER_SCALE,
        MAX_RASTER_DIMENSION / Math.max(base.width, base.height),
      );
      const vp = page.getViewport({ scale });
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      page.cleanup();
      const blob = await canvasToBlob(canvas, "image/jpeg", JPEG_QUALITY);
      await putAsset({
        id: pageObj.assetId,
        boardId,
        mimeType: blob.type,
        blob,
        width: canvas.width,
        height: canvas.height,
        size: blob.size,
        createdAt: Date.now(),
      });
      onPageReady?.(pageObj.assetId);
    } catch (err) {
      console.error(`Failed to render page ${pageObj.pageNumber}`, err);
      failedPages.push(pageObj.pageNumber);
    }
    onProgress?.(i + 1, pages.length);
    // Yield to the event loop between pages so input stays responsive.
    await new Promise((r) => setTimeout(r, 0));
  }

  canvas.width = canvas.height = 0;
  await inspected.pdf.destroy();
  return { pdfDocumentId, pages, failedPages };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      type,
      quality,
    );
  });
}
