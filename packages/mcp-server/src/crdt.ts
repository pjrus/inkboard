import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import {
  boundsOverlap,
  computeBoundsFlat,
  DEFAULT_BACKGROUND,
  defaultInkForBackground,
  estimateTextHeight,
  packPoints,
  transformedBounds,
  unionBounds,
} from "./geometry.js";
import {
  type Bounds,
  type CanvasObject,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  DEFAULT_TEXT_WIDTH,
  type FontFamilyId,
  type ImageObject,
  type PDFDocumentMetadata,
  type PenTool,
  type StrokeObject,
  type StrokePoint,
  type TextAlign,
  type TextObject,
} from "./schema.js";

export function newId(length = 12): string {
  return randomUUID().replace(/-/g, "").slice(0, length);
}

export interface ObjectCounts {
  total: number;
  strokes: number;
  text: number;
  images: number;
}

export interface StrokeSummary {
  id: string;
  type: "stroke";
  tool: PenTool;
  color: string;
  width: number;
  pointCount: number;
  bounds: Bounds;
  createdAt: number;
  points?: number[];
}

export type CanvasObjectView = StrokeSummary | ImageObject | TextObject;

export interface BoardSummaryData {
  background: string;
  contentBounds: Bounds | null;
  objectCounts: ObjectCounts;
  pdfDocuments: PDFDocumentMetadata[];
  textBoxes: (TextObject & { bounds: Bounds; })[];
  images: (ImageObject & { bounds: Bounds; })[];
  strokes: StrokeSummary[];
}

export interface QueryObjectsFilter {
  type?: "stroke" | "image" | "text";
  bounds?: { x: number; y: number; width: number; height: number; };
  textQuery?: string;
  includeStrokePoints?: boolean;
  limit?: number;
}

export interface AddTextBoxParams {
  x: number;
  y: number;
  text: string;
  width?: number;
  fontFamily?: FontFamilyId;
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
  textAlign?: TextAlign;
  rotation?: number;
}

export interface UpdateTextBoxParams {
  objectId: string;
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  fontFamily?: FontFamilyId;
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
  textAlign?: TextAlign;
  rotation?: number;
}

export interface AddStrokeParams {
  tool?: PenTool;
  color?: string;
  width?: number;
  points: StrokePoint[];
}

/**
 * Node-side Yjs wrapper mirroring `src/document/crdt.ts`.
 * Produces standard Yjs deltas (`Uint8Array`) that merge safely with live
 * browser tabs and `.inkboard` archives.
 */
export class BoardDoc {
  readonly ydoc: Y.Doc;
  readonly objects: Y.Map<Y.Map<unknown>>;
  readonly pdfDocuments: Y.Map<Y.Map<unknown>>;
  readonly settings: Y.Map<unknown>;

  constructor(initialUpdate?: Uint8Array) {
    this.ydoc = new Y.Doc();
    if (initialUpdate && initialUpdate.byteLength > 0) {
      Y.applyUpdate(this.ydoc, initialUpdate);
    }
    this.objects = this.ydoc.getMap("objects");
    this.pdfDocuments = this.ydoc.getMap("pdfDocuments");
    this.settings = this.ydoc.getMap("settings");
  }

  getBackground(): string {
    const bg = this.settings.get("background");
    return typeof bg === "string" && bg.length > 0 ? bg : DEFAULT_BACKGROUND;
  }

  getAllObjects(): CanvasObject[] {
    const list: CanvasObject[] = [];
    this.objects.forEach((m) => {
      list.push(toCanvasObject(m));
    });
    list.sort((a, b) => a.createdAt - b.createdAt);
    return list;
  }

  getObject(id: string): CanvasObject | null {
    const m = this.objects.get(id);
    return m ? toCanvasObject(m) : null;
  }

  getPDFDocuments(): PDFDocumentMetadata[] {
    const docs: PDFDocumentMetadata[] = [];
    this.pdfDocuments.forEach((m) => {
      docs.push(m.toJSON() as PDFDocumentMetadata);
    });
    docs.sort((a, b) => a.createdAt - b.createdAt);
    return docs;
  }

