import type { ObjectCounts } from "../crdt.js";

export const DEFAULT_BRIDGE_PORT = 4197;
export const BRIDGE_PROTOCOL_VERSION = 1;

export interface BridgeBoardMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
  background: string;
  objectCounts: ObjectCounts;
}

export interface BridgeMethodMap {
  list_boards: {
    params: Record<string, never>;
    result: { boards: BridgeBoardMeta[]; };
  };
  get_board_state: {
    params: { boardId: string; };
    result: {
      board: {
        id: string;
        name: string;
        createdAt: number;
        updatedAt: number;
        isActive: boolean;
      };
      stateUpdateBase64: string;
    };
  };
  create_board: {
    params: { name?: string; background?: string; };
    result: { board: BridgeBoardMeta; };
  };
  apply_yjs_update: {
    params: { boardId: string; updateBase64: string; };
    result: { stateUpdateBase64: string; updatedAt: number; };
  };
  export_board_pdf: {
    params: { boardId: string; };
    result: {
      bytesBase64: string;
      fileName: string;
      pageCount: number;
    };
  };
  export_board_preview: {
    params: { boardId: string; maxDimension?: number; };
    result: {
      dataBase64: string;
      mimeType: "image/png";
      width: number;
      height: number;
    };
  };
}

export type BridgeMethod = keyof BridgeMethodMap;

export interface BridgeHelloMessage {
  type: "hello";
  protocolVersion: number;
  token: string;
  tabId: string;
  activeBoardId: string | null;
}

export interface BridgeHelloAckMessage {
  type: "hello_ack";
  protocolVersion: number;
  readOnly: boolean;
}

export interface BridgeActiveBoardChangedMessage {
  type: "active_board_changed";
  activeBoardId: string | null;
}

export interface BridgeRequestMessage<M extends BridgeMethod = BridgeMethod> {
  type: "request";
  requestId: string;
  method: M;
  params: BridgeMethodMap[M]["params"];
}

export type BridgeResponseMessage<M extends BridgeMethod = BridgeMethod> =
  | {
    type: "response";
    requestId: string;
    ok: true;
    result: BridgeMethodMap[M]["result"];
  }
  | {
    type: "response";
    requestId: string;
    ok: false;
    error: { code: string; message: string; };
  };

export type BridgeClientMessage =
  | BridgeHelloMessage
  | BridgeActiveBoardChangedMessage
  | BridgeResponseMessage;

export type BridgeServerMessage =
  | BridgeHelloAckMessage
  | BridgeRequestMessage;
