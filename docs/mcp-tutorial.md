# Local Inkboard MCP Tutorial

> **Status:** Implemented — aligned with
> [`docs/mcp-server-plan.md`](mcp-server-plan.md)

This guide explains how to test the **Inkboard MCP Server** (`packages/mcp-server`)
and connect AI assistants (such as **Claude Desktop**, **Claude Code**,
**Cursor**, **VS Code**, and **ChatGPT** via an HTTP/HTTPS bridge) to Inkboard
running on your own machine via the **Local Live Bridge** or offline
`.inkboard` backups.

Everything stays local by default: Inkboard stores your boards in browser
IndexedDB, and the MCP bridge binds strictly to `127.0.0.1` (`ws://127.0.0.1:4197`)
with a per-session pairing token.

---

## How Local MCP Works

```text
+------------------+     stdio      +----------------------+   127.0.0.1 WS   +----------------------+
| Local AI Client  | <------------> | Inkboard MCP Server  | <--------------> | Inkboard Browser Tab |
| (Claude/Cursor)  |                | (@modelcontextproto) |   + auth token   | (Yjs CRDT + Dexie)   |
+------------------+                +----------------------+                  +----------------------+
```

1. **Inkboard Browser App** holds your live boards in IndexedDB (`Dexie`) as
   `Yjs` CRDT documents.
2. **Local Live Bridge** (opt-in) connects the active browser tab to the local
   MCP server using a per-session pairing token on `127.0.0.1`.
3. **Local MCP Client** launches `inkboard-mcp` over `stdio`, reads board context
   via MCP **Resources** and **Tools**, and optionally applies live CRDT-safe
   edits that appear immediately on your canvas (with standard `Cmd+Z` / `Ctrl+Z`
   undo/redo support).

---

## Quick Local Setup

### 1. Build the Workspace and Start Inkboard

From the repository root:

```bash
npm install
npm run build
npm run dev   # http://localhost:5173
```

> **Optional (`inkboard-mcp` on PATH):** Run `npm link --workspace=packages/mcp-server`
> if you want to invoke `inkboard-mcp` directly instead of passing
> `node /ABS/PATH/TO/inkboard/packages/mcp-server/dist/cli.js`.

### 2. Enable the Local MCP Bridge in Inkboard

1. Open Inkboard in your browser (`http://localhost:5173`).
2. Open a board and click the **Board menu (`⋮`) → Local MCP Bridge...** (or click
   **Local MCP Bridge...** in the footer of **My Boards**).
3. Toggle **Enable Local MCP Bridge** ON.
4. Copy your **Session pairing token** (the dialog status will show
   `Waiting for MCP server on 127.0.0.1:4197…` until your MCP client spawns the
   server).

---

## How to Test MCP

### Option A: Automated Unit & Integration Tests

Run the full test suite (browser CRDT/bridge tests + MCP server Zod, security,
file-backend, live bridge, and `stdio` CLI tests):

```bash
npm test
```

### Option B: Interactive Testing with MCP Inspector (Live Browser Bridge)

With `npm run dev` running and **Local MCP Bridge** enabled in your browser tab:

```bash
npx @modelcontextprotocol/inspector node /ABS/PATH/TO/inkboard/packages/mcp-server/dist/cli.js --token <SESSION_TOKEN>
```

In the MCP Inspector UI:

1. Click **Connect**. The browser dialog status will switch to **Connected**.
2. Open the **Tools** tab and test:
   - `list_boards` — lists your IndexedDB boards and object counts.
   - `get_board_summary` — pass a `boardId` to inspect text boxes, bounds, and stroke summaries.
   - `add_text_box` / `add_stroke` — watch objects appear live on your canvas; press `Cmd+Z` / `Ctrl+Z` in Inkboard to undo.
   - `export_board_pdf` — pass `--export-dir ~/Downloads` to the CLI to test sandboxed PDF output on disk.
3. Open the **Resources** tab and read `inkboard://boards`,
   `inkboard://boards/{boardId}`, or `inkboard://boards/{boardId}/preview`.

### Option C: Interactive Testing in Offline `.inkboard` Archive Mode

You can test the MCP server without opening a browser by pointing it at an
exported `.inkboard` backup file or folder:

