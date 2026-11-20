import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import * as Y from "yjs";
import {
  type AddStrokeParams,
  type AddTextBoxParams,
  BoardDoc,
  type CanvasObjectView,
  newId,
  type QueryObjectsFilter,
  type UpdateTextBoxParams,
} from "../crdt.js";
import type { CanvasObject, StrokeObject, TextObject } from "../schema.js";
import { resolveSandboxedPath } from "../security.js";
import type {
  BoardBackend,
  BoardMetadata,
  BoardPreviewResult,
  BoardSummary,
  ExportPdfResult,
  ListBoardsOptions,
} from "./BoardBackend.js";

const MAGIC = "INKBOARD";
const PREAMBLE_BYTES = MAGIC.length + 4;
const SUPPORTED_VERSION = 1;

interface BackupAssetMeta {
  id: string;
  mimeType: string;
  width?: number;
  height?: number;
  size: number;
  createdAt: number;
}

interface BackupBoardMeta {
  id?: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  updateSize: number;
  assets: BackupAssetMeta[];
}

interface BackupHeader {
  version: number;
  boards: BackupBoardMeta[];
}

interface ParsedArchiveBoard {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  update: Uint8Array;
  assets: { meta: BackupAssetMeta; data: Uint8Array; }[];
}

interface ParsedArchive {
  filePath: string;
  boards: ParsedArchiveBoard[];
}

export interface InkboardFileBackendOptions {
  /** Single `.inkboard` archive path OR root directory containing `.inkboard` files. */
  rootPath: string;
  isFile?: boolean;
  readOnly?: boolean;
}

/**
 * Offline `.inkboard` archive backend (Phase 3).
 *
 * Reads and optionally updates `.inkboard` backup files directly in Node
 * without requiring an open browser session. Every board id in a file is
 * addressed as `<relativeFilePath>#<index>` (or the board's embedded id if
 * present, with fallback to index).
 */
export class InkboardFileBackend implements BoardBackend {
  readonly readOnly: boolean;
  private readonly rootPath: string;
  private readonly isFile: boolean;

  constructor(options: InkboardFileBackendOptions) {
    this.rootPath = path.resolve(options.rootPath);
    this.isFile = Boolean(options.isFile);
    this.readOnly = Boolean(options.readOnly);
  }

