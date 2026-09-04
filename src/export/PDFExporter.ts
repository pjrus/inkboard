import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { CanvasObject } from "../document/schema";
import { ExportResources, renderPage } from "./ExportRenderer";
import {
  planPages,
  type ExportLayout,
  type ExportOrientation,
} from "./exportPlan";

/**
 * Client-side PDF export.
 *
 * Everything happens in this tab: geometry comes from the CRDT document,
 * page images come from IndexedDB, fonts come from the bundled WOFF files.
 * Nothing is uploaded, no conversion service is contacted, and the whole thing
 * works with the network switched off - the same promise the rest of the app
 * makes about your handwriting.
 */

export interface ExportOptions {
  objects: CanvasObject[];
  boardName: string;
  layout: ExportLayout;
  orientation?: ExportOrientation;
  onProgress?: (done: number, total: number, label: string) => void;
  signal?: AbortSignal;
}

export interface ExportResult {
  bytes: Uint8Array;
  fileName: string;
  pageCount: number;
}

export class ExportError extends Error {}

export async function exportToPDF(
  options: ExportOptions,
): Promise<ExportResult> {
  const {
    objects,
    boardName,
    layout,
    orientation = "auto",
    onProgress,
    signal,
  } = options;
  const plan = planPages(objects, layout, orientation);
  if (plan.length === 0)
    throw new ExportError("There is nothing on this board to export yet.");

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(boardName);
  pdf.setCreator("Inkboard");
  pdf.setProducer("Inkboard");

  const resources = new ExportResources(pdf);
  onProgress?.(0, plan.length, plan[0].label);
  for (let i = 0; i < plan.length; i++) {
    if (signal?.aborted) throw new ExportError("Export cancelled.");
    const geometry = plan[i];
    const page = pdf.addPage([geometry.pageWidth, geometry.pageHeight]);
    await renderPage(page, objects, geometry, resources);
    onProgress?.(i + 1, plan.length, geometry.label);
    // Yield between pages so a large board does not freeze the UI.
    await new Promise((r) => setTimeout(r, 0));
  }

  const bytes = await pdf.save({ useObjectStreams: true });
  return { bytes, fileName: pdfFileName(boardName), pageCount: plan.length };
}

/** A board name turned into a filename that every OS will accept. */
export function pdfFileName(boardName: string): string {
  const cleaned = boardName
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Leading dots would make a hidden file, and are all that survives of a
    // path such as "../../etc/passwd" once the separators are gone.
    .replace(/^[.\s]+/, "")
    .slice(0, 80)
    .trim();
  return `${cleaned || "Untitled board"}.pdf`;
}

/** Hand the finished bytes to the browser's download machinery. */
export function downloadPDF(result: ExportResult): void {
  const blob = new Blob([result.bytes.slice().buffer], {
    type: "application/pdf",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = result.fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