```bash
npx @modelcontextprotocol/inspector node /ABS/PATH/TO/inkboard/packages/mcp-server/dist/cli.js --inkboard-file /path/to/inkboard-backup.inkboard
```

> **Tip (`--read-only`):** Add `--read-only` to any command above to disable all
> write tools (`create_board`, `add_text_box`, `update_text_box`, `add_stroke`,
> `delete_objects`).

---

## Connecting AI Clients

### Claude Desktop

Edit your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the `inkboard` entry using the absolute path to `node` and the built CLI
(GUI apps on macOS often do not load `nvm`/Homebrew `PATH`, so using the full
`which node` path such as `/opt/homebrew/bin/node` avoids spawn errors):

```json
{
  "mcpServers": {
    "inkboard": {
      "command": "/opt/homebrew/bin/node",
      "args": [
        "/ABS/PATH/TO/inkboard/packages/mcp-server/dist/cli.js",
        "--token",
        "<SESSION_TOKEN>",
        "--export-dir",
        "/ABS/PATH/TO/exports"
      ]
    }
  }
}
```

Restart Claude Desktop, keep Inkboard open with **Local MCP Bridge** enabled,
and ask Claude: _"List my Inkboard boards and summarize the active board."_

### Claude Code (CLI)

Register `inkboard` over `stdio` with `claude mcp add`:

```bash
claude mcp add inkboard --scope user -- node /ABS/PATH/TO/inkboard/packages/mcp-server/dist/cli.js --token <SESSION_TOKEN>
```

Verify registration:

```bash
claude mcp list
```

### Cursor & VS Code

- **Cursor:** `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a workspace)
- **VS Code:** `~/Library/Application Support/Code/User/mcp.json` on macOS,
  `%APPDATA%\Code\User\mcp.json` on Windows, `~/.config/Code/User/mcp.json` on
  Linux (or `.vscode/mcp.json` per workspace)

Use the same `"command"` + `"args"` configuration shown for Claude Desktop (or
`"command": "inkboard-mcp"` if you ran `npm link --workspace=packages/mcp-server`).

### ChatGPT (Web & Desktop)

Unlike Claude Desktop, Claude Code, Cursor, and VS Code, **ChatGPT does not spawn local `stdio` subprocesses directly**—its MCP Apps / Connectors (Settings → Apps & Connectors → Developer Mode) require a **remote HTTPS Streamable HTTP endpoint**.

To connect ChatGPT to your local `inkboard-mcp` server:

1. **Start the stateless Streamable HTTP listener** locally on loopback (`127.0.0.1:<port>/mcp`), for example:
   `node /ABS/PATH/TO/inkboard/packages/mcp-server/dist/cli.js --http-port 4198 --token <SESSION_TOKEN> --read-only`
2. **Expose an HTTPS URL** to `http://127.0.0.1:4198/mcp` with a tunnel such as `cloudflared` or `ngrok`.
3. **Add the HTTPS connector URL** in ChatGPT under **Settings → Connectors /
   Developer Mode**.

> **Security warning for ChatGPT / remote tunnels:** Because a tunnel exposes an
> HTTPS endpoint reachable from OpenAI's servers, start with `--read-only` and
> do not pass `--export-dir` unless you intentionally trust the remote session.
> Keep Inkboard's pairing token secret and rotate it from the **Local MCP Bridge**
> dialog when finished.

---

## OS-Specific Local Setup

The local bridge binds strictly to `127.0.0.1`, so everything runs on loopback
with no external ports exposed. Setup details vary slightly by OS:

### macOS

- **Install Node.js:** `brew install node` (or use `nvm` / the official macOS
  pkg installer).
- **Client config paths:**
  - **Claude Desktop:**
    `~/Library/Application Support/Claude/claude_desktop_config.json`
  - **Cursor:** `~/.cursor/mcp.json` (or `.cursor/mcp.json` inside a workspace)
  - **VS Code:** `~/Library/Application Support/Code/User/mcp.json` (or
    `.vscode/mcp.json` per workspace)
- **Notes:**
  - Standard `npx` in `"command"` works out of the box when Node is on your
    default `PATH`. If you use `nvm` or Homebrew on Apple Silicon
    (`/opt/homebrew/bin/npx`), GUI apps like Claude Desktop may need the full
    binary path if they don't load your shell profile.
  - Use `Cmd+Z` in Inkboard to undo any live MCP edit.

