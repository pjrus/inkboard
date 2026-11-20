import type {
  AddStrokeParams,
  AddTextBoxParams,
  BoardSummaryData,
  CanvasObjectView,
  ObjectCounts,
  QueryObjectsFilter,
  UpdateTextBoxParams,
} from "../crdt.js";
import type { CanvasObject, StrokeObject, TextObject } from "../schema.js";

export interface BoardMetadata {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  isActive?: boolean;
  background: string;
  objectCounts: ObjectCounts;
}

export interface BoardSummary extends BoardSummaryData {
  board: {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    isActive?: boolean;
  };
}

export interface ExportPdfResult {
  fileName: string;
  pageCount: number;
  byteLength: number;
  outputPath?: string;
  bytesBase64?: string;
}

export interface BoardPreviewResult {
  mimeType: "image/png";
  dataBase64: string;
  width: number;
  height: number;
}

export interface ListBoardsOptions {
  query?: string;
  sort?: "updatedAt" | "createdAt" | "name";
  order?: "asc" | "desc";
}

export interface BoardBackend {
  readonly readOnly: boolean;

  listBoards(options?: ListBoardsOptions): Promise<BoardMetadata[]>;
  getBoardSummary(
    boardId: string,
    options?: { includeStrokePoints?: boolean; },
  ): Promise<BoardSummary>;
  getObject(boardId: string, objectId: string): Promise<CanvasObject | null>;
  queryObjects(
    boardId: string,
    filter: QueryObjectsFilter,
  ): Promise<CanvasObjectView[]>;
  exportBoardPdf(
    boardId: string,
    options?: { outputPath?: string; includeBase64?: boolean; },
  ): Promise<ExportPdfResult>;
  exportBoardPreview(boardId: string): Promise<BoardPreviewResult>;

  createBoard(input: {
    name?: string;
    background?: string;
  }): Promise<BoardMetadata>;
  addTextBox(boardId: string, input: AddTextBoxParams): Promise<TextObject>;
  updateTextBox(
    boardId: string,
    input: UpdateTextBoxParams,
  ): Promise<TextObject>;
  addStroke(boardId: string, input: AddStrokeParams): Promise<StrokeObject>;
  deleteObjects(
    boardId: string,
    objectIds: string[],
  ): Promise<{ deletedIds: string[]; notFoundIds: string[]; }>;
}