  async listBoards(options: ListBoardsOptions = {}): Promise<BoardMetadata[]> {
    const files = await this.discoverArchives();
    const out: BoardMetadata[] = [];

    for (const filePath of files) {
      const archive = await readArchive(filePath);
      const rel = this.relativeName(filePath);
      for (let i = 0; i < archive.boards.length; i++) {
        const b = archive.boards[i];
        const doc = new BoardDoc(b.update);
        try {
          out.push({
            id: encodeBoardId(rel, i),
            name: b.name,
            createdAt: b.createdAt,
            updatedAt: b.updatedAt,
            background: doc.getBackground(),
            objectCounts: doc.getObjectCounts(),
          });
        } finally {
          doc.destroy();
        }
      }
    }

    let filtered = out;
    if (options.query) {
      const needle = options.query.trim().toLowerCase();
      filtered = filtered.filter((b) => b.name.toLowerCase().includes(needle));
    }
    const sort = options.sort ?? "updatedAt";
    const order = options.order ?? (sort === "name" ? "asc" : "desc");
    const dir = order === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name) * dir;
      return (a[sort] - b[sort]) * dir;
    });
  }

  async getBoardSummary(
    boardId: string,
    options?: { includeStrokePoints?: boolean; },
  ): Promise<BoardSummary> {
    const { board, rel } = await this.loadBoard(boardId);
    const doc = new BoardDoc(board.update);
    try {
      return {
        board: {
          id: encodeBoardId(rel, board.index),
          name: board.name,
          createdAt: board.createdAt,
          updatedAt: board.updatedAt,
        },
        ...doc.getSummary(Boolean(options?.includeStrokePoints)),
      };
    } finally {
      doc.destroy();
    }
  }

  async getObject(
    boardId: string,
    objectId: string,
  ): Promise<CanvasObject | null> {
    const { board } = await this.loadBoard(boardId);
    const doc = new BoardDoc(board.update);
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
    const { board } = await this.loadBoard(boardId);
    const doc = new BoardDoc(board.update);
    try {
      return doc.queryObjects(filter);
    } finally {
      doc.destroy();
    }
  }

  async exportBoardPdf(): Promise<ExportPdfResult> {
    throw new Error(
      "PDF export requires a connected Inkboard browser tab over the local live bridge.",
    );
  }

  async exportBoardPreview(): Promise<BoardPreviewResult> {
    throw new Error(
      "PNG preview requires a connected Inkboard browser tab over the local live bridge.",
    );
  }

  async createBoard(input: {
    name?: string;
    background?: string;
  }): Promise<BoardMetadata> {
    this.assertWritable();
    const files = await this.discoverArchives();
    let targetFile: string;
    let archive: ParsedArchive;
    if (this.isFile) {
      targetFile = this.rootPath;
      archive = await readArchive(targetFile);
    } else if (files.length > 0) {
      targetFile = files[0];
      archive = await readArchive(targetFile);
    } else {
      targetFile = path.join(this.rootPath, "inkboard-boards.inkboard");
      archive = { filePath: targetFile, boards: [] };
    }

    const now = Date.now();
    const doc = new BoardDoc();
    try {
      if (input.background) doc.setBackground(input.background);
      const update = doc.encodeState();
      const index = archive.boards.length;
      const name = input.name?.trim() || "Untitled board";
      archive.boards.push({
        id: newId(10),
        name,
        createdAt: now,
        updatedAt: now,
        update,
        assets: [],
      });
      await writeArchiveAtomic(archive);
      return {
        id: encodeBoardId(this.relativeName(targetFile), index),
        name,
        createdAt: now,
        updatedAt: now,
        background: doc.getBackground(),
        objectCounts: doc.getObjectCounts(),
      };
    } finally {
      doc.destroy();
    }
  }

  async addTextBox(
    boardId: string,
    input: AddTextBoxParams,
  ): Promise<TextObject> {
    this.assertWritable();
    return this.mutateArchiveBoard(
      boardId,
      (doc) => doc.addTextBox(input).object,
    );
  }

  async updateTextBox(
    boardId: string,
    input: UpdateTextBoxParams,
  ): Promise<TextObject> {
    this.assertWritable();
    return this.mutateArchiveBoard(
      boardId,
      (doc) => doc.updateTextBox(input).object,
    );
  }

  async addStroke(
    boardId: string,
    input: AddStrokeParams,
  ): Promise<StrokeObject> {
    this.assertWritable();
    return this.mutateArchiveBoard(
      boardId,
      (doc) => doc.addStroke(input).object,
    );
  }

  async deleteObjects(
    boardId: string,
    objectIds: string[],
  ): Promise<{ deletedIds: string[]; notFoundIds: string[]; }> {
    this.assertWritable();
    return this.mutateArchiveBoard(boardId, (doc) => {
      const res = doc.deleteObjects(objectIds);
      return { deletedIds: res.deletedIds, notFoundIds: res.notFoundIds };
    });
  }

  private async mutateArchiveBoard<T>(
    boardId: string,
    fn: (doc: BoardDoc) => T,
  ): Promise<T> {
    const { archive, board } = await this.loadBoard(boardId);
    const doc = new BoardDoc(board.update);
    try {
      const result = fn(doc);
      archive.boards[board.index].update = Y.encodeStateAsUpdate(doc.ydoc);
      archive.boards[board.index].updatedAt = Date.now();
      await writeArchiveAtomic(archive);
      return result;
    } finally {
      doc.destroy();
    }
  }

  private async discoverArchives(): Promise<string[]> {
    if (this.isFile) return [this.rootPath];
    const entries = await readdir(this.rootPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".inkboard"))
      .map((e) => path.join(this.rootPath, e.name))
      .sort();
  }

  private relativeName(filePath: string): string {
    if (this.isFile) return path.basename(filePath);
    return path.relative(this.rootPath, filePath);
  }

  private async loadBoard(boardId: string): Promise<{
    archive: ParsedArchive;
    rel: string;
    board: ParsedArchiveBoard & { index: number; };
  }> {
    const hashIdx = boardId.lastIndexOf("#");
    if (hashIdx <= 0) {
      throw new Error(
        `Invalid offline boardId "${boardId}". Expected format "<archive>.inkboard#<index>".`,
      );
    }
    const rel = boardId.slice(0, hashIdx);
    const index = Number(boardId.slice(hashIdx + 1));
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`Invalid board index in "${boardId}".`);
    }

    const filePath = this.isFile
      ? (rel === path.basename(this.rootPath)
        ? this.rootPath
        : (() => {
          throw new Error(`Archive "${rel}" does not match configured file.`);
        })())
      : await resolveSandboxedPath(this.rootPath, rel);

    const archive = await readArchive(filePath);
    const found = archive.boards[index];
    if (!found) {
      throw new Error(`Board index ${index} not found in "${rel}".`);
    }
    return { archive, rel, board: { ...found, index } };
  }

  private assertWritable(): void {
    if (this.readOnly) {
      throw new Error(
        "MCP server is running in --read-only mode; write operations are disabled.",
      );
    }
  }
}

