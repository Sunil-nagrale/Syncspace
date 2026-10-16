import { z } from "zod";

export const MAX_COMMENT_LENGTH = 5000;
export const MAX_ANCHOR_PAYLOAD_BYTES = 10240; // 10KB
export const ALLOWED_ANCHOR_TYPES = [
  "GENERAL",
  "TEXT_SELECTION",
  "CANVAS_ELEMENT",
  "CANVAS_COORDINATE",
] as const;

export type CommentAnchorType = (typeof ALLOWED_ANCHOR_TYPES)[number];

const textSelectionAnchorSchema = z
  .object({
    from: z.number().int().min(0, "'from' offset must be non-negative"),
    to: z.number().int().min(0, "'to' offset must be non-negative"),
    quote: z.string().max(1000, "Selection quote cannot exceed 1000 characters").optional(),
  })
  .refine((data) => data.to >= data.from, {
    message: "'to' offset must be greater than or equal to 'from' offset",
    path: ["to"],
  });

const canvasElementAnchorSchema = z.object({
  elementId: z.string().trim().min(1, "elementId cannot be empty").max(128, "elementId is too long"),
});

const canvasCoordinateAnchorSchema = z.object({
  x: z.number().finite("x coordinate must be a finite number"),
  y: z.number().finite("y coordinate must be a finite number"),
});

/**
 * Validates anchorData based on anchorType with safety bounds.
 */
export function validateAnchorData(
  anchorType: CommentAnchorType | undefined | null,
  anchorData: unknown
): { valid: boolean; error?: string; data?: unknown } {
  if (!anchorType || anchorType === "GENERAL") {
    if (anchorData === null || anchorData === undefined) {
      return { valid: true, data: null };
    }
    if (typeof anchorData === "object" && Object.keys(anchorData as object).length === 0) {
      return { valid: true, data: null };
    }
    return {
      valid: false,
      error: "GENERAL anchorType does not accept non-empty anchorData.",
    };
  }

  if (anchorData === null || anchorData === undefined) {
    return {
      valid: false,
      error: `anchorData is required when anchorType is '${anchorType}'.`,
    };
  }

  // Check JSON payload size to prevent DOS/large payloads
  try {
    const serialized = JSON.stringify(anchorData);
    if (serialized.length > MAX_ANCHOR_PAYLOAD_BYTES) {
      return {
        valid: false,
        error: `anchorData payload exceeds maximum allowed size of ${MAX_ANCHOR_PAYLOAD_BYTES} bytes.`,
      };
    }
  } catch {
    return { valid: false, error: "anchorData must be valid JSON." };
  }

  if (anchorType === "TEXT_SELECTION") {
    const res = textSelectionAnchorSchema.safeParse(anchorData);
    if (!res.success) {
      return { valid: false, error: res.error.issues[0]?.message || "Invalid TEXT_SELECTION anchorData" };
    }
    return { valid: true, data: res.data };
  }

  if (anchorType === "CANVAS_ELEMENT") {
    const res = canvasElementAnchorSchema.safeParse(anchorData);
    if (!res.success) {
      return { valid: false, error: res.error.issues[0]?.message || "Invalid CANVAS_ELEMENT anchorData" };
    }
    return { valid: true, data: res.data };
  }

  if (anchorType === "CANVAS_COORDINATE") {
    const res = canvasCoordinateAnchorSchema.safeParse(anchorData);
    if (!res.success) {
      return { valid: false, error: res.error.issues[0]?.message || "Invalid CANVAS_COORDINATE anchorData" };
    }
    return { valid: true, data: res.data };
  }

  return { valid: false, error: `Unsupported anchorType: ${String(anchorType)}` };
}

export const createThreadSchema = z.object({
  content: z
    .string({ invalid_type_error: "Content must be a string." })
    .trim()
    .min(1, "Comment content cannot be empty.")
    .max(MAX_COMMENT_LENGTH, `Comment content exceeds maximum length of ${MAX_COMMENT_LENGTH} characters.`),
  anchorType: z
    .enum(ALLOWED_ANCHOR_TYPES, {
      errorMap: () => ({
        message: `Invalid anchorType. Must be one of: ${ALLOWED_ANCHOR_TYPES.join(", ")}`,
      }),
    })
    .default("GENERAL")
    .optional(),
  anchorData: z.unknown().optional(),
});

export const createReplySchema = z.object({
  content: z
    .string({ invalid_type_error: "Content must be a string." })
    .trim()
    .min(1, "Reply content cannot be empty.")
    .max(MAX_COMMENT_LENGTH, `Reply content exceeds maximum length of ${MAX_COMMENT_LENGTH} characters.`),
});

export const updateCommentSchema = z.object({
  content: z
    .string({ invalid_type_error: "Content must be a string." })
    .trim()
    .min(1, "Comment content cannot be empty.")
    .max(MAX_COMMENT_LENGTH, `Comment content exceeds maximum length of ${MAX_COMMENT_LENGTH} characters.`),
});

export const toggleReactionSchema = z.object({
  emoji: z
    .string({ invalid_type_error: "Emoji must be a string." })
    .trim()
    .min(1, "Emoji cannot be empty.")
    .max(16, "Emoji must not exceed 16 characters."),
  intent: z.enum(["toggle", "add", "remove"]).default("toggle").optional(),
});

export const threadActionSchema = z.object({
  action: z.enum(["resolve", "reopen"], {
    errorMap: () => ({
      message: "Invalid action. Expected 'resolve' or 'reopen'.",
    }),
  }),
});

export const listThreadsQuerySchema = z.object({
  status: z.enum(["all", "open", "resolved"]).default("open").optional(),
  limit: z.coerce
    .number({ invalid_type_error: "Limit must be a number." })
    .int("Limit must be an integer.")
    .min(1, "Limit must be at least 1.")
    .max(50, "Limit cannot exceed 50.")
    .default(20)
    .optional(),
  cursor: z
    .string()
    .trim()
    .min(1, "Cursor cannot be empty.")
    .max(128, "Cursor is too long.")
    .optional(),
});

export const listRepliesQuerySchema = z.object({
  limit: z.coerce
    .number({ invalid_type_error: "Limit must be a number." })
    .int("Limit must be an integer.")
    .min(1, "Limit must be at least 1.")
    .max(50, "Limit cannot exceed 50.")
    .default(20)
    .optional(),
  cursor: z
    .string()
    .trim()
    .min(1, "Cursor cannot be empty.")
    .max(128, "Cursor is too long.")
    .optional(),
});
