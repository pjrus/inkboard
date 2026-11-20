# MCP Server Plan

> **Status:** Implemented (Phases 1–3)
> **Target:** Inkboard Model Context Protocol (MCP) Server (`packages/mcp-server`)

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

- **MCP Server Package / Entrypoint:** Standalone TypeScript/Node package
  (`packages/mcp-server`) implementing the MCP v2 (`2026-07-28`) TypeScript SDK
  (`@modelcontextprotocol/server`, `@modelcontextprotocol/node`).
- **Transport:** Stateless `stdio` (`serveStdio`) and stateless Streamable HTTP
  (`createMcpHandler` on `127.0.0.1` via `--http-port`) with `legacy: "reject"`.
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

Because Inkboard currently runs in the browser with IndexedDB storage, the MCP
server connects directly to the running Inkboard session via a **Local Live
Bridge** as the primary data access model:

- **Primary Architecture — Local Live Bridge (WebSocket / Yjs):**
  - A lightweight local relay on `127.0.0.1` connects the running Inkboard
    browser tab to the MCP server, exchanging Yjs updates
    (`Y.encodeStateAsUpdate` / `Y.applyUpdate`), board metadata, and binary
    assets on demand.
  - _Pros:_ Live edits appear immediately on the canvas with full Yjs undo/CRDT
    safety; no manual export/import loop.
  - _Cons:_ Requires the browser app to be open and opt-in to the bridge; needs
    pairing/origin checks.
- **Secondary / Optional — File-Based (`.inkboard` Backup):**
  - An optional `.inkboard` archive backend can sit behind the same
    `BoardBackend` interface for headless/offline workflows when no browser tab
    is open.

```text
+------------------+       stdio / HTTP        +----------------------+
|   MCP Client     | <-----------------------> |  Inkboard MCP Server |
| (IDE / AI Agent) |                           +----------------------+
+------------------+                                      |
                                                          v
                                               +----------------------+
                                               |    BoardBackend      |
                                               +----------------------+
                                                          |
                                             WebSocket / Yjs Bridge
                                               (127.0.0.1 + token)
                                                          |
                                                          v
                                               +----------------------+
                                               | Inkboard Browser App |
                                               | (Yjs CRDT + Dexie)   |
                                               +----------------------+
```

## 4. MCP Primitives

### 4.1 Resources (Read-Only Context)

| URI Template                                     | MIME Type          | Description                                                            |
| ------------------------------------------------ | ------------------ | ---------------------------------------------------------------------- |
| `inkboard://boards`                              | `application/json` | List of available boards (id, title, updatedAt, object counts).        |
| `inkboard://boards/{boardId}`                    | `application/json` | Full board summary: settings, content bounds, text boxes, PDFs.        |
| `inkboard://boards/{boardId}/objects/{objectId}` | `application/json` | Detailed JSON for a single `CanvasObject` (`stroke`, `image`, `text`). |
| `inkboard://boards/{boardId}/preview`            | `image/png`        | Rasterized viewport/content preview (optional/Phase 2).                |

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

### Phase 1: Local Live Bridge & Read-Only MCP Server

- [x] Define `BoardBackend` interface and build the local WebSocket/Yjs bridge
      (`127.0.0.1` + session token + origin check) between the Inkboard web app
      and the MCP server.
- [x] Add an opt-in bridge client in the Inkboard browser app to sync active
      `CanvasDocument` Yjs state and board metadata over the local relay.
- [x] Scaffold MCP server with `@modelcontextprotocol/sdk` (`stdio` transport).
- [x] Implement read-only resources (`inkboard://boards`,
      `inkboard://boards/{boardId}`) and tools (`list_boards`,
      `get_board_summary`, `query_objects`).
- [x] Add unit and integration tests for schema validation, bounds querying, and
      Yjs bridge sync.

### Phase 2: Live CRDT Mutations, Prompts & Export

- [x] Implement write tools (`create_board`, `add_text_box`, `update_text_box`,
      `add_stroke`, `delete_objects`) behind `--read-only` guard, syncing live
      to the open canvas.
- [x] Wire `export_board_pdf` using existing export modules where Node-compatible
      (via the connected browser session).
- [x] Add MCP prompts (`summarize_board`, `organize_notes`, `diagram_to_board`).
- [x] Add end-to-end tests covering browser <-> MCP round-trip edits.

### Phase 3: Offline `.inkboard` File Backend (Optional)

- [x] Add a `.inkboard` archive `BoardBackend` (`InkboardFileBackend`)
      compatible with `src/boards/backup.ts` for headless/offline use when no
      browser session is running.

## 7. Resolved Architectural Decisions

- [x] **Package layout:** In-repo npm workspace `packages/mcp-server`
      (`inkboard-mcp`).
- [x] **Bridge UX & pairing:** Opt-in **Local MCP Bridge** modal in `AppMenu`
      and `BoardList` footer, storing `{ enabled, port, token }` locally in
      `localStorage`; multi-tab routing prefers the tab with the target
      `boardId` active.
- [x] **Stroke representation:** `get_board_summary` and `query_objects` omit
      raw stroke `points` arrays by default (`includeStrokePoints: false`) to
      keep token usage low.
- [x] **Rendering dependency:** `export_board_pdf` and `inkboard://boards/{boardId}/preview`
      delegate to the connected browser tab over the bridge, reusing Inkboard's
      exact PDF/canvas rendering and IndexedDB assets.

## 8. Verification & Test Plan

- [x] Schema & Zod input validation unit tests (`npm test`).
- [x] Live WebSocket/Yjs bridge round-trip tests verifying CRDT integrity and
      MCP `UndoManager` integration.
- [x] CLI `stdio` integration test and live browser + MCP Inspector smoke test.
- [x] `npm run typecheck`, `npm run format:check`, and `npm run build`.
