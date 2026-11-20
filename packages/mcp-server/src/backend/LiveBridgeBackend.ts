import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BridgeServer } from "../bridge/BridgeServer.js";
import {
  type AddStrokeParams,
  type AddTextBoxParams,
  BoardDoc,
  type CanvasObjectView,
  type QueryObjectsFilter,
  type UpdateTextBoxParams,
} from "../crdt.js";
import { pdfFileName } from "../geometry.js";
import type { CanvasObject, StrokeObject, TextObject } from "../schema.js";
import {
  DEFAULT_MAX_ASSET_BYTES,
  enforceAssetSizeLimit,
  resolveSandboxedPath,
} from "../security.js";
import type {
  BoardBackend,
  BoardMetadata,
  BoardPreviewResult,
  BoardSummary,
  ExportPdfResult,
  ListBoardsOptions,
} from "./BoardBackend.js";

export interface LiveBridgeBackendOptions {
  bridge: BridgeServer;
  readOnly?: boolean;
  exportDir?: string;
  maxAssetBytes?: number;
}

export class LiveBridgeBackend implements BoardBackend {
  readonly readOnly: boolean;
  private readonly bridge: BridgeServer;
  private readonly exportDir?: string;
  private readonly maxAssetBytes: number;

  constructor(options: LiveBridgeBackendOptions) {
    this.bridge = options.bridge;
    this.readOnly = Boolean(options.readOnly);
    this.exportDir = options.exportDir;
    this.maxAssetBytes = options.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES;
  }

