# Inkboard

A local-first infinite canvas for handwriting, typed notes, PDF annotation and (later) collaborative diagramming.
Everything lives in your browser's IndexedDB. No account, no server, works offline - including fonts and PDF export.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest unit tests
npm run build      # typecheck + production bundle in dist/
```

## What is in it

- Infinite canvas with focal-point zoom (wheel/trackpad pinch/toolbar), pan (hand tool, space+drag, middle mouse, wheel), two-finger pinch/pan on touch
- Pen and pencil with 9 preset colours + custom colour, 5 thickness presets (world-space widths), pressure support for stylus input
- Object eraser, undo/redo (Yjs UndoManager, CRDT-aware)
- PDF import via PDF.js in a worker: each page rasterised to a JPEG asset in IndexedDB and placed as a static "printout" page, vertical or horizontal layout, switchable after import, progressive rendering with a progress toast
- Move/delete pages with the hand tool, remove a whole PDF
- Lasso tool (L): freeform selection of handwriting with a forgiving 40%-inside rule, shift-lasso to add. Selected strokes can be made thinner/thicker ([ and ]), set to a preset, recoloured, moved as a group, or deleted. Every edit is one undo step and flows through the CRDT; the selection itself is local-only
- Text boxes (T): click anywhere to type directly on the canvas, multiline with automatic wrapping, a draggable width grip, content-driven height, four bundled open-source fonts (Open Sans, Inter, Roboto, Lato), preset sizes in world units, colour and left/centre/right alignment. Text content is a `Y.Text`, so two replicas can type into the same box without clobbering each other
- Lasso and click selection across handwriting *and* text; mixed selections only offer the controls that apply to all of it
- Light / Dark / System themes. Imported PDF pages and every colour you have already chosen stay exactly as they were; only the defaults for *new* ink and text follow the theme
- Export to PDF, entirely in the browser: one page per imported PDF page, A4 pagination, or a single page fitted to the content. Handwriting is exported as vector paths, text as real embedded text with the font bundled in, imported pages as their stored JPEGs. No toolbars, selection outlines or other UI ever reach the file
- Multiple boards, autosave with incremental CRDT updates and periodic compaction, viewport + tool preferences restored on reopen

## Architecture

```
src/
  canvas/          coordinates.ts (all screen<->world maths), gestures.ts (pinch),
                   strokeGeometry.ts (outline, hit test, simplify, lasso tests),
                   CanvasRenderer.ts (2 stacked <canvas>, Path2D cache, culling, LRU image cache,
                                      theme palette, text drawing),
                   CanvasInteractionController.ts (state machine: idle/drawing/erasing/panning/
                                      pinching/movingObject/lassoing/movingSelection/resizingText),
                   TextEditorOverlay.tsx (the single <textarea> shown while editing),
                   CanvasViewport.tsx (thin React host)
  document/        schema.ts (CanvasObject = stroke | pdf-page | text),
                   crdt.ts (Yjs wrapper: objects, pdfDocuments, Y.Text editing, undo, commands),
                   strokeCommands.ts (shared thickness scale, width stepping),
                   ids.ts (short random ids), persistence.ts (incremental update log + compaction)
  text/            fonts.ts (the four bundled families + their real vertical metrics),
                   fontLoader.ts (self-hosted @fontsource faces + WOFF bytes for export),
                   textLayout.ts (pure wrapping/baselines with an injected measurer),
                   textMeasure.ts (the one on-screen layout cache), textCommands.ts (size scale)
  theme/           ThemeProvider.tsx, themePreferences.ts (local, never in the CRDT),
                   canvasTheme.ts (the canvas half of the palette)
  export/          exportBounds.ts, exportCoordinates.ts (world -> PDF, in one place),
                   exportPlan.ts (fit / A4 / one page per imported page),
                   ExportRenderer.ts (draws objects onto a page), PDFExporter.ts, ExportDialog.tsx
  pdf/             PDFImporter.ts (PDF.js -> JPEG assets), PDFLayoutEngine.ts (vertical/horizontal placement)
  storage/         db.ts (Dexie: boards, updates, assets, preferences), assetRepository.ts
  boards/          BoardRepository.ts, BoardSession.ts, BoardList.tsx, BoardView.tsx
  ui/              Toolbar, ColourPicker, ThicknessPicker, FontSelector, FontSizeSelector,
                   TextAlignmentControls, ThemeSelector, AppMenu, SelectionBar, ...
  store/           toolStore.ts (zustand: tool, pen settings, text settings, selection, zoom, save status)
```

Key decisions:

- **Local first.** The Yjs document in memory is the working copy. Every update is appended to the `updates` table on a 120 ms debounce; rows are merged into one snapshot once there are more than 300. Binary page images never enter the CRDT; they are referenced by asset id.
- **Rendering.** Committed strokes and pages are drawn on a static canvas only when the viewport or document changes; the in-progress stroke is drawn on an overlay canvas per frame. Objects outside the viewport (+200 px overscan) are skipped. Page bitmaps are decoded lazily and evicted LRU-style.
- **Input.** Pointer Events only. Two touch pointers cancel any in-progress stroke and enter pinch mode; once a stylus has been seen, single-finger touch pans instead of drawing.
- **Undo.** One `Y.UndoManager` tracking local-origin transactions; a PDF import, an eraser drag, or a layout switch each form a single undo step.
- **Text.** A text object's content is a `Y.Text`, and the editor sends prefix/suffix diffs rather than whole-string overwrites, so concurrent typing in one box merges. Only the box being edited gets a DOM editor; every other one is drawn by the canvas renderer, so hundreds of text objects stay cheap. Width is user-controlled and height follows the wrapped content, which is computed in exactly one place (`text/textMeasure.ts`) and read by rendering, hit testing, lasso, culling and export alike. Font size is world-space, so text zooms with the ink.
- **Fonts.** Four permissively licensed families ship with the app as `@fontsource` WOFF2 (screen) and WOFF (PDF embedding) files, regular weight only. Nothing is fetched from Google Fonts, so the same text renders and exports with the network off. Each family's real ascent/descent is baked into `text/fonts.ts` and checked against the font files by a test, which is what lets the canvas and the exporter agree on baselines without either consulting a platform text engine.
- **Theme.** One set of CSS variables for the DOM, mirrored in `theme/canvasTheme.ts` for the `<canvas>`, which cannot read them. The preference is local (IndexedDB preferences, never the CRDT) and switching it stamps one attribute on `<html>` - no document object is rewritten. Imported pages are never inverted and saved colours are never mutated; only the defaults for new content follow the theme.
- **Export.** A dedicated renderer, not a screenshot: geometry comes from the CRDT, page images from IndexedDB and fonts from the bundled files, so the UI cannot leak into the output and the whole thing works offline. Strokes are exported as vector paths from the same perfect-freehand geometry the screen uses, text as embedded, selectable text wrapped with the embedded font's own metrics. All world-to-PDF conversion lives in `export/exportCoordinates.ts`, so the canvas' top-left origin and PDF's bottom-left one are reconciled in one place. pdf-lib is loaded on demand, so it costs nothing until you export.
- **Future.** The document is already a CRDT, so a WebRTC/WebSocket layer only has to exchange Yjs updates plus the assets they reference. No such layer exists yet, and no interface is reserved for one until it does.
