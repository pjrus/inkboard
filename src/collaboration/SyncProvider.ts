import type { CanvasDocument } from "../document/crdt";

/**
 * Abstraction over how a board's CRDT state is shared with other replicas.
 *
 * The renderer and interaction code never talk to a provider directly; they
 * only see the CanvasDocument. A WebRTC or WebSocket provider can be added by
 * implementing this interface and applying/broadcasting Yjs updates.
 */
export type SyncStatus = "local" | "offline" | "connecting" | "synced";

export interface Presence {
  clientId: number;
  name?: string;
  cursor?: { x: number; y: number };
  tool?: string;
  viewport?: { x: number; y: number; scale: number };
}

export interface SyncProvider {
  connect(documentId: string, doc: CanvasDocument): Promise<void>;
  disconnect(): void;
  getStatus(): SyncStatus;
  onStatus(listener: (status: SyncStatus) => void): () => void;
  /** Ephemeral presence; never persisted. */
  setPresence?(presence: Partial<Presence>): void;
  onPresence?(listener: (peers: Presence[]) => void): () => void;
  /** Hook for a future binary asset exchange (page images etc). */
  requestAsset?(assetId: string): Promise<Blob | undefined>;
}