function encodeBoardId(relFile: string, index: number): string {
  return `${relFile}#${index}`;
}

async function readArchive(filePath: string): Promise<ParsedArchive> {
  const buf = await readFile(filePath);
  if (
    buf.byteLength < PREAMBLE_BYTES
    || buf.subarray(0, MAGIC.length).toString("ascii") !== MAGIC
  ) {
    throw new Error(`"${filePath}" is not a valid .inkboard archive.`);
  }
  const headerLen = buf.readUInt32LE(MAGIC.length);
  let offset = PREAMBLE_BYTES + headerLen;
  if (offset > buf.byteLength) {
    throw new Error(`"${filePath}" header is truncated.`);
  }
  const header = JSON.parse(
    buf.subarray(PREAMBLE_BYTES, offset).toString("utf8"),
  ) as BackupHeader;
  if (header.version !== SUPPORTED_VERSION) {
    throw new Error(
      `Unsupported .inkboard backup version ${header.version} in "${filePath}".`,
    );
  }
  let expectedEnd = offset;
  for (const b of header.boards) {
    expectedEnd += b.updateSize;
    for (const a of b.assets) expectedEnd += a.size;
  }
  if (!(expectedEnd <= buf.byteLength)) {
    throw new Error(`"${filePath}" is incomplete or corrupt.`);
  }

  const boards: ParsedArchiveBoard[] = [];
  for (let i = 0; i < header.boards.length; i++) {
    const b = header.boards[i];
    const update = new Uint8Array(buf.subarray(offset, offset + b.updateSize));
    offset += b.updateSize;
    const assets: { meta: BackupAssetMeta; data: Uint8Array; }[] = [];
    for (const a of b.assets) {
      const data = new Uint8Array(buf.subarray(offset, offset + a.size));
      offset += a.size;
      assets.push({ meta: a, data });
    }
    boards.push({
      id: b.id ?? String(i),
      name: String(b.name),
      createdAt: Number(b.createdAt) || Date.now(),
      updatedAt: Number(b.updatedAt) || Date.now(),
      update,
      assets,
    });
  }
  return { filePath, boards };
}

async function writeArchiveAtomic(archive: ParsedArchive): Promise<void> {
  const header: BackupHeader = {
    version: SUPPORTED_VERSION,
    boards: archive.boards.map((b) => ({
      name: b.name,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      updateSize: b.update.byteLength,
      assets: b.assets.map((a) => ({
        ...a.meta,
        size: a.data.byteLength,
      })),
    })),
  };
  const jsonBuf = Buffer.from(JSON.stringify(header), "utf8");
  const preamble = Buffer.alloc(PREAMBLE_BYTES);
  preamble.write(MAGIC, 0, "ascii");
  preamble.writeUInt32LE(jsonBuf.byteLength, MAGIC.length);

  const chunks: Uint8Array[] = [preamble, jsonBuf];
  for (const b of archive.boards) {
    chunks.push(b.update);
    for (const a of b.assets) {
      chunks.push(a.data);
    }
  }
  const tmpPath = `${archive.filePath}.${process.pid}.tmp`;
  await writeFile(tmpPath, Buffer.concat(chunks));
  await rename(tmpPath, archive.filePath);
}
