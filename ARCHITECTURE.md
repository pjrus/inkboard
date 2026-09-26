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
  document/        schema.ts (CanvasObject = stroke | image | text; PDF pages are images),
                   crdt.ts (Yjs wrapper: objects, pdfDocuments, settings (background), Y.Text
                                      editing, undo, commands),
                   strokeCommands.ts (shared thickness scale, width stepping),
                   ids.ts (short random ids), persistence.ts (incremental update log + compaction)
  text/            fonts.ts (the four bundled families + their real vertical metrics),
                   fontLoader.ts (self-hosted @fontsource faces + WOFF bytes for export),
                   textLayout.ts (pure wrapping/baselines with an injected measurer),
                   textMeasure.ts (the one on-screen layout cache), textCommands.ts (size scale)
  theme/           ThemeProvider.tsx, themePreferences.ts (local, never in the CRDT),
                   canvasTheme.ts (background colours; canvas palette picked from the board's
                                   background, never from the app theme)
  export/          exportBounds.ts, exportCoordinates.ts (world -> PDF, in one place),
                   exportPlan.ts (one page sized to the content),
                   ExportRenderer.ts (draws objects onto a page), PDFExporter.ts, ExportDialog.tsx
  pdf/             PDFImporter.ts (PDF.js -> JPEG assets), PDFLayoutEngine.ts (vertical/horizontal placement)
  storage/         db.ts (Dexie: boards, updates, assets, preferences)
  boards/          BoardRepository.ts, BoardSession.ts, BoardList.tsx, BoardView.tsx,
                   clipboard.ts (in-app copy/paste; re-homes image assets across boards)
                   backup.ts (every board + referenced assets in one .inkboard file; restore adds copies)
  ui/              Toolbar, ColourPicker, ThicknessPicker, FontSelector, FontSizeSelector,
                   TextAlignmentControls, ThemeSelector, AppMenu, SelectionBar, ...
  store/           toolStore.ts (zustand: tool, pen settings, text settings, selection, zoom, save status)
```

The document is already a CRDT, so collaboration would only need a WebRTC/WebSocket layer exchanging Yjs
updates plus the assets they reference. No such layer exists yet.
