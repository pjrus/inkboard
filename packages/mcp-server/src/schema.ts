import { z } from "zod";

export const MIN_STROKE_WIDTH = 0.5;
export const MAX_STROKE_WIDTH = 40;
export const DEFAULT_TEXT_WIDTH = 300;
export const MIN_TEXT_WIDTH = 80;
export const MAX_TEXT_WIDTH = 1600;
export const DEFAULT_FONT_SIZE = 20;
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 200;
export const TEXT_LINE_HEIGHT = 1.35;
export const DEFAULT_FONT_FAMILY = "open-sans" as const;

export const PEN_TOOLS = ["pen", "pencil", "highlighter"] as const;
export type PenTool = (typeof PEN_TOOLS)[number];

export const FONT_FAMILIES = [
  "open-sans",
  "inter",
  "roboto",
  "lato",
] as const;
export type FontFamilyId = (typeof FONT_FAMILIES)[number];

export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export type PDFLayout = "vertical" | "horizontal";

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface StrokePoint {
  x: number;
  y: number;
  pressure?: number;
}

export interface StrokeObject {
  id: string;
  type: "stroke";
  tool: PenTool;
  color: string;
  width: number;
  points: number[];
  bounds: Bounds;
  createdAt: number;
  createdBy?: string;
}

export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageObject {
  id: string;
  type: "image";
  assetId: string;
  pdfDocumentId?: string;
  pageNumber?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  crop?: ImageCrop;
  rotation: number;
  createdAt: number;
}

export interface TextObject {
  id: string;
  type: "text";
  x: number;
  y: number;
  width: number;
  height?: number;
  text: string;
  fontFamily: FontFamilyId;
  fontSize: number;
  color: string;
  backgroundColor?: string;
  textAlign?: TextAlign;
  rotation?: number;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
}

export type CanvasObject = StrokeObject | ImageObject | TextObject;

export interface PDFDocumentMetadata {
  id: string;
  fileName: string;
  pageCount: number;
  layout: PDFLayout;
  sourceAssetId?: string;
  createdAt: number;
}

// ---- Zod schemas for MCP tool inputs ---------------------------------

export const hexColorSchema = z
  .string()
  .regex(
    /^#[0-9a-fA-F]{6}$/,
    "Color must be a 6-digit hex string like #1b1b1f",
  );

export const textBackgroundColorSchema = z.union([
  hexColorSchema,
  z.literal("transparent"),
  z.literal(""),
]);

export const finiteNumberSchema = z.number().finite();

export const boardIdSchema = z
  .string()
  .min(1, "boardId is required")
  .max(128, "boardId is too long");

export const objectIdSchema = z
  .string()
  .min(1, "objectId is required")
  .max(128, "objectId is too long");

export const listBoardsInputSchema = z.object({
  query: z.string().max(200).optional(),
  sort: z.enum(["updatedAt", "createdAt", "name"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

export const getBoardSummaryInputSchema = z.object({
  boardId: boardIdSchema,
  includeStrokePoints: z.boolean().optional(),
});

export const queryObjectsInputSchema = z.object({
  boardId: boardIdSchema,
  type: z.enum(["stroke", "image", "text"]).optional(),
  bounds: z
    .object({
      x: finiteNumberSchema,
      y: finiteNumberSchema,
      width: finiteNumberSchema.positive(),
      height: finiteNumberSchema.positive(),
    })
    .optional(),
  textQuery: z.string().max(500).optional(),
  includeStrokePoints: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export const exportBoardPdfInputSchema = z.object({
  boardId: boardIdSchema,
  outputPath: z.string().min(1).max(500).optional(),
  includeBase64: z.boolean().optional(),
});

export const createBoardInputSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  background: hexColorSchema.optional(),
});

export const addTextBoxInputSchema = z.object({
  boardId: boardIdSchema,
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  text: z.string().max(50_000),
  width: finiteNumberSchema.min(MIN_TEXT_WIDTH).max(MAX_TEXT_WIDTH).optional(),
  fontFamily: z.enum(FONT_FAMILIES).optional(),
  fontSize: finiteNumberSchema.min(MIN_FONT_SIZE).max(MAX_FONT_SIZE)
    .optional(),
  color: hexColorSchema.optional(),
  backgroundColor: textBackgroundColorSchema.optional(),
  textAlign: z.enum(TEXT_ALIGNS).optional(),
  rotation: finiteNumberSchema.optional(),
});

export const updateTextBoxInputSchema = z.object({
  boardId: boardIdSchema,
  objectId: objectIdSchema,
  text: z.string().max(50_000).optional(),
  x: finiteNumberSchema.optional(),
  y: finiteNumberSchema.optional(),
  width: finiteNumberSchema.min(MIN_TEXT_WIDTH).max(MAX_TEXT_WIDTH).optional(),
  fontFamily: z.enum(FONT_FAMILIES).optional(),
  fontSize: finiteNumberSchema.min(MIN_FONT_SIZE).max(MAX_FONT_SIZE)
    .optional(),
  color: hexColorSchema.optional(),
  backgroundColor: textBackgroundColorSchema.optional(),
  textAlign: z.enum(TEXT_ALIGNS).optional(),
  rotation: finiteNumberSchema.optional(),
});

export const strokePointInputSchema = z.object({
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  pressure: finiteNumberSchema.min(0).max(1).optional(),
});

export const addStrokeInputSchema = z.object({
  boardId: boardIdSchema,
  tool: z.enum(PEN_TOOLS).optional(),
  color: hexColorSchema.optional(),
  width: finiteNumberSchema.min(MIN_STROKE_WIDTH).max(MAX_STROKE_WIDTH)
    .optional(),
  points: z.array(strokePointInputSchema).min(1).max(10_000),
});

export const deleteObjectsInputSchema = z.object({
  boardId: boardIdSchema,
  objectIds: z.array(objectIdSchema).min(1).max(1000),
});
