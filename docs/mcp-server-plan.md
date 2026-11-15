# MCP Server Plan (Template)

> **Status:** Draft / Planning Template
> **Target:** Inkboard Model Context Protocol (MCP) Server

## 1. Overview & Problem Statement

Inkboard is a local-first infinite whiteboard whose state lives in a Yjs CRDT
(`CanvasDocument`) persisted to IndexedDB (`Dexie`), with `.inkboard` files for
portable backup/restore.

This document defines a template plan for exposing Inkboard boards to AI
assistants and external tools via an **MCP server** (using the Model Context
Protocol), enabling structured reading, querying, and (optionally) authoring of
whiteboard content.

## 2. Scope

### In Scope

- **MCP Server Package / Entrypoint:** Standalone TypeScript/Node package (e.g.
  `packages/mcp-server` or `mcp/`) implementing the official
  `@modelcontextprotocol/sdk`.
- **Transport:** `stdio` (primary, for local desktop clients such as Claude
  Desktop, Cursor, and VS Code) and optional Streamable HTTP / SSE for remote or
  browser-bridged setups.
- **Core Capabilities:**
  - Listing and inspecting boards (metadata, bounds, object counts, background
    settings).
  - Reading board content as structured JSON (text boxes, stroke summaries,
    image/PDF metadata) and rendered images/PDFs.
  - Controlled write operations on board objects (e.g., adding/updating text
    nodes, inserting images, creating shapes/strokes) via CRDT-safe mutations.
- **Documentation & Tests:** Schema validation (Zod), unit/integration tests
  with Vitest, and client setup instructions.

### Out of Scope (for Initial Milestone)