### Windows (10 / 11)

- **Install Node.js:** `winget install OpenJS.NodeJS.LTS` (or the official
  Windows installer).
- **Client config paths:**
  - **Claude Desktop:** `%APPDATA%\Claude\claude_desktop_config.json`
  - **Cursor:** `%USERPROFILE%\.cursor\mcp.json`
  - **VS Code:** `%APPDATA%\Code\User\mcp.json` (or `.vscode\mcp.json` per
    workspace)
- **Notes:**
  - Some Windows GUI MCP hosts launch `"command"` without a shell, so use
    `"npx.cmd"` (or `"cmd"` with `["/c", "npx", "inkboard-mcp", ...]`) if `"npx"`
    fails to spawn:

    ```json
    {
      "mcpServers": {
        "inkboard": {
          "command": "cmd",
          "args": ["/c", "npx", "inkboard-mcp", "--token", "<SESSION_TOKEN>"]
        }
      }
    }
    ```

  - Escape backslashes in any configured `.inkboard` / export directory paths
    (for example, `"C:\\Users\\you\\Documents\\inkboard"`).
  - **WSL2 users:** If Inkboard is open in a Windows browser
    (`http://localhost:5173`) while your MCP client/server runs inside WSL2,
    run both on the same side (recommended: run the MCP server natively on
    Windows, or open the Linux browser / enable WSL2 `networkingMode=mirrored`
    so `127.0.0.1` is shared).
  - Use `Ctrl+Z` in Inkboard to undo any live MCP edit.

### Linux — Ubuntu (and Debian derivatives)

- **Install Node.js:** Use `nvm` or NodeSource for a current Node.js LTS
  release (Ubuntu's default `apt` `nodejs` package can be older depending on the
  Ubuntu LTS version).
- **Client config paths:**
  - **Cursor:** `~/.cursor/mcp.json`
  - **VS Code:** `~/.config/Code/User/mcp.json` (or `.vscode/mcp.json` per
    workspace)
  - **Terminal / Open-Source MCP Clients (e.g. Claude Code, Neovim, local
    agents):** Add the same `stdio` `command`/`args` entry in your client's
    config.
- **Notes:**
  - **Firewall (`ufw`):** Loopback traffic on `127.0.0.1` (`lo`) is allowed by
    default even when `ufw` is enabled.
  - **Snap / Flatpak browsers:** If you run Firefox or Chromium as a Snap or
    Flatpak, `http://localhost:5173` and WebSocket `127.0.0.1` work normally,
    while file exports saved from the browser go through the XDG desktop portal
    (usually into `~/Downloads`).

### Linux — Fedora

- **Install Node.js:** `sudo dnf install nodejs npm` (Fedora ships up-to-date
  Node.js packages in its standard repos, or use `nvm`).
- **Client config paths:**
  - **Cursor:** `~/.cursor/mcp.json`
  - **VS Code:** `~/.config/Code/User/mcp.json` (or `.vscode/mcp.json` per
    workspace)
- **Notes:**
  - **Firewall (`firewalld`) & SELinux:** Localhost (`127.0.0.1`) WebSocket
    traffic between your browser and the local MCP bridge is permitted by
    default without opening any firewall zone ports or modifying SELinux
    policies.
  - **Flatpak browsers (Fedora Silverblue / Workstation):** As on Ubuntu,
    `127.0.0.1` bridge connections work normally; if you configure an offline
    `.inkboard` backup or PDF export folder for the MCP server, pick a normal
    directory under `$HOME` (such as `~/Documents/inkboard`) that both your
    browser downloads/saves and the MCP server can access.

---

## How Different Users Can Use Inkboard MCP Locally

### 1. Students & Researchers (Study Notes & PDF Annotation)

**Scenario:** You import lecture slides or a research paper (PDF) onto an
Inkboard canvas, type questions and sticky notes beside key figures, and want a
study guide without leaving your desk.

**Example prompts:**

- _"List my boards and summarize all text boxes on my `Distributed Systems`
  board."_
- _"Find every note mentioning `Raft` or `consensus` and group the key takeaways
  into a summary box at the top-right of the canvas."_

**MCP primitives used:**

- `list_boards` — discovers your local boards and object counts.
- `get_board_summary` / `query_objects` — searches `text` objects and spatial
  regions (`x, y, width, height`) alongside imported PDF page dimensions.