  getObjectCounts(): ObjectCounts {
    let strokes = 0;
    let text = 0;
    let images = 0;
    for (const o of this.getAllObjects()) {
      if (o.type === "stroke") strokes++;
      else if (o.type === "text") text++;
      else if (o.type === "image") images++;
    }
    return { total: strokes + text + images, strokes, text, images };
  }

  getSummary(includeStrokePoints = false): BoardSummaryData {
    const all = this.getAllObjects();
    const background = this.getBackground();
    const contentBounds = unionBounds(all.map(transformedBounds));
    const textBoxes: (TextObject & { bounds: Bounds; })[] = [];
    const images: (ImageObject & { bounds: Bounds; })[] = [];
    const strokes: StrokeSummary[] = [];

    for (const o of all) {
      if (o.type === "text") {
        textBoxes.push({
          ...o,
          height: estimateTextHeight(o),
          bounds: transformedBounds(o),
        });
      } else if (o.type === "image") {
        images.push({
          ...o,
          bounds: transformedBounds(o),
        });
      } else if (o.type === "stroke") {
        strokes.push(summarizeStroke(o, includeStrokePoints));
      }
    }

    return {
      background,
      contentBounds,
      objectCounts: {
        total: all.length,
        strokes: strokes.length,
        text: textBoxes.length,
        images: images.length,
      },
      pdfDocuments: this.getPDFDocuments(),
      textBoxes,
      images,
      strokes,
    };
  }

  queryObjects(filter: QueryObjectsFilter): CanvasObjectView[] {
    const all = this.getAllObjects();
    const limit = filter.limit ?? 100;
    const region: Bounds | null = filter.bounds
      ? {
        minX: filter.bounds.x,
        minY: filter.bounds.y,
        maxX: filter.bounds.x + filter.bounds.width,
        maxY: filter.bounds.y + filter.bounds.height,
      }
      : null;
    const needle = filter.textQuery?.trim().toLowerCase() ?? "";

    const out: CanvasObjectView[] = [];
    for (const o of all) {
      if (filter.type && o.type !== filter.type) continue;
      if (region && !boundsOverlap(transformedBounds(o), region)) continue;
      if (needle) {
        if (o.type !== "text") continue;
        if (!o.text.toLowerCase().includes(needle)) continue;
      }
      if (o.type === "stroke") {
        out.push(summarizeStroke(o, Boolean(filter.includeStrokePoints)));
      } else {
        out.push(o);
      }
      if (out.length >= limit) break;
    }
    return out;
  }

  setBackground(colour: string): Uint8Array {
    return this.captureDelta(() => {
      this.ydoc.transact(() => {
        this.settings.set("background", colour);
      });
    });
  }

  addTextBox(
    input: AddTextBoxParams,
  ): { object: TextObject; delta: Uint8Array; } {
    const now = Date.now();
    const bg = this.getBackground();
    const obj: TextObject = {
      id: newId(),
      type: "text",
      x: input.x,
      y: input.y,
      width: input.width ?? DEFAULT_TEXT_WIDTH,
      text: input.text,
      fontFamily: input.fontFamily ?? DEFAULT_FONT_FAMILY,
      fontSize: input.fontSize ?? DEFAULT_FONT_SIZE,
      color: input.color ?? defaultInkForBackground(bg),
      ...(input.backgroundColor && input.backgroundColor !== "transparent"
        ? { backgroundColor: input.backgroundColor }
        : {}),
      textAlign: input.textAlign ?? "left",
      ...(input.rotation !== undefined ? { rotation: input.rotation } : {}),
      createdAt: now,
      updatedAt: now,
      createdBy: "mcp",
    };

    const delta = this.captureDelta(() => {
      this.ydoc.transact(() => {
        const m = toYMap({ ...obj, text: undefined });
        const ytext = new Y.Text();
        if (obj.text) ytext.insert(0, obj.text);
        m.set("text", ytext);
        this.objects.set(obj.id, m);
      });
    });

    return { object: obj, delta };
  }

