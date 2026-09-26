# Roadmap

Ideas for what comes next. Within each section, items are roughly ordered by
payoff per unit of effort. Nothing here is committed to; it is a list to pick
from.

**Suggested order:** persistent storage → backup/restore → clipboard → images
→ highlighter. Data safety first, then the things every annotation user
reaches for on day one. The first three are done; images are next.

## Cheap wins

Mostly UI on top of plumbing that already exists.

- [x] **Ask for persistent storage.** Call `navigator.storage.persist()` when
      the first board is created so the browser does not evict IndexedDB under
      disk pressure. For a local-only app this is one line of real protection.
- [x] **Copy / paste / duplicate** (Ctrl+C / Ctrl+V / Ctrl+D). The selection
      already has ids and objects are plain JSON; internal copy is clone with
      fresh ids from `document/ids.ts` plus an offset.
- [ ] **Highlighter.** A translucent pen drawn with `multiply` blending and no
      pressure taper: one more `PenTool` value and one render branch.
- [x] **Board background colour.** A few plain colours to pick from per
      board, no dots, ruled lines or grid. Stored with the board, so a PDF
      export is filled with the same colour and backups keep it. Dark mode
      does not change it: only the toolbar and other chrome follow the theme,
      and canvas colours such as the default ink follow the board colour.
- [ ] **Shortcut cheat sheet.** P, N, E, H, L, T, V and `[` / `]` already
      exist in `BoardView` but nothing tells you. A `?` popover, plus the key in
      each toolbar tooltip.
- [ ] **Zoom to fit / zoom to selection** (Shift+1 / Shift+2). The bounds
      maths already exists in `export/exportBounds.ts`.
- [ ] **Arrow-key nudge** for the selection (1 unit, Shift for 10).
- [ ] **Recent colours** row in `ColourPicker`, kept as a local preference.
- [ ] **Duplicate board** from `BoardList`. `boards/backup.ts` already copies
      a board under fresh board and asset ids on restore; duplicate is the same
      copy without the file in between.

## Ink

- [ ] **Stroke eraser** that erases only part of a stroke by splitting it where
      the eraser crosses, alongside the current whole-object eraser.
      `strokeGeometry.ts` already has the hit testing.
- [ ] **Straight lines** by holding Shift while drawing.
- [ ] **Shape recognition.** Hold the pen at the end of a stroke to snap a
      rough line, rectangle, ellipse or arrow to a clean one. The result stays
      a `StrokeObject`, so lasso and export keep working unchanged.
- [ ] **Laser pointer.** A stroke that fades after a second and never enters
      the CRDT. Pairs with presentation mode and collaboration.
- [ ] **Smoothing control.** Expose perfect-freehand's `streamline` /
      `thinning` as a "smooth ↔ raw" slider for people with shaky or fast
      handwriting.
- [ ] **Dashed strokes and arrowheads** as stroke style options.

## Text

- [ ] **Sticky notes.** A text box with a background fill and padding; mostly
      a render and export branch on `TextObject`.
- [ ] **Clickable links.** Detect URLs in text boxes and open them on click in
      View mode.
- [ ] **Markdown-style shortcuts.** `- ` for bullets and `# ` for a larger
      heading line, as a cheap step before real rich text.
- [ ] **Rich text** (bold, italic, lists). `Y.Text` already supports
      formatting attributes; the work is in `textLayout.ts`, the renderer and
      the PDF exporter.
- [ ] **Spell check toggle.** The editor textarea sets `spellCheck={false}`;
      make it a preference.

## PDF and images

- [ ] **Paste or drop images.** The `"image"` object type exists (imported PDF
      pages are images); what is missing is getting a file or system
      clipboard image into `db.assets` and onto the canvas.
- [ ] **Vector PDF export.** When the original PDF was kept (`sourceAssetId`),
      export pages with pdf-lib's `embedPage` instead of the stored JPEG:
      sharper, smaller and with the original text still selectable. Only
      pages still attached to their import know their source page; copies
      would stay JPEG.
- [ ] **Blank and template pages.** Insert an empty, lined, grid or dotted
      A4 page for notebook-style use, exported like an imported page.
- [ ] **Rotate pages 90°.** `ImageObject.rotation` already exists.
- [ ] **Page navigator.** A sidebar of page thumbnails for a document; click to
      jump. Most useful for long PDFs.
- [ ] **Select and copy PDF text** from imported pages via the PDF.js text
      layer, extracted at import time.
- [ ] **Crop images and pages.**

## Organising

- [ ] **Search across boards.** Text boxes are `Y.Text`; imported PDF text can
      be extracted by PDF.js at import time and stored beside the assets. A
      substring scan is enough to start with.