- Multi-tenant hosted cloud SaaS or user authentication/accounts.
- Real-time multi-user collaboration server (see `ROADMAP.md` "Live
  collaboration"; though the bridge may reuse Yjs update encoding).
- Full handwriting/OCR recognition inside the MCP server itself (clients can
  consume exported raster images or structured text objects).
- Arbitrary filesystem access outside explicitly configured `.inkboard` backup
  paths or workspace directories.

## 3. Architecture & Data Access Model

Because Inkboard currently runs entirely in the browser with IndexedDB storage,
the MCP server needs a clear way to reach board data. Choose (or phase) one of
the following integration models:

- **Option A — File-Based (`.inkboard` Backup / Export):**
  - The MCP server reads and writes `.inkboard` archive files (and/or exported
    JSON/PDFs) on disk.
  - *Pros:* Zero changes to the browser app; works offline; deterministic and
    easy to test.
  - *Cons:* Not live; requires manual export/import or File System Access API
    auto-backup (see `ROADMAP.md`).
- **Option B — Local Live Bridge (WebSocket / HTTP):**
  - A lightweight local relay connects the running Inkboard browser tab to the
    MCP server, exchanging Yjs updates (`Y.encodeStateAsUpdate` /
    `Y.applyUpdate`) and binary assets.
  - *Pros:* Live edits appear immediately on the canvas with full Yjs undo/CRDT
    safety.
  - *Cons:* Requires the browser app to be open and opt-in to the bridge; needs
    pairing/origin checks.
- **Recommended Phasing:** Start with **Option A** (`.inkboard` file backend)
  for Phase 1, behind a `BoardBackend` interface so **Option B** (live Yjs
  bridge) can be plugged in during Phase 2.

```text
+------------------+       stdio / HTTP        +----------------------+
|   MCP Client     | <-----------------------> |  Inkboard MCP Server |
| (IDE / AI Agent) |                           +----------------------+
+------------------+                                      |
                                                          v
                                               +----------------------+
                                               |    BoardBackend      |
                                               +----------------------+
                                                /                    \
                                               v                      v
                                    [Phase 1: .inkboard]   [Phase 2: Live Yjs]
                                    [  archive files   ]   [ WebSocket bridge ]
```

## 4. MCP Primitives

### 4.1 Resources (Read-Only Context)

| URI Template | MIME Type | Description |
| --- | --- | --- |
| `inkboard://boards` | `application/json` | List of available boards (id, title, updatedAt, object counts). |
| `inkboard://boards/{boardId}` | `application/json` | Full board summary: settings, content bounds, text boxes, PDFs. |
| `inkboard://boards/{boardId}/objects/{objectId}` | `application/json` | Detailed JSON for a single `CanvasObject` (`stroke`, `image`, `text`). |
| `inkboard://boards/{boardId}/preview` | `image/png` | Rasterized viewport/content preview (optional/Phase 2). |

### 4.2 Tools (Actions)

#### Read & Query Tools

- `list_boards` — List boards with optional filter/sort.
- `get_board_summary` — Return board metadata, content bounds, and a compact
  inventory of objects (grouping strokes, listing text content, and image/PDF
  dimensions).
- `query_objects` — Filter objects by `type` (`stroke` | `image` | `text`),
  bounding box (`x, y, width, height`), or text substring.
- `export_board_pdf` — Generate a PDF export using Inkboard's export pipeline
  and return the output path or base64 payload.

#### Write & Mutation Tools (CRDT-Safe)

- `create_board` — Create a new board with optional title and background colour.
- `add_text_box` — Insert a `TextObject` at `(x, y)` with text, font, size,
  alignment, and colour.
- `update_text_box` — Update text content, position, or styling of an existing
  `TextObject`.
- `add_stroke` — Insert a `StrokeObject` (e.g., programmatic diagrams, arrows,
  or highlights) with validated `PenTool`, colour, width, and points.
- `delete_objects` — Remove one or more objects by `id` inside a single Yjs
  transaction.

### 4.3 Prompts (Reusable Workflows)

- `summarize_board` — Gather all `TextObject`s and spatial layout from a board
  and produce a structured summary or action items.
- `organize_notes` — Analyze scattered text boxes and propose grouped
  positions or cleaned-up text.
- `diagram_to_board` — Convert a user's outline or architecture description into
  positioned `TextObject`s and connecting `StrokeObject`s.

## 5. Security, Privacy & Guardrails

- **Local-Only by Default:** Bind any local HTTP/WebSocket bridge strictly to
  `127.0.0.1` with an explicit origin check and per-session bearer token.
- **Path Sandboxing:** Restrict `.inkboard` and export file reads/writes to
  user-configured root directories (prevent path traversal).
- **Read-Only Mode Flag:** Support `--read-only` to disable all mutation tools
  when connecting untrusted or exploratory clients.
- **Asset Size Limits:** Cap image/PDF payload sizes returned over MCP tool
  responses to avoid blowing up client context windows.
- **Validation:** Validate all tool inputs against `src/document/schema.ts`
  types with Zod before applying Yjs transactions.

## 6. Implementation Plan (Phased Milestones)

### Phase 1: Foundation & Read-Only `.inkboard` Backend

- [ ] Define `BoardBackend` interface and `.inkboard` archive reader/writer
      reusing `src/boards/backup.ts` and `src/document/crdt.ts`.
- [ ] Scaffold MCP server with `@modelcontextprotocol/sdk` (`stdio` transport).
- [ ] Implement read-only resources (`inkboard://boards`,
      `inkboard://boards/{boardId}`) and tools (`list_boards`,
      `get_board_summary`, `query_objects`).
- [ ] Add unit tests for schema validation, bounds querying, and archive
      round-trips.

### Phase 2: CRDT Mutations & Export

- [ ] Implement write tools (`create_board`, `add_text_box`, `update_text_box`,
      `add_stroke`, `delete_objects`) behind `--read-only` guard.
- [ ] Wire `export_board_pdf` using existing export modules where Node-compatible.
- [ ] Add MCP prompts (`summarize_board`, `diagram_to_board`).

### Phase 3: Live Browser Bridge (Optional / Follow-Up)

- [ ] Design WebSocket/Yjs sync bridge between the Inkboard web app and the
      local MCP server.
- [ ] Support live board discovery and real-time updates without manual
      `.inkboard` export/import.
- [ ] Add end-to-end tests covering browser <-> MCP round-trip edits.

## 7. Open Questions & Decisions Needed

- [ ] **Package layout:** Should the MCP server live in-repo (e.g. `mcp/` or a
      npm workspace) or in a separate repository?
- [ ] **Primary data source:** Is Phase 1 `.inkboard` file-based sufficient to
      start, or do we need the live browser bridge from day one?
- [ ] **Stroke representation:** Should `get_board_summary` omit raw stroke
      point arrays by default (returning bounds + metadata) to keep token usage
      low?
- [ ] **Rendering dependency:** Does `export_board_pdf` / PNG preview in Node
      require `@napi-rs/canvas` or Playwright, or should Phase 1 stick to
      `pdf-lib` + structured JSON?

## 8. Verification & Test Plan

- [ ] Schema & Zod input validation unit tests (`npm test`).
- [ ] `.inkboard` read/write round-trip tests verifying CRDT integrity and
      asset references.
- [ ] Smoke test with MCP Inspector (`npx @modelcontextprotocol/inspector`) over
      `stdio`.
- [ ] `npm run typecheck`, `npm run format:check`, and `npm run build`.
