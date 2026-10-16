import { z } from "zod";

/**
 * Maximum snapshot payload size in characters (~5MB JSON string)
 */
export const MAX_SNAPSHOT_JSON_LENGTH = 5 * 1024 * 1024;

/**
 * Validates Tiptap / ProseMirror Document JSON structure
 */
export const tiptapDocSchema = z.object({
  type: z.literal("doc"),
  content: z.array(z.record(z.unknown())).optional(),
}).passthrough();

/**
 * Validates Excalidraw Whiteboard scene structure
 */
export const excalidrawSceneSchema = z.object({
  elements: z.array(z.record(z.unknown())),
  appState: z.record(z.unknown()).optional(),
  files: z.record(z.unknown()).optional(),
}).passthrough();

/**
 * Validates either a Document or Whiteboard snapshot payload safely
 */
export function validateSnapshotPayload(
  type: "DOCUMENT" | "WHITEBOARD",
  payload: unknown
): { valid: true; data: Record<string, unknown> } | { valid: false; error: string } {
  if (!payload || typeof payload !== "object") {
    return { valid: false, error: "Snapshot payload must be a non-empty object." };
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return { valid: false, error: "Snapshot payload contains non-serializable circular references." };
  }

  if (serialized.length > MAX_SNAPSHOT_JSON_LENGTH) {
    return {
      valid: false,
      error: `Snapshot payload exceeds maximum allowed size of ${MAX_SNAPSHOT_JSON_LENGTH / (1024 * 1024)}MB.`,
    };
  }

  if (type === "DOCUMENT") {
    const parsed = tiptapDocSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        valid: false,
        error: "Invalid document snapshot: must be a valid ProseMirror/Tiptap document object with type 'doc'.",
      };
    }
    return { valid: true, data: parsed.data as Record<string, unknown> };
  } else {
    const parsed = excalidrawSceneSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        valid: false,
        error: "Invalid whiteboard snapshot: must be an object with an 'elements' array.",
      };
    }
    return { valid: true, data: parsed.data as Record<string, unknown> };
  }
}

/**
 * Query schema for listing versions with cursor-based pagination
 */
export const listVersionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

/**
 * Input schema for manually creating an artifact version checkpoint
 */
export const createVersionSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  changeSummary: z.string().trim().max(500).optional(),
  snapshotData: z.record(z.unknown()).optional(),
});

/**
 * Input schema for restoring an artifact version
 */
export const restoreVersionSchema = z.object({
  expectedRevision: z.number().int().min(1).optional(),
});