- `summarize_board` (prompt) + `add_text_box` — turns scattered margin notes
  into a structured revision block right on the board.

---

### 2. Software Engineers & Architects (System Design & Code-to-Diagram)

**Scenario:** You are designing a service in Cursor or VS Code and want your
local coding assistant to either read an architecture sketch from Inkboard or
draw a fresh diagram from your codebase.

**Example prompts:**

- _"Read the `Auth Refactor` board and list all components and labels so we can
  write the implementation plan."_
- _"Use `diagram_to_board` to lay out our API gateway, worker queue, and
  Postgres database on a new board named `Event Pipeline`."_

**MCP primitives used:**

- `inkboard://boards/{boardId}` (resource) / `query_objects` — extracts text
  labels, bounding boxes, and stroke groups without drowning the context window
  in raw stroke point arrays.
- `create_board` — creates a dedicated board with your chosen background colour.
- `diagram_to_board` (prompt) + `add_text_box` + `add_stroke` — creates labeled
  boxes and connecting lines/arrows directly on the live canvas.

---

### 3. Product Designers, Writers & Brainstormers (Affinity Mapping)

**Scenario:** After a messy brainstorming session full of overlapping text boxes
and rough ideas, you want help organizing themes while staying in complete
control of the canvas.

**Example prompts:**

- _"Inspect my `Q3 Ideas` board, cluster related text boxes into three columns
  (`Quick Wins`, `Experiments`, `Later`), and tighten up duplicate wording."_

**MCP primitives used:**

- `organize_notes` (prompt) — analyzes existing `TextObject` positions and text.
- `update_text_box` — moves text boxes into clean columns and refines wording.
- `delete_objects` — removes merged duplicates inside a single Yjs transaction
  (so one `Ctrl+Z` / `Cmd+Z` restores everything if you prefer the original
  layout).

---

### 4. Team Leads & Documentation Authors (Meeting Summaries & PDF Exports)

**Scenario:** You run a local planning or retro session on Inkboard and need
clean notes and a single continuous PDF handout right afterward.

**Example prompts:**

- _"Summarize the `Sprint 14 Retro` board into Action Items and Owners, add a
  summary card on the left, and export the board to PDF."_

**MCP primitives used:**

- `summarize_board` (prompt) + `add_text_box` — captures structured action items
  on the canvas.
- `export_board_pdf` — runs Inkboard's export pipeline and saves a single
  continuous, vector-sharp PDF into your configured workspace directory.

---

### 5. Privacy-First / Read-Only Reviewers

**Scenario:** You are trying a new local model or prompt workflow and want strict
guarantees that nothing on your boards can be altered or leaked off-device.

**How to configure:**

- Launch the MCP server with `--read-only` (disables `create_board`,
  `add_text_box`, `update_text_box`, `add_stroke`, and `delete_objects`).
- Keep the bridge bound strictly to `127.0.0.1` with a fresh per-session token.
- Run a local LLM/agent client (for example, an IDE or local model runner)
  against `inkboard://boards` and `query_objects` only.

---

### 6. Headless / Offline Power Users (Planned Phase 3: `.inkboard` Archives)

**Scenario:** You want to batch-inspect or script reports across exported
`.inkboard` backup files in a folder without opening a browser tab.

**Planned workflow:**

- Point the MCP server at a sandboxed directory of `.inkboard` backups using
  the offline `BoardBackend` (Phase 3 in
  [`docs/mcp-server-plan.md`](mcp-server-plan.md)).
- Query board summaries or extract text inventories from CLI scripts or local
  agents while keeping path access restricted to your configured root folder.

---

## Local Best Practices & Guardrails

- **Start in `--read-only` mode** when testing new prompts or untrusted clients.
- **Undo is your safety net:** Because mutations run through Yjs transactions
  over the live bridge, you can press `Ctrl+Z` / `Cmd+Z` in Inkboard to revert
  unwanted AI edits.
- **Keep exports scoped:** Only allow `.inkboard` and PDF export paths inside
  explicitly configured project folders.
- **Mind image/PDF size:** Prefer `get_board_summary` and `query_objects` first
  before requesting raster previews or large PDF exports so your AI client's
  context stays fast and focused.
