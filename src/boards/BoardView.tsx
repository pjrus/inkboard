import { useCallback, useEffect, useRef, useState } from "react";
import { isTypingTarget } from "../canvas/CanvasInteractionController";
import { type CanvasHandles, CanvasViewport } from "../canvas/CanvasViewport";
import {
  DEFAULT_VIEWPORT,
  screenLengthToWorld,
  screenToWorld,
  zoomAt,
} from "../canvas/coordinates";
import { importImage, isImageFile } from "../canvas/imageImport";
import type {
  CanvasObject,
  ImageObject,
  PDFLayout,
  Viewport,
} from "../document/schema";
import { type ExportChoice, ExportDialog } from "../export/ExportDialog";
import { importPDF, type InspectedPDF, inspectPDF } from "../pdf/PDFImporter";
import { useToolStore } from "../store/toolStore";
import { CropBar } from "../ui/CropBar";
import { ImportPDFDialog } from "../ui/ImportPDFDialog";
import { ImportProgressToast } from "../ui/ImportProgressToast";
import { PageSelectionBar } from "../ui/PageSelectionBar";
import { SelectionBar } from "../ui/SelectionBar";
import { StatusChip } from "../ui/StatusChip";
import { Toolbar } from "../ui/Toolbar";
import { ZoomControls } from "../ui/ZoomControls";
import { boardRepository } from "./BoardRepository";
import { BoardSession } from "./BoardSession";
import { copyToClipboard, hasClipboard, pasteClipboard } from "./clipboard";

interface Props {
  boardId: string;
  onBack: () => void;
}

interface ExportState {
  busy: { done: number; total: number; label: string; } | null;
  error: string | null;
}

