import { CanvasDocument } from "../document/crdt";
import { DocumentPersistence } from "../document/persistence";
import { LocalProvider } from "../collaboration/LocalProvider";
import type { SyncProvider } from "../collaboration/SyncProvider";
import type { BoardRecord } from "../storage/db";
import type { Viewport } from "../document/schema";
import { boardRepository } from "./BoardRepository";

/**
 * Everything needed to work on one open board: the CRDT document, its
 * persistence pipeline and the (currently local-only) sync provider.
 */
export class BoardSession {
  private viewportTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  private constructor(
    readonly board: BoardRecord,
    readonly doc: CanvasDocument,
    readonly persistence: DocumentPersistence,
    readonly provider: SyncProvider,
  ) {}

  static async open(boardId: string): Promise<BoardSession> {
    const board = await boardRepository.get(boardId);
    if (!board) throw new Error("Board not found");
    const doc = new CanvasDocument();
    const persistence = new DocumentPersistence(boardId, doc);
    await persistence.load();
    persistence.start();
    const provider = new LocalProvider();
    await provider.connect(boardId, doc);
    return new BoardSession(board, doc, persistence, provider);
  }

  /** Debounced: the viewport changes on every pan frame. */
  saveViewport(vp: Viewport) {
    if (this.closed) return;
    if (this.viewportTimer) clearTimeout(this.viewportTimer);
    this.viewportTimer = setTimeout(() => {
      this.viewportTimer = null;
      void boardRepository.saveViewport(this.board.id, vp);
    }, 400);
  }

  async close(finalViewport?: Viewport) {
    this.closed = true;
    if (this.viewportTimer) clearTimeout(this.viewportTimer);
    if (finalViewport) await boardRepository.saveViewport(this.board.id, finalViewport);
    this.provider.disconnect();
    await this.persistence.destroy();
    this.doc.destroy();
  }
}
