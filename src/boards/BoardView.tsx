import { useCallback, useEffect, useRef, useState } from "react";
import { CanvasViewport, type CanvasHandles } from "../canvas/CanvasViewport";
import { isTypingTarget } from "../canvas/CanvasInteractionController";
import { DEFAULT_VIEWPORT, screenToWorld, zoomAt } from "../canvas/coordinates";
import type { PDFLayout, PDFPageObject, Viewport } from "../document/schema";
import { importPDF, inspectPDF, type InspectedPDF } from "../pdf/PDFImporter";
import { useToolStore } from "../store/toolStore";
import { ImportPDFDialog } from "../ui/ImportPDFDialog";
import { ImportProgressToast } from "../ui/ImportProgressToast";
import { PageSelectionBar } from "../ui/PageSelectionBar";
import { StatusChip } from "../ui/StatusChip";
import { Toolbar } from "../ui/Toolbar";
import { ZoomControls } from "../ui/ZoomControls";
import { boardRepository } from "./BoardRepository";
import { BoardSession } from "./BoardSession";

interface Props {
  boardId: string;
  onBack: () => void;
}

export function BoardView({ boardId, onBack }: Props) {
  const [session, setSession] = useState<BoardSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [pendingImport, setPendingImport] = useState<{ file: File; inspected: InspectedPDF } | null>(null);
  const handlesRef = useRef<CanvasHandles | null>(null);
  const sessionRef = useRef<BoardSession | null>(null);
  const selectedId = useToolStore((s) => s.selectedObjectId);
  const setImportProgress = useToolStore((s) => s.setImportProgress);
  const [docVersion, setDocVersion] = useState(0);

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
        setError(err instanceof Error ? err.message : "Could not open this board.");
      }
    })();
    return () => {
      cancelled = true;
      const current = sessionRef.current;
      sessionRef.current = null;
      setSession(null);
      if (current) void current.close(handlesRef.current?.renderer.getViewport());
    };
  }, [boardId]);

  // ---- wire document events into the UI store -------------------------
  useEffect(() => {
    if (!session) return;
    const store = useToolStore.getState();
    const offStatus = session.persistence.onStatus((st) => useToolStore.getState().setSaveStatus(st));
    store.setSaveStatus(session.persistence.status === "idle" ? "saved" : session.persistence.status);
    const um = session.doc.undoManager;
    const syncHistory = () => useToolStore.getState().setHistory(um.canUndo(), um.canRedo());
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
      if (isTypingTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const store = useToolStore.getState();
      const h = handlesRef.current;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) session.doc.redo();
        else session.doc.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        session.doc.redo();
        return;
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
      switch (e.key.toLowerCase()) {
        case "p":
          store.setTool("pen");
          break;
        case "n":
          store.setTool("pencil");
          break;
        case "e":
          store.setTool("eraser");
          break;
        case "h":
        case "v":
          store.setTool("pan");
          break;
        case "escape":
          h?.controller.setSelection(null);
          break;
        case "delete":
        case "backspace": {
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const onViewportChange = useCallback((vp: Viewport) => sessionRef.current?.saveViewport(vp), []);

  const resetZoom = () => {
    const h = handlesRef.current;
    if (!h) return;
    const { width, height } = h.renderer.getSize();
    h.controller.setViewport(zoomAt(h.renderer.getViewport(), { x: width / 2, y: height / 2 }, 1));
  };

  // ---- PDF import -----------------------------------------------------
  const onInsertPDF = async (file: File) => {
    try {
      const inspected = await inspectPDF(file);
      setPendingImport({ file, inspected });
    } catch (err) {
      console.error(err);
      setImportProgress({ fileName: file.name, done: 0, total: 0, error: `Could not read ${file.name}. Is it a valid PDF?` });
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
    setImportProgress({ fileName: pending.file.name, done: 0, total: pending.inspected.pageCount });
    try {
      const result = await importPDF({
        boardId: session.board.id,
        doc: session.doc,
        file: pending.file,
        inspected: pending.inspected,
        layout,
        origin,
        onPagesPlanned: (ids) => ids.forEach((id) => h.renderer.pendingAssets.add(id)),
        onPageReady: (id) => h.renderer.assetReady(id),
        onProgress: (done, total) => setImportProgress({ fileName: pending.file.name, done, total }),
      });
      if (result.failedPages.length) {
        setImportProgress({ fileName: pending.file.name, done: 0, total: 0, error: `${result.failedPages.length} page(s) could not be rendered.` });
        setTimeout(() => setImportProgress(null), 5000);
      } else {
        setTimeout(() => setImportProgress(null), 1500);
      }
    } catch (err) {
      console.error(err);
      setImportProgress({ fileName: pending.file.name, done: 0, total: 0, error: "Import failed. See console for details." });
      setTimeout(() => setImportProgress(null), 5000);
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
        <button type="button" className="btn" onClick={onBack}>Back to boards</button>
      </div>
    );
  }
  if (!session) return <div className="board-loading muted">Opening board…</div>;

  const selectedPage = selectedId ? (session.doc.get(selectedId) as PDFPageObject | undefined) : undefined;
  void docVersion; // re-render trigger for selection bar contents

  return (
    <div className="board-view">
      <CanvasViewport
        doc={session.doc}
        initialViewport={session.board.viewport ?? DEFAULT_VIEWPORT}
        onViewportChange={onViewportChange}
        onReady={(h) => (handlesRef.current = h)}
      />
      <header className="topbar">
        <button type="button" className="btn btn-ghost" onClick={onBack} aria-label="Back to boards">
          ← Boards
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
      <Toolbar onInsertPDF={onInsertPDF} onUndo={() => session.doc.undo()} onRedo={() => session.doc.redo()} />
      {selectedPage?.type === "pdf-page" && (
        <PageSelectionBar doc={session.doc} page={selectedPage} onDeselect={() => handlesRef.current?.controller.setSelection(null)} />
      )}
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
    </div>
  );
}