  updateTextBox(
    input: UpdateTextBoxParams,
  ): { object: TextObject; delta: Uint8Array; } {
    const m = this.objects.get(input.objectId);
    if (!m) {
      throw new Error(`Object "${input.objectId}" not found on this board.`);
    }
    if (m.get("type") !== "text") {
      throw new Error(
        `Object "${input.objectId}" is of type "${
          String(m.get("type"))
        }", not "text".`,
      );
    }

    const now = Date.now();
    const delta = this.captureDelta(() => {
      this.ydoc.transact(() => {
        if (input.text !== undefined) {
          let ytext = m.get("text");
          if (!(ytext instanceof Y.Text)) {
            ytext = new Y.Text();
            m.set("text", ytext);
          }
          const yt = ytext as Y.Text;
          if (yt.length > 0) yt.delete(0, yt.length);
          if (input.text.length > 0) yt.insert(0, input.text);
        }
        if (input.x !== undefined) m.set("x", input.x);
        if (input.y !== undefined) m.set("y", input.y);
        if (input.width !== undefined) m.set("width", input.width);
        if (input.fontFamily !== undefined) {
          m.set("fontFamily", input.fontFamily);
        }
        if (input.fontSize !== undefined) m.set("fontSize", input.fontSize);
        if (input.color !== undefined) m.set("color", input.color);
        if (input.backgroundColor !== undefined) {
          if (
            input.backgroundColor === ""
            || input.backgroundColor === "transparent"
          ) {
            m.delete("backgroundColor");
          } else {
            m.set("backgroundColor", input.backgroundColor);
          }
        }
        if (input.textAlign !== undefined) m.set("textAlign", input.textAlign);
        if (input.rotation !== undefined) m.set("rotation", input.rotation);
        m.set("updatedAt", now);
      });
    });

    return { object: toCanvasObject(m) as TextObject, delta };
  }

  addStroke(
    input: AddStrokeParams,
  ): { object: StrokeObject; delta: Uint8Array; } {
    const bg = this.getBackground();
    const tool = input.tool ?? "pen";
    const width = input.width ?? (tool === "highlighter" ? 4 : 3);
    const flatPoints = packPoints(input.points);
    const bounds = computeBoundsFlat(flatPoints, width);
    const obj: StrokeObject = {
      id: newId(),
      type: "stroke",
      tool,
      color: input.color
        ?? (tool === "highlighter" ? "#ffe838" : defaultInkForBackground(bg)),
      width,
      points: flatPoints,
      bounds,
      createdAt: Date.now(),
      createdBy: "mcp",
    };

    const delta = this.captureDelta(() => {
      this.ydoc.transact(() => {
        this.objects.set(obj.id, toYMap(obj));
      });
    });

    return { object: obj, delta };
  }

  deleteObjects(
    ids: string[],
  ): { deletedIds: string[]; notFoundIds: string[]; delta: Uint8Array; } {
    const deletedIds: string[] = [];
    const notFoundIds: string[] = [];

    const delta = this.captureDelta(() => {
      this.ydoc.transact(() => {
        for (const id of ids) {
          if (this.objects.has(id)) {
            this.objects.delete(id);
            deletedIds.push(id);
          } else {
            notFoundIds.push(id);
          }
        }
      });
    });

    return { deletedIds, notFoundIds, delta };
  }

  encodeState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc);
  }

  destroy(): void {
    this.ydoc.destroy();
  }

  private captureDelta(fn: () => void): Uint8Array {
    const sv = Y.encodeStateVector(this.ydoc);
    fn();
    return Y.encodeStateAsUpdate(this.ydoc, sv);
  }
}

export function summarizeStroke(
  s: StrokeObject,
  includePoints = false,
): StrokeSummary {
  const summary: StrokeSummary = {
    id: s.id,
    type: "stroke",
    tool: s.tool,
    color: s.color,
    width: s.width,
    pointCount: Math.floor(s.points.length / 3),
    bounds: s.bounds,
    createdAt: s.createdAt,
  };
  if (includePoints) {
    summary.points = s.points;
  }
  return summary;
}

function toCanvasObject(m: Y.Map<unknown>): CanvasObject {
  const o = m.toJSON();
  if (o.type === "pdf-page") o.type = "image";
  return o as CanvasObject;
}

function toYMap(obj: object): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) m.set(k, v);
  }
  return m;
}
