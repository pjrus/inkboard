import type { CanvasDocument } from "../document/crdt";
import type { SyncProvider, SyncStatus } from "./SyncProvider";

/** Local-only provider: the document lives in this browser and nowhere else. */
export class LocalProvider implements SyncProvider {
  private status: SyncStatus = "local";
  private listeners = new Set<(s: SyncStatus) => void>();

  async connect(_documentId: string, _doc: CanvasDocument): Promise<void> {
    this.setStatus("local");
  }

  disconnect(): void {
    this.setStatus("local");
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  onStatus(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setStatus(s: SyncStatus) {
    this.status = s;
    for (const l of this.listeners) l(s);
  }
}