- [ ] **Board thumbnails** in `BoardList`, rendered from the fit-to-content
      bounds when leaving a board.
- [ ] **Folders or tags** for boards, plus sort and filter in `BoardList`.
- [ ] **Z-order** (bring to front / send to back). Objects live in a `Y.Map`,
      which has no order, so this needs a sortable `z` field (fractional
      indexing keeps concurrent reorders merge-friendly).
- [ ] **Lock objects** so a background PDF page is ignored by lasso and move.
- [ ] **Groups** that select and move together.
- [ ] **Frames.** Named rectangular regions that act as bookmarks, export
      pages and presentation slides at once.
- [ ] **Links between boards**, e.g. a text link or frame that opens another
      board.

## Canvas and navigation

- [ ] **Minimap** in the corner showing the content bounds and the current
      viewport; drag to navigate.
- [ ] **Snapping and alignment guides** when moving objects.
- [ ] **Spatial index** for culling and hit testing, only once profiling shows
      large boards (10k+ strokes) slowing down.

## Data and storage

- [x] **Backup / restore** of every board as a single `.inkboard` file: the
      Yjs state plus every referenced asset. Restore adds copies with fresh
      ids, so it never touches a board that still exists.
- [ ] **Back up one board** from the board menu, which doubles as a way to hand
      a board to someone else. `backupBoards` needs to take board ids, and the
      open board must flush its pending updates first.
- [ ] **Per-board storage usage.** `BoardList` shows the total; add a size per
      board and the remaining quota from `navigator.storage.estimate()`.
- [ ] **Clean up orphaned assets.** Deleting an image (Remove PDF, or a lasso
      selection) removes it from the CRDT, but its asset stays in IndexedDB
      until the whole board is deleted. So does a removed PDF's retained
      original (`sourceAssetId`), and the assets a cross-board paste wrote
      before it was undone. Sweep on board open: the undo stack lives in
      memory, so nothing can bring them back by then. Images on one board can
      share an asset (duplicates and same-board pastes do), so sweep by
      reference; `boards/backup.ts` already walks every reference, and backups
      already leave orphans out.
- [ ] **Version history.** Named checkpoints ("restore to this morning"). Yjs
      snapshots need `gc: false`, which keeps every deleted stroke forever,
      and `CanvasDocument` uses the default `gc: true`; storing a full
      `Y.encodeStateAsUpdate` copy per checkpoint is simpler. Either way the
      orphan sweep must keep assets a checkpoint still references.
- [ ] **Auto-backup to a folder** with the File System Access API (Chromium
      only), for people who want their boards in Dropbox or similar. The file
      is the one `backupBoards()` already produces.

## Export and sharing

- [ ] **PNG and SVG export** of the board or the selection.
- [ ] **Export selection only** to PDF.
- [ ] **Copy selection as an image** to the system clipboard
      (`ClipboardItem` with `image/png`) for pasting into chat or docs.
- [ ] **Read-only HTML export.** One self-contained file with a small viewer,
      so someone without Inkboard can pan and zoom a board.

## Platform

- [ ] **Installable PWA.** Already offline-capable with bundled fonts; a
      manifest and service worker would make it installable on tablets, where
      stylus users are.
- [ ] **Open PDFs from the OS** via the PWA `file_handlers` manifest entry.
- [ ] **Share target** so a phone or tablet share sheet can send a PDF or image
      straight into a board.

## Quality

- [ ] **End-to-end tests** (Playwright) for draw → reload → export. Unit tests
      cover geometry, CRDT and export well, but
      `CanvasInteractionController` has no tests.
- [ ] **Large-board benchmark.** A generated board with thousands of strokes
      and a few PDFs, to catch render and load regressions.
- [ ] **Accessibility pass.** Keyboard focus through objects, screen-reader
      labels for text boxes, `prefers-reduced-motion`.

## Bigger bets

- [ ] **Live collaboration.** The document is already a CRDT (see
      `ARCHITECTURE.md`); add `y-webrtc` (peer-to-peer) or `y-websocket` (a
      small relay), with Yjs awareness for live cursors. The hard part is
      syncing assets such as PDF page JPEGs, not strokes.
- [ ] **Audio synced to ink.** Record audio while writing, then tap any stroke
      to replay from the moment it was drawn (strokes already carry
      `createdAt`). A lecture-notes favourite.
- [ ] **Presentation mode.** Step through frames or saved viewports in View
      mode, with the laser pointer.
- [ ] **Notebook mode.** A paged, fixed-size layout as an alternative to the
      infinite canvas, for people who think in pages.
- [ ] **Math.** LaTeX in text boxes (KaTeX), rendered to both canvas and PDF.