  async listBoards(options: ListBoardsOptions = {}): Promise<BoardMetadata[]> {
    const res = await this.bridge.request("list_boards", {});
    let boards: BoardMetadata[] = res.boards;
    if (options.query) {
      const needle = options.query.trim().toLowerCase();
      boards = boards.filter((b) => b.name.toLowerCase().includes(needle));
    }
    const sort = options.sort ?? "updatedAt";
    const order = options.order ?? (sort === "name" ? "asc" : "desc");
    const dir = order === "asc" ? 1 : -1;
    boards = [...boards].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name) * dir;
      return (a[sort] - b[sort]) * dir;
    });
    return boards;
  }

  async getBoardSummary(
    boardId: string,
    options?: { includeStrokePoints?: boolean; },
  ): Promise<BoardSummary> {
    const state = await this.bridge.request(
      "get_board_state",
      { boardId },
      { boardId },
    );
    const doc = new BoardDoc(
      new Uint8Array(Buffer.from(state.stateUpdateBase64, "base64")),
    );
    try {
      const summary = doc.getSummary(Boolean(options?.includeStrokePoints));
      return {
        board: state.board,
        ...summary,
      };
    } finally {
      doc.destroy();
    }
  }

  async getObject(
    boardId: string,
    objectId: string,
  ): Promise<CanvasObject | null> {
    const state = await this.bridge.request(
      "get_board_state",
      { boardId },
      { boardId },
    );
    const doc = new BoardDoc(
      new Uint8Array(Buffer.from(state.stateUpdateBase64, "base64")),
    );
    try {
      return doc.getObject(objectId);
    } finally {
      doc.destroy();
    }
  }

  async queryObjects(
    boardId: string,
    filter: QueryObjectsFilter,
  ): Promise<CanvasObjectView[]> {
    const state = await this.bridge.request(
      "get_board_state",
      { boardId },
      { boardId },
    );
    const doc = new BoardDoc(
      new Uint8Array(Buffer.from(state.stateUpdateBase64, "base64")),
    );
    try {
      return doc.queryObjects(filter);
    } finally {
      doc.destroy();
    }
  }

  async exportBoardPdf(
    boardId: string,
    options: { outputPath?: string; includeBase64?: boolean; } = {},
  ): Promise<ExportPdfResult> {
    let resolvedOutputPath: string | undefined;
    if (options.outputPath) {
      if (!this.exportDir) {
        throw new Error(
          "Writing PDF files to disk requires starting the MCP server with --export-dir <directory>.",
        );
      }
      resolvedOutputPath = await resolveSandboxedPath(
        this.exportDir,
        options.outputPath,
      );
    }

    const res = await this.bridge.request(
      "export_board_pdf",
      { boardId },
      { boardId, timeoutMs: 60_000 },
    );
    const pdfBytes = Buffer.from(res.bytesBase64, "base64");
    const safeName = pdfFileName(res.fileName.replace(/\.pdf$/i, ""));

    if (resolvedOutputPath) {
      await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
      await writeFile(resolvedOutputPath, pdfBytes);
    }

    const includeBase64 = options.includeBase64 ?? !resolvedOutputPath;
    if (includeBase64) {
      enforceAssetSizeLimit(
        pdfBytes.byteLength,
        this.maxAssetBytes,
        "Exported PDF",
      );
    }

    return {
      fileName: safeName,
      pageCount: res.pageCount,
      byteLength: pdfBytes.byteLength,
      ...(resolvedOutputPath ? { outputPath: resolvedOutputPath } : {}),
      ...(includeBase64 ? { bytesBase64: res.bytesBase64 } : {}),
    };
  }

  async exportBoardPreview(boardId: string): Promise<BoardPreviewResult> {
    const res = await this.bridge.request(
      "export_board_preview",
      { boardId, maxDimension: 1200 },
      { boardId, timeoutMs: 30_000 },
    );
    const bytes = Buffer.from(res.dataBase64, "base64");
    enforceAssetSizeLimit(
      bytes.byteLength,
      this.maxAssetBytes,
      "Board preview",
    );
    return res;
  }

  async createBoard(input: {
    name?: string;
    background?: string;
  }): Promise<BoardMetadata> {
    this.assertWritable();
    const res = await this.bridge.request("create_board", input);
    return res.board;
  }

  async addTextBox(
    boardId: string,
    input: AddTextBoxParams,
  ): Promise<TextObject> {
    this.assertWritable();
    return this.mutateBoard(boardId, (doc) => doc.addTextBox(input));
  }

  async updateTextBox(
    boardId: string,
    input: UpdateTextBoxParams,
  ): Promise<TextObject> {
    this.assertWritable();
    return this.mutateBoard(boardId, (doc) => doc.updateTextBox(input));
  }

  async addStroke(
    boardId: string,
    input: AddStrokeParams,
  ): Promise<StrokeObject> {
    this.assertWritable();
    return this.mutateBoard(boardId, (doc) => doc.addStroke(input));
  }

  async deleteObjects(
    boardId: string,
    objectIds: string[],
  ): Promise<{ deletedIds: string[]; notFoundIds: string[]; }> {
    this.assertWritable();
    const res = await this.mutateBoard(boardId, (doc) => {
      const out = doc.deleteObjects(objectIds);
      return {
        object: {
          deletedIds: out.deletedIds,
          notFoundIds: out.notFoundIds,
        },
        delta: out.delta,
      };
    });
    return res;
  }

  private async mutateBoard<T>(
    boardId: string,
    fn: (doc: BoardDoc) => { object: T; delta: Uint8Array; },
  ): Promise<T> {
    const state = await this.bridge.request(
      "get_board_state",
      { boardId },
      { boardId },
    );
    const doc = new BoardDoc(
      new Uint8Array(Buffer.from(state.stateUpdateBase64, "base64")),
    );
    try {
      const { object, delta } = fn(doc);
      if (delta.byteLength > 0) {
        await this.bridge.request(
          "apply_yjs_update",
          {
            boardId,
            updateBase64: Buffer.from(delta).toString("base64"),
          },
          { boardId },
        );
      }
      return object;
    } finally {
      doc.destroy();
    }
  }

  private assertWritable(): void {
    if (this.readOnly) {
      throw new Error(
        "MCP server is running in --read-only mode; write operations are disabled.",
      );
    }
  }
}
