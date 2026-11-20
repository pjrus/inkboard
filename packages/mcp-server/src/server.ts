import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BoardBackend } from "./backend/BoardBackend.js";
import {
  addStrokeInputSchema,
  addTextBoxInputSchema,
  createBoardInputSchema,
  deleteObjectsInputSchema,
  exportBoardPdfInputSchema,
  getBoardSummaryInputSchema,
  listBoardsInputSchema,
  queryObjectsInputSchema,
  updateTextBoxInputSchema,
} from "./schema.js";

export interface InkboardMcpServerOptions {
  backend: BoardBackend;
  readOnly?: boolean;
  version?: string;
}

function jsonContent(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorContent(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

export function createInkboardMcpServer(
  options: InkboardMcpServerOptions,
): McpServer {
  const { backend } = options;
  const readOnly = Boolean(options.readOnly ?? backend.readOnly);

  const server = new McpServer(
    {
      name: "inkboard",
      version: options.version ?? "0.1.0",
    },
    {
      capabilities: {
        resources: {},
        tools: {},
        prompts: {},
      },
    },
  );

  // ---- Resources (Read-Only Context) ---------------------------------

  server.registerResource(
    "boards",
    "inkboard://boards",
    {
      title: "Inkboard Boards",
      description:
        "List of available Inkboard whiteboards with object counts and metadata.",
      mimeType: "application/json",
    },
    async (uri) => {
      const boards = await backend.listBoards();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ boards }, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    "board-summary",
    new ResourceTemplate("inkboard://boards/{boardId}", {
      list: async () => {
        try {
          const boards = await backend.listBoards();
          return {
            resources: boards.map((b) => ({
              uri: `inkboard://boards/${encodeURIComponent(b.id)}`,
              name: b.name,
              description:
                `Board "${b.name}" (${b.objectCounts.total} objects)`,
              mimeType: "application/json",
            })),
          };
        } catch {
          return { resources: [] };
        }
      },
    }),
    {
      title: "Inkboard Board Summary",
      description:
        "Full board summary including background, content bounds, text boxes, PDFs, and stroke summaries.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const boardId = decodeURIComponent(String(variables.boardId ?? ""));
      const summary = await backend.getBoardSummary(boardId);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    "board-object",
    new ResourceTemplate("inkboard://boards/{boardId}/objects/{objectId}", {
      list: undefined,
    }),
    {
      title: "Inkboard Canvas Object",
      description:
        "Detailed JSON for a single CanvasObject (stroke, image, or text).",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const boardId = decodeURIComponent(String(variables.boardId ?? ""));
      const objectId = decodeURIComponent(String(variables.objectId ?? ""));
      const object = await backend.getObject(boardId, objectId);
      if (!object) {
        throw new Error(
          `Object "${objectId}" not found on board "${boardId}".`,
        );
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(object, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    "board-preview",
    new ResourceTemplate("inkboard://boards/{boardId}/preview", {
      list: undefined,
    }),
    {
      title: "Inkboard Board Preview",
      description: "Rasterized PNG preview of the board content bounds.",
      mimeType: "image/png",
    },
    async (uri, variables) => {
      const boardId = decodeURIComponent(String(variables.boardId ?? ""));
      const preview = await backend.exportBoardPreview(boardId);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "image/png",
            blob: preview.dataBase64,
          },
        ],
      };
    },
  );

  // ---- Read & Query Tools --------------------------------------------

  server.registerTool(
    "list_boards",
    {
      title: "List Boards",
      description:
        "List available Inkboard whiteboards with optional substring filter and sorting.",
      inputSchema: listBoardsInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const boards = await backend.listBoards(args);
        return jsonContent({ boards, count: boards.length });
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "get_board_summary",
    {
      title: "Get Board Summary",
      description:
        "Return board metadata, background, content bounds, PDF documents, text boxes, images, and compact stroke summaries (raw stroke points omitted unless includeStrokePoints=true).",
      inputSchema: getBoardSummaryInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const summary = await backend.getBoardSummary(args.boardId, {
          includeStrokePoints: args.includeStrokePoints,
        });
        return jsonContent(summary);
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "query_objects",
    {
      title: "Query Objects",
      description:
        "Filter objects on a board by type (stroke, image, text), world bounding box, or text substring.",
      inputSchema: queryObjectsInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const objects = await backend.queryObjects(args.boardId, {
          type: args.type,
          bounds: args.bounds,
          textQuery: args.textQuery,
          includeStrokePoints: args.includeStrokePoints,
          limit: args.limit,
        });
        return jsonContent({
          boardId: args.boardId,
          count: objects.length,
          objects,
        });
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "export_board_pdf",
    {
      title: "Export Board PDF",
      description:
        "Generate a single-page vector-sharp PDF export of a board using Inkboard's export pipeline. Optionally writes to a sandboxed path inside --export-dir.",
      inputSchema: exportBoardPdfInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const result = await backend.exportBoardPdf(args.boardId, {
          outputPath: args.outputPath,
          includeBase64: args.includeBase64,
        });
        return jsonContent(result);
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  // ---- Write & Mutation Tools (CRDT-Safe, disabled in --read-only) ---

  if (!readOnly) {
    server.registerTool(
      "create_board",
      {
        title: "Create Board",
        description:
          "Create a new Inkboard whiteboard with an optional name and hex background colour.",
        inputSchema: createBoardInputSchema,
      },
      async (args) => {
        try {
          const board = await backend.createBoard(args);
          return jsonContent({ board });
        } catch (err) {
          return errorContent(err);
        }
      },
    );

    server.registerTool(
      "add_text_box",
      {
        title: "Add Text Box",
        description:
          "Insert a TextObject at world coordinates (x, y) on a board inside a CRDT transaction.",
        inputSchema: addTextBoxInputSchema,
      },
      async ({ boardId, ...input }) => {
        try {
          const object = await backend.addTextBox(boardId, input);
          return jsonContent({ boardId, object });
        } catch (err) {
          return errorContent(err);
        }
      },
    );

    server.registerTool(
      "update_text_box",
      {
        title: "Update Text Box",
        description:
          "Update text content, position, width, or styling of an existing TextObject.",
        inputSchema: updateTextBoxInputSchema,
      },
      async ({ boardId, ...input }) => {
        try {
          const object = await backend.updateTextBox(boardId, input);
          return jsonContent({ boardId, object });
        } catch (err) {
          return errorContent(err);
        }
      },
    );

    server.registerTool(
      "add_stroke",
      {
        title: "Add Stroke",
        description:
          "Insert a StrokeObject (pen, pencil, or highlighter) with validated points onto a board.",
        inputSchema: addStrokeInputSchema,
      },
      async ({ boardId, ...input }) => {
        try {
          const object = await backend.addStroke(boardId, input);
          return jsonContent({
            boardId,
            object: {
              id: object.id,
              type: object.type,
              tool: object.tool,
              color: object.color,
              width: object.width,
              pointCount: Math.floor(object.points.length / 3),
              bounds: object.bounds,
              createdAt: object.createdAt,
            },
          });
        } catch (err) {
          return errorContent(err);
        }
      },
    );

    server.registerTool(
      "delete_objects",
      {
        title: "Delete Objects",
        description:
          "Remove one or more objects by id from a board inside a single undoable Yjs transaction.",
        inputSchema: deleteObjectsInputSchema,
      },
      async (args) => {
        try {
          const result = await backend.deleteObjects(
            args.boardId,
            args.objectIds,
          );
          return jsonContent({ boardId: args.boardId, ...result });
        } catch (err) {
          return errorContent(err);
        }
      },
    );
  }

  // ---- Prompts (Reusable Workflows) ----------------------------------

  server.registerPrompt(
    "summarize_board",
    {
      title: "Summarize Board",
      description:
        "Gather all text boxes and spatial layout from an Inkboard board and produce a structured summary and action items.",
      argsSchema: {
        boardId: z.string().describe("Target board ID"),
        focus: z.string().optional().describe(
          "Optional topic or angle to emphasize",
        ),
      },
    },
    async ({ boardId, focus }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Inspect Inkboard board "${boardId}" by calling \`get_board_summary\` (with includeStrokePoints=false) and, if needed, \`query_objects\`.`,
              "Analyze all text boxes, their spatial grouping, and any imported PDF document metadata.",
              focus ? `Focus especially on: ${focus}` : "",
              "Produce a clear, structured summary with:",
              "1. Main themes / sections (preserving spatial context where helpful)",
              "2. Key takeaways",
              "3. Concrete action items / open questions",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "organize_notes",
    {
      title: "Organize Notes",
      description:
        "Analyze scattered text boxes on a board and group or clean them up into a tidy spatial layout.",
      argsSchema: {
        boardId: z.string().describe("Target board ID"),
        goal: z.string().optional().describe(
          "Optional grouping structure (e.g. columns or themes)",
        ),
      },
    },
    async ({ boardId, goal }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Read Inkboard board "${boardId}" via \`get_board_summary\`.`,
              "Inspect the existing text boxes, their coordinates, widths, and content.",
              goal ? `Target organization goal: ${goal}` : "",
              "Propose clean affinity clusters (columns or sections with non-overlapping coordinates and ~40px vertical spacing).",
              readOnly
                ? "Note: This server is in read-only mode, so present the proposed coordinates and edits instead of mutating the board."
                : "Apply the layout cleanly using `update_text_box` (and `add_text_box` for section headers, or `delete_objects` in a single batch for merged duplicates).",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "diagram_to_board",
    {
      title: "Diagram to Board",
      description:
        "Convert an architecture description or outline into positioned TextObjects and connecting StrokeObjects on an Inkboard board.",
      argsSchema: {
        description: z.string().describe(
          "System, flow, or concept outline to diagram",
        ),
        boardId: z.string().optional().describe(
          "Existing board ID; if omitted, create a new board",
        ),
      },
    },
    async ({ description, boardId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              boardId
                ? `Inspect board "${boardId}" first via \`get_board_summary\` to check its background colour and existing content bounds so new elements do not overlap.`
                : "Create a new board via `create_board` with a clean title.",
              `Design a clear, non-overlapping diagram for:\n${description}`,
              "Guidelines:",
              "- Use `add_text_box` with `backgroundColor` cards (e.g. `#e0f2fe`, `#dcfce7`, `#fff9c4`, `#f3e8ff`) and dark `#1b1b1f` text for readable component nodes.",
              "- Space nodes generously (e.g. width 240, horizontal gap >= 120, vertical gap >= 100).",
              "- Use `add_stroke` (`tool: 'pen'`) with clean straight/orthogonal point paths and small arrowhead segments between node edges to connect related components.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}
