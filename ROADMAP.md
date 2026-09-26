# Roadmap

Ideas for what comes next, roughly ordered by payoff per unit of effort.
Nothing here is committed to; it is a list to pick from.

**Suggested order:** backup/restore → clipboard → images → highlighter.
Data safety first, then the things every annotation user reaches for on day one.

## Cheap wins

Mostly UI on top of plumbing that already exists.

- [ ] **Copy / paste / duplicate** (Ctrl+C / Ctrl+V / Ctrl+D). The selection
      already has ids and objects are plain JSON; internal copy is clone with
      fresh ids from `document/ids.ts` plus an offset.
- [ ] **Paste or drop images.** `LassoFilter.images` already mentions imported
      images, but `CanvasObject` has no image type. A `PDFPageObject` is
      essentially an image with a `pdfDocumentId`; add an `"image"` type that
      reuses `assetRepository`, `ImageCache` and the JPEG export path.
- [ ] **Highlighter.** A translucent pen drawn with `multiply` blending and no
      pressure taper: one more `PenTool` value and one render branch.
- [ ] **Page backgrounds** (dots, ruled lines, grid). Drawn in screen space on
      the bottom canvas; a local preference that never enters the CRDT.
- [ ] **Tool shortcuts** (P, E, H, V) plus a `?` cheat-sheet popover, in the
      existing `BoardView` keydown handler.

## Medium

Features that make it feel like a real notes app.

- [ ] **Backup / restore** as a single `.inkboard` file: the Yjs update plus
      every referenced asset. Everything is local-only today, so clearing site
      data wipes every board. Highest priority on this list.
- [ ] **Stroke eraser** that erases only part of a stroke by splitting it where
      the eraser crosses, alongside the current whole-object eraser.
      `strokeGeometry.ts` already has the hit testing.
- [ ] **Shape recognition.** Hold the pen at the end of a stroke to snap a
      rough line, rectangle, ellipse or arrow to a clean one. The result stays
      a `StrokeObject`, so lasso and export keep working unchanged.
- [ ] **Search across boards.** Text boxes are `Y.Text`; imported PDF text can
      be extracted by PDF.js at import time and stored beside the assets. A
      substring scan is enough to start with.
- [ ] **Board thumbnails** in `BoardList`, rendered from the fit-to-content
      bounds in `export/exportBounds.ts` when leaving a board.

## Bigger bets

- [ ] **Live collaboration.** The document is already a CRDT (see
      `ARCHITECTURE.md`); add `y-webrtc` (peer-to-peer) or `y-websocket` (a
      small relay). The hard part is syncing assets such as PDF page JPEGs, not
      strokes.
- [ ] **Installable PWA.** Already offline-capable with bundled fonts; a
      manifest and service worker would make it installable on tablets, where
      stylus users are.
- [ ] **Presentation mode.** Saved viewports or frames used as slides, stepped
      through in View mode.
- [ ] **Handwriting → text** for a lasso selection. Needs an on-device
      recognition model; only worth it if people ask.