export function BoardView({ boardId, onBack }: Props) {
  const [session, setSession] = useState<BoardSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [pendingImport, setPendingImport] = useState<
    {
      file: File;
      inspected: InspectedPDF;
    } | null
  >(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportState, setExportState] = useState<ExportState>({
    busy: null,
    error: null,
  });
  const handlesRef = useRef<CanvasHandles | null>(null);
  const sessionRef = useRef<BoardSession | null>(null);
  const selectedId = useToolStore((s) => s.selectedObjectId);
  const croppingImageId = useToolStore((s) => s.croppingImageId);
  const setImportProgress = useToolStore((s) => s.setImportProgress);
  const [docVersion, setDocVersion] = useState(0);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCountRef = useRef(0);
  const lastPasteTimeRef = useRef(0);
  const pasteCountRef = useRef(0);

  // ---- open / close the board session ----------------------------------
  useEffect(() => {
    let cancelled = false;
    let s: BoardSession | null = null;
    (async () => {
      try {
        await useToolStore.getState().hydrate();
        s = await BoardSession.open(boardId);
        if (cancelled) {
          await s.close();
          return;
        }
        sessionRef.current = s;
        setName(s.board.name);
        setSession(s);
      } catch (err) {
        console.error(err);
        setError(
          err instanceof Error ? err.message : "Could not open this board.",
        );
      }
    })();
    return () => {
      cancelled = true;
      const current = sessionRef.current;
      sessionRef.current = null;
      setSession(null);
      if (current) {
        void current.close(handlesRef.current?.renderer.getViewport());
      }
    };
  }, [boardId]);

  // ---- wire document events into the UI store -------------------------
  useEffect(() => {
    if (!session) return;
    const store = useToolStore.getState();
    const offStatus = session.persistence.onStatus((st) =>
      useToolStore.getState().setSaveStatus(st)
    );
    store.setSaveStatus(
      session.persistence.status === "idle"
        ? "saved"
        : session.persistence.status,
    );
    const um = session.doc.undoManager;
    const syncHistory = () =>
      useToolStore.getState().setHistory(um.canUndo(), um.canRedo());
    um.on("stack-item-added", syncHistory);
    um.on("stack-item-popped", syncHistory);
    um.on("stack-cleared", syncHistory);
    syncHistory();
    const offDoc = session.doc.onChange(() => setDocVersion((v) => v + 1));
    return () => {
      offStatus();
      um.off("stack-item-added", syncHistory);
      um.off("stack-item-popped", syncHistory);
      um.off("stack-cleared", syncHistory);
      offDoc();
    };
  }, [session]);

  // ---- keyboard shortcuts ---------------------------------------------
  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent) => {
      // While a text box is being edited the keyboard belongs to the textarea:
      // no tool letters, no Delete-the-object, just normal text editing.
      if (isTypingTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const store = useToolStore.getState();
      const h = handlesRef.current;
      if (store.editingTextId) return;
      if (store.croppingImageId && !mod) {
        if (e.key === "Enter") {
          e.preventDefault();
          h?.controller.commitCrop();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          h?.controller.cancelCrop();
          return;
        }
        return;
      }
      const viewing = store.canvasMode === "view";
      if (mod && e.key.toLowerCase() === "z" && !viewing) {
        e.preventDefault();
        if (e.shiftKey) session.doc.redo();
        else session.doc.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y" && !viewing) {
        e.preventDefault();
        session.doc.redo();
        return;
      }
      // Copy/paste/duplicate only claim the key when they do something, so
      // e.g. Ctrl+D still bookmarks with nothing selected.
      if (mod && !e.shiftKey && !e.altKey && h) {
        const k = e.key.toLowerCase();
        const boardId = session.board.id;
        if (k === "c") {
          const objs = h.controller.getSelectedObjects();
          if (objs.length) {
            e.preventDefault();
            copyToClipboard(boardId, objs);
            return;
          }
        } else if (k === "d" && !viewing && h.controller.duplicateSelection()) {
          e.preventDefault();
          return;
        }
      }
      if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        h?.controller.zoomAtCenter(1.2);
        return;
      }
      if (mod && e.key === "-") {
        e.preventDefault();
        h?.controller.zoomAtCenter(1 / 1.2);
        return;
      }
      if (mod && e.key === "0") {
        e.preventDefault();
        resetZoom();
        return;
      }
      if (mod) return;
      // V toggles the mode, and works in either direction.
      if (e.key.toLowerCase() === "v") {
        store.setCanvasMode(store.canvasMode === "view" ? "edit" : "view");
        return;
      }
      // View mode: navigation shortcuts (zoom, above) still work; nothing
      // that would create, change or delete board content does.
      if (store.canvasMode === "view") return;
      const sel = store.selection;
      const cmds = store.selectionCommands;
      if (
        sel
        && cmds
        && sel.strokeIds.length > 0
        && (e.key === "[" || e.key === "]")
      ) {
        e.preventDefault();
        cmds.adjustWidth(e.key === "]" ? 1 : -1);
        return;
      }
      switch (e.key.toLowerCase()) {
        case "p":
          store.setTool("pen");
          break;
        case "n":
          store.setTool("pencil");
          break;
        case "m":
          store.setTool("highlighter");
          break;
        case "e":
          store.setTool("eraser");
          break;
        case "x":
          store.setTool("strokeEraser");
          break;
        case "h":
          store.setTool("pan");
          break;
        case "l":
          store.setTool("lasso");
          break;
        case "t":
          store.setTool("text");
          break;
        case "enter":
          if (
            sel
            && cmds
            && sel.textIds.length === 1
            && sel.strokeIds.length === 0
          ) {
            e.preventDefault();
            cmds.editText();
          }
          break;
        case "escape":
          h?.controller.setSelection(null);
          cmds?.clear();
          break;
        case "delete":
        case "backspace": {
          if (sel && cmds) {
            e.preventDefault();
            cmds.remove();
            break;
          }
          const id = store.selectedObjectId;
          if (id) {
            e.preventDefault();
            session.doc.removeObjects([id]);
            h?.controller.setSelection(null);
          }
          break;
        }
      }
    };

    const onPaste = async (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const store = useToolStore.getState();
      const h = handlesRef.current;
      if (
        !session || !h || store.editingTextId || store.canvasMode === "view"
      ) {
        return;
      }

      const items = Array.from(e.clipboardData?.items ?? []);
      const files = Array.from(e.clipboardData?.files ?? []);
      const pdfFile = files.find(
        (f) =>
          f.type === "application/pdf"
          || f.name.toLowerCase().endsWith(".pdf"),
      );
      if (pdfFile) {
        e.preventDefault();
        void onInsertPDF(pdfFile);
        return;
      }

      const imageFiles = files.filter(isImageFile);
      const imageItem = items.find((it) => it.type.startsWith("image/"));
      const blob = imageFiles[0] ?? imageItem?.getAsFile();

      if (imageFiles.length > 0 || blob) {
        e.preventDefault();
        const { width, height } = h.renderer.getSize();
        const vp = h.renderer.getViewport();
        const center = screenToWorld(
          { x: width / 2, y: height / 2 },
          vp,
        );

        const now = Date.now();
        if (now - lastPasteTimeRef.current < 4000) {
          pasteCountRef.current++;
        } else {
          pasteCountRef.current = 0;
        }
        lastPasteTimeRef.current = now;

        const offset = screenLengthToWorld(
          20 * pasteCountRef.current,
          vp,
        );
        const baseTarget = {
          x: center.x + offset,
          y: center.y + offset,
        };

        const targetsToImport = imageFiles.length > 0
          ? imageFiles
          : (blob ? [blob] : []);

        const newIds: string[] = [];
        for (let i = 0; i < targetsToImport.length; i++) {
          try {
            const obj = await importImage({
              boardId: session.board.id,
              doc: session.doc,
              fileOrBlob: targetsToImport[i],
              targetCenter: {
                x: baseTarget.x + i * 30,
                y: baseTarget.y + i * 30,
              },
              onAssetReady: (id) => h.renderer.assetReady(id),
            });
            newIds.push(obj.id);
          } catch (err) {
            console.error("Paste image failed", err);
          }
        }
        if (newIds.length > 0) {
          h.controller.selectObjects(newIds);
        }
        return;
      }

      if (hasClipboard()) {
        e.preventDefault();
        void pasteClipboard(
          session.board.id,
          (objs) =>
            handlesRef.current === h ? h.controller.insertCopies(objs) : [],
        )
          .catch((err) => console.error("Paste failed", err));
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const onViewportChange = useCallback(
    (vp: Viewport) => sessionRef.current?.saveViewport(vp),
    [],
  );

  const resetZoom = () => {
    const h = handlesRef.current;
    if (!h) return;
    const { width, height } = h.renderer.getSize();
    h.controller.setViewport(
      zoomAt(h.renderer.getViewport(), { x: width / 2, y: height / 2 }, 1),
    );
  };

  // ---- PDF import -----------------------------------------------------
  const onInsertPDF = async (file: File) => {
    try {
      const inspected = await inspectPDF(file);
      setPendingImport({ file, inspected });
    } catch (err) {
      console.error(err);
      setImportProgress({
        fileName: file.name,
        done: 0,
        total: 0,
        error: `Could not read ${file.name}. Is it a valid PDF?`,
      });
      setTimeout(() => setImportProgress(null), 4000);
    }
  };

  const runImport = async (layout: PDFLayout) => {
    const pending = pendingImport;
    const h = handlesRef.current;
    if (!pending || !session || !h) return;
    setPendingImport(null);
    const { width } = h.renderer.getSize();
    const vp = h.renderer.getViewport();
    const firstWidth = pending.inspected.sizes[0]?.width ?? 600;
    // First page just under the toolbar, centred horizontally.
    const anchor = screenToWorld({ x: width / 2, y: 150 }, vp);
    const origin = { x: anchor.x - firstWidth / 2, y: anchor.y };
    setImportProgress({
      fileName: pending.file.name,
      done: 0,
      total: pending.inspected.pageCount,
    });
    try {
      const result = await importPDF({
        boardId: session.board.id,
        doc: session.doc,
        file: pending.file,
        inspected: pending.inspected,
        layout,
        origin,
        onPagesPlanned: (ids) =>
          ids.forEach((id) => h.renderer.pendingAssets.add(id)),
        onPageReady: (id) => h.renderer.assetReady(id),
        onProgress: (done, total) =>
          setImportProgress({ fileName: pending.file.name, done, total }),
      });
      if (result.failedPages.length) {
        setImportProgress({
          fileName: pending.file.name,
          done: 0,
          total: 0,
          error: `${result.failedPages.length} page(s) could not be rendered.`,
        });
        setTimeout(() => setImportProgress(null), 5000);
      } else {
        setTimeout(() => setImportProgress(null), 1500);
      }
    } catch (err) {
      console.error(err);
      setImportProgress({
        fileName: pending.file.name,
        done: 0,
        total: 0,
        error: "Import failed. See console for details.",
      });
      setTimeout(() => setImportProgress(null), 5000);
    }
  };

  // ---- PDF export -----------------------------------------------------
  const runExport = async (choice: ExportChoice) => {
    if (!session) return;
    const all = session.doc.getAll();
    const selectedIds = new Set(
      handlesRef.current?.controller.getSelectedIds() ?? [],
    );
    const objects = choice.scope === "selection"
      ? all.filter((o) => selectedIds.has(o.id))
      : all;
    setExportState({ busy: { done: 0, total: 1, label: "" }, error: null });
    try {
      // pdf-lib and its font toolkit are only pulled in when someone actually
      // exports, so opening a board stays as light as it was before.
      const { exportToPDF, downloadPDF } = await import(
        "../export/PDFExporter"
      );
      const result = await exportToPDF({
        objects,
        boardName: name,
        background: session.doc.getBackground(),
        onProgress: (done, total, label) =>
          setExportState({ busy: { done, total, label }, error: null }),
      });
      downloadPDF(result);
      setExportState({ busy: null, error: null });
      setExportOpen(false);
    } catch (err) {
      console.error(err);
      setExportState({
        busy: null,
        error: err instanceof Error
          ? err.message
          : "Export failed. See console for details.",
      });
    }
  };

  // ---- rename ---------------------------------------------------------
  const commitName = () => {
    const trimmed = name.trim() || "Untitled board";
    setName(trimmed);
    if (session && trimmed !== session.board.name) {
      session.board.name = trimmed;
      void boardRepository.rename(session.board.id, trimmed);
    }
  };

  if (error) {
    return (
      <div className="board-error">
        <p>{error}</p>
        <button type="button" className="btn" onClick={onBack}>
          Back to boards
        </button>
      </div>
    );
  }
  if (!session) {
    return <div className="board-loading muted">Opening board...</div>;
  }

  const selectedPage = selectedId
    ? (session.doc.get(selectedId) as ImageObject | undefined)
    : undefined;
  const croppingImage = croppingImageId
    ? (session.doc.get(croppingImageId) as ImageObject | undefined)
    : undefined;
  void docVersion; // re-render trigger for selection bar contents

  let exportObjects: CanvasObject[] = [];
  let exportSelection: CanvasObject[] = [];
  if (exportOpen) {
    exportObjects = session.doc.getAll();
    const ids = new Set(handlesRef.current?.controller.getSelectedIds() ?? []);
    exportSelection = exportObjects.filter((o) => ids.has(o.id));
  }

  const onDragEnter = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      dragCountRef.current++;
      setIsDraggingOver(true);
    }
  };

  const onDragLeave = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      dragCountRef.current = Math.max(0, dragCountRef.current - 1);
      if (dragCountRef.current === 0) {
        setIsDraggingOver(false);
      }
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    dragCountRef.current = 0;
    setIsDraggingOver(false);
    if (useToolStore.getState().canvasMode === "view") return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    e.preventDefault();

    const pdfFile = files.find(
      (f) =>
        f.type === "application/pdf"
        || f.name.toLowerCase().endsWith(".pdf"),
    );
    if (pdfFile) {
      void onInsertPDF(pdfFile);
      return;
    }

    const imageFiles = files.filter(isImageFile);
    if (imageFiles.length > 0 && handlesRef.current && session) {
      const h = handlesRef.current;
      const vp = h.renderer.getViewport();
      const dropWorld = screenToWorld({ x: e.clientX, y: e.clientY }, vp);
      const newIds: string[] = [];

      for (let i = 0; i < imageFiles.length; i++) {
        const file = imageFiles[i];
        try {
          const obj = await importImage({
            boardId: session.board.id,
            doc: session.doc,
            fileOrBlob: file,
            targetCenter: {
              x: dropWorld.x + i * 30,
              y: dropWorld.y + i * 30,
            },
            onAssetReady: (id) => h.renderer.assetReady(id),
          });
          newIds.push(obj.id);
        } catch (err) {
          console.error("Drop image import failed", err);
          setImportProgress({
            fileName: file.name,
            done: 0,
            total: 0,
            error: `Could not load image ${file.name}.`,
          });
          setTimeout(() => setImportProgress(null), 4000);
        }
      }

      if (newIds.length > 0) {
        h.controller.selectObjects(newIds);
      }
    }
  };

  return (
    <div
      className="board-view"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <CanvasViewport
        doc={session.doc}
        initialViewport={session.board.viewport ?? DEFAULT_VIEWPORT}
        onViewportChange={onViewportChange}
        onReady={(h) => (handlesRef.current = h)}
      />
      {isDraggingOver && (
        <div className="drag-drop-overlay">
          <div className="drag-drop-card">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            </svg>
            <span>Drop image or PDF to insert</span>
          </div>
        </div>
      )}
      <header className="topbar">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onBack}
          aria-label="Back to boards"
        >
          &larr; Boards
        </button>
        <input
          className="board-title"
          value={name}
          aria-label="Board name"
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
        <StatusChip />
      </header>
      {
        /* One stack, so a wrapped toolbar pushes the contextual bars down
          instead of hiding underneath them. */
      }
      <div className="top-stack">
        <Toolbar
          onInsertPDF={onInsertPDF}
          onUndo={() => session.doc.undo()}
          onRedo={() => session.doc.redo()}
          onBackground={(c) => session.doc.setBackground(c)}
          onExportPDF={() => {
            setExportState({ busy: null, error: null });
            setExportOpen(true);
          }}
        />
        <SelectionBar />
        {croppingImage?.type === "image" && (
          <CropBar
            image={croppingImage}
            onReset={() => handlesRef.current?.controller.resetCrop()}
            onCancel={() => handlesRef.current?.controller.cancelCrop()}
            onDone={() => handlesRef.current?.controller.commitCrop()}
          />
        )}
        {!croppingImageId && selectedPage?.type === "image" && (
          <PageSelectionBar
            doc={session.doc}
            page={selectedPage}
            onCrop={() =>
              handlesRef.current?.controller.startCrop(selectedPage.id)}
            onDeselect={() => handlesRef.current?.controller.setSelection(null)}
          />
        )}
      </div>
      <ZoomControls
        onZoomIn={() => handlesRef.current?.controller.zoomAtCenter(1.2)}
        onZoomOut={() => handlesRef.current?.controller.zoomAtCenter(1 / 1.2)}
        onReset={resetZoom}
      />
      <ImportProgressToast />
      {pendingImport && (
        <ImportPDFDialog
          fileName={pendingImport.file.name}
          pageCount={pendingImport.inspected.pageCount}
          onCancel={() => {
            void pendingImport.inspected.pdf.destroy();
            setPendingImport(null);
          }}
          onImport={runImport}
        />
      )}
      {exportOpen && (
        <ExportDialog
          objects={exportObjects}
          selectedObjects={exportSelection}
          busy={exportState.busy}
          error={exportState.error}
          onCancel={() => setExportOpen(false)}
          onExport={runExport}
        />
      )}
    </div>
  );
}
