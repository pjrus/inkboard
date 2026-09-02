# Inkboard

A local-first infinite canvas for handwriting, PDF annotation and (later) collaborative diagramming.
Everything lives in your browser's IndexedDB. No account, no server, works offline.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest unit tests
npm run build      # typecheck + production bundle in dist/
```

## What is in the MVP

- Infinite canvas with focal-point zoom (wheel/trackpad pinch/toolbar), pan (hand tool, space+drag, middle mouse, wheel), two-finger pinch/pan on touch
- Pen and pencil with 8 preset colours + custom colour, 5 thickness presets (world-space widths), pressure support for stylus input
- Object eraser, undo/redo (Yjs UndoManager, CRDT-aware)
- PDF import via PDF.js in a worker: each page rasterised to a JPEG asset in IndexedDB and placed as a static "printout" page, vertical or horizontal layout, switchable after import, progressive rendering with a progress toast
- Move/delete pages with the hand tool, remove a whole PDF
- Multiple boards, autosave with incremental CRDT updates and periodic compaction, viewport + tool preferences restored on reopen

## Architecture

```
src/
  canvas/          coordinates.ts (all screen<->world maths), gestures.ts (pinch),
                   strokeGeometry.ts (outline, hit test, simplify),
                   CanvasRenderer.ts (2 stacked <canvas>, Path2D cache, culling, LRU image cache),
                   CanvasInteractionController.ts (state machine: idle/drawing/erasing/panning/pinching/movingObject),
                   CanvasViewport.tsx (thin React host)
  document/        schema.ts (CanvasObject = stroke | pdf-page | text[reserved]),
                   crdt.ts (Yjs wrapper: objects, pdfDocuments, undo),
                   persistence.ts (incremental update log in IndexedDB + compaction)
  pdf/             PDFImporter.ts (PDF.js -> JPEG assets), PDFLayoutEngine.ts (vertical/horizontal placement)
  storage/         db.ts (Dexie: boards, updates, assets, preferences), assetRepository.ts
  collaboration/   SyncProvider.ts (interface), LocalProvider.ts (current implementation)
  boards/          BoardRepository.ts, BoardSession.ts, BoardList.tsx, BoardView.tsx
  ui/              Toolbar, ColourPicker, ThicknessPicker, ImportPDFDialog, PageSelectionBar, ZoomControls, ...
  store/           toolStore.ts (zustand: tool/colour/width/zoom/save status)
```

Key decisions:

- **Local first.** The Yjs document in memory is the working copy. Every update is appended to the `updates` table on a 120 ms debounce; rows are merged into one snapshot once there are more than 300. Binary page images never enter the CRDT; they are referenced by asset id.
- **Rendering.** Committed strokes and pages are drawn on a static canvas only when the viewport or document changes; the in-progress stroke is drawn on an overlay canvas per frame. Objects outside the viewport (+200 px overscan) are skipped. Page bitmaps are decoded lazily and evicted LRU-style.
- **Input.** Pointer Events only. Two touch pointers cancel any in-progress stroke and enter pinch mode; once a stylus has been seen, single-finger touch pans instead of drawing.
- **Undo.** One `Y.UndoManager` tracking local-origin transactions; a PDF import, an eraser drag, or a layout switch each form a single undo step.
- **Future.** `TextObject` is already in the schema and ignored by the renderer; a WebRTC/WebSocket provider only has to implement `SyncProvider` and exchange Yjs updates plus referenced assets.
