import { z } from "zod";

export const MAX_SEARCH_QUERY_LENGTH = 200;
export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 50;
export const MAX_SEARCH_OFFSET = 1000;
export const MAX_EXCERPT_LENGTH = 180;
export const MAX_SEARCH_TEXT_LENGTH = 200_000;

export class SearchValidationError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = "SearchValidationError";
  }
}

export const searchEntityTypeSchema = z.enum([
  "ALL",
  "DOCUMENT",
  "WHITEBOARD",
  "PROJECT",
]);

export type SearchEntityFilter = z.infer<typeof searchEntityTypeSchema>;
export type SearchResultEntityType = "DOCUMENT" | "WHITEBOARD" | "PROJECT";
export type SearchEntityType = SearchResultEntityType;

export interface SearchResultItem {
  id: string;
  entityType: SearchResultEntityType;
  title: string;
  excerpt: string;
  url: string;
  workspaceId: string;
  workspaceName: string;
  projectId: string | null;
  projectName: string | null;
  updatedAt: string;
  matchField: "title" | "description" | "content";
}

export interface SearchResponse {
  query: string;
  items: SearchResultItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Rejects null bytes and non-whitespace ASCII control characters
 */
function hasUnsafeControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (
      code === 0x00 ||
      (code >= 0x01 && code <= 0x08) ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      code === 0x7f
    ) {
      return true;
    }
  }
  return false;
}

export const searchQuerySchema = z.object({
  q: z
    .string()
    .max(
      MAX_SEARCH_QUERY_LENGTH,
      `Search query cannot exceed ${MAX_SEARCH_QUERY_LENGTH} characters.`
    )
    .refine(
      (val) => !hasUnsafeControlChars(val),
      "Search query contains invalid control characters."
    )
    .transform((val) => val.trim().replace(/\s+/g, " "))
    .optional()
    .default(""),
  workspaceId: z
    .string()
    .trim()
    .min(1, "workspaceId cannot be empty.")
    .max(128, "workspaceId is too long.")
    .refine(
      (val) => !hasUnsafeControlChars(val),
      "workspaceId contains invalid characters."
    )
    .optional(),
  projectId: z
    .string()
    .trim()
    .min(1, "projectId cannot be empty.")
    .max(128, "projectId is too long.")
    .refine(
      (val) => !hasUnsafeControlChars(val),
      "projectId contains invalid characters."
    )
    .optional(),
  type: searchEntityTypeSchema.optional().default("ALL"),
  limit: z.coerce
    .number()
    .int("limit must be an integer.")
    .min(1, "limit must be at least 1.")
    .max(MAX_SEARCH_LIMIT, `limit cannot exceed ${MAX_SEARCH_LIMIT}.`)
    .optional()
    .default(DEFAULT_SEARCH_LIMIT),
  cursor: z
    .string()
    .trim()
    .min(1)
    .max(256, "Invalid pagination cursor.")
    .optional(),
  includeRecent: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((val) => val === true || val === "true"),
});

export type ValidatedSearchQuery = z.infer<typeof searchQuerySchema>;

/**
 * Encodes an integer pagination offset into an opaque URL-safe cursor
 */
export function encodeSearchCursor(offset: number): string {
  const safeOffset = Math.max(0, Math.floor(offset));
  return Buffer.from(JSON.stringify({ o: safeOffset }), "utf8").toString(
    "base64url"
  );
}

/**
 * Decodes and validates an opaque pagination cursor into an integer offset
 */
export function decodeSearchCursor(cursor?: string): number {
  if (!cursor) return 0;

  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as { o?: unknown };
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.o !== "number" ||
      !Number.isInteger(parsed.o) ||
      parsed.o < 0 ||
      parsed.o > MAX_SEARCH_OFFSET
    ) {
      throw new SearchValidationError("Invalid pagination cursor.", 400);
    }
    return parsed.o;
  } catch (err) {
    if (err instanceof SearchValidationError) {
      throw err;
    }
    throw new SearchValidationError("Invalid pagination cursor.", 400);
  }
}

/**
 * Normalizes plain text by removing control characters and collapsing whitespace
 */
export function normalizePlainSearchText(input: string): string {
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts searchable plain text from a Tiptap document JSON snapshot or Excalidraw whiteboard scene snapshot.
 */
export function extractArtifactSearchText(
  type: "DOCUMENT" | "WHITEBOARD",
  snapshot: unknown
): string {
  if (!snapshot || typeof snapshot !== "object") {
    return "";
  }

  const chunks: string[] = [];
  let accumulatedLength = 0;

  const pushChunk = (text: string) => {
    const cleaned = normalizePlainSearchText(text);
    if (!cleaned || accumulatedLength >= MAX_SEARCH_TEXT_LENGTH) return;
    chunks.push(cleaned);
    accumulatedLength += cleaned.length + 1;
  };

  if (type === "DOCUMENT") {
    const visited = new Set<object>();
    const walkNode = (node: unknown, depth: number) => {
      if (
        !node ||
        typeof node !== "object" ||
        depth > 64 ||
        accumulatedLength >= MAX_SEARCH_TEXT_LENGTH
      ) {
        return;
      }
      if (visited.has(node)) return;
      visited.add(node);

      const record = node as Record<string, unknown>;
      if (typeof record.text === "string" && record.text.trim().length > 0) {
        pushChunk(record.text);
      }

      if (Array.isArray(record.content)) {
        for (const child of record.content) {
          walkNode(child, depth + 1);
          if (accumulatedLength >= MAX_SEARCH_TEXT_LENGTH) break;
        }
      }
    };

    walkNode(snapshot, 0);
  } else if (type === "WHITEBOARD") {
    const record = snapshot as Record<string, unknown>;
    if (Array.isArray(record.elements)) {
      for (const elem of record.elements) {
        if (!elem || typeof elem !== "object") continue;
        const el = elem as Record<string, unknown>;
        if (el.isDeleted === true) continue;

        const textVal = typeof el.text === "string" ? el.text.trim() : "";
        const origVal =
          typeof el.originalText === "string" ? el.originalText.trim() : "";
        const nameVal = typeof el.name === "string" ? el.name.trim() : "";

        if (textVal) {
          pushChunk(textVal);
        }
        if (origVal && origVal !== textVal) {
          pushChunk(origVal);
        }
        if (nameVal && nameVal !== textVal && nameVal !== origVal) {
          pushChunk(nameVal);
        }
        if (accumulatedLength >= MAX_SEARCH_TEXT_LENGTH) break;
      }
    }
  }

  return normalizePlainSearchText(chunks.join(" ")).slice(
    0,
    MAX_SEARCH_TEXT_LENGTH
  );
}

/**
 * Extracts safe alphanumeric tokens from a raw user search query and builds a
 * PostgreSQL prefix tsquery string (e.g. `consensus:* & protocol:*`) that cannot
 * trigger tsquery syntax errors regardless of special characters in user input.
 */
export function buildSafePrefixTsQuery(rawQuery: string): string | null {
  const normalized = normalizePlainSearchText(rawQuery);
  if (!normalized) return null;

  const rawTokens = normalized.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const safeTokens: string[] = [];

  for (const token of rawTokens) {
    const cleaned = token.replace(/^[-_]+|[-_]+$/g, "").slice(0, 64);
    if (cleaned.length > 0 && /^[\p{L}\p{N}_-]+$/u.test(cleaned)) {
      safeTokens.push(`${cleaned.toLowerCase()}:*`);
    }
    if (safeTokens.length >= 10) break;
  }

  if (safeTokens.length === 0) {
    return null;
  }

  return safeTokens.join(" & ");
}

/**
 * Escapes `%`, `_`, and `\` metacharacters for safe PostgreSQL ILIKE patterns
 */
export function escapeLikePattern(rawQuery: string): string {
  return rawQuery.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * Builds a bounded, plain-text excerpt around the first matching query term
 * without exposing raw JSON structure or excessive document content.
 */
export function buildSafeSearchExcerpt(params: {
  query: string;
  title: string;
  description?: string | null;
  searchText?: string | null;
  entityType: SearchResultEntityType;
}): {
  excerpt: string;
  matchField: "title" | "description" | "content";
} {
  const cleanTitle = normalizePlainSearchText(params.title || "");
  const cleanDescription = normalizePlainSearchText(params.description || "");
  const cleanBody = normalizePlainSearchText(params.searchText || "");
  const cleanQuery = normalizePlainSearchText(params.query || "");

  const tokens = (cleanQuery.match(/[\p{L}\p{N}_-]+/gu) ?? [])
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);
  if (cleanQuery && !tokens.includes(cleanQuery.toLowerCase())) {
    tokens.unshift(cleanQuery.toLowerCase());
  }

  const findMatchIndex = (source: string): { index: number; length: number } | null => {
    if (!source || tokens.length === 0) return null;
    const lowerSource = source.toLowerCase();

    for (const token of tokens) {
      const idx = lowerSource.indexOf(token);
      if (idx !== -1) {
        return { index: idx, length: token.length };
      }
    }
    return null;
  };

  const sliceWindow = (source: string, matchIndex: number): string => {
    if (source.length <= MAX_EXCERPT_LENGTH) {
      return source;
    }

    const halfWindow = Math.floor((MAX_EXCERPT_LENGTH - 20) / 2);
    let start = Math.max(0, matchIndex - halfWindow);
    let end = Math.min(source.length, start + MAX_EXCERPT_LENGTH);

    if (end - start < MAX_EXCERPT_LENGTH) {
      start = Math.max(0, end - MAX_EXCERPT_LENGTH);
    }

    if (start > 0) {
      const nextSpace = source.indexOf(" ", start);
      if (nextSpace !== -1 && nextSpace - start <= 18) {
        start = nextSpace + 1;
      }
    }

    if (end < source.length) {
      const prevSpace = source.lastIndexOf(" ", end);
      if (prevSpace !== -1 && end - prevSpace <= 18 && prevSpace > start) {
        end = prevSpace;
      }
    }

    const prefix = start > 0 ? "…" : "";
    const suffix = end < source.length ? "…" : "";
    return `${prefix}${source.slice(start, end).trim()}${suffix}`;
  };

  // 1. Check body / canvas text match first so users see where their query matched inside the artifact
  const bodyMatch = findMatchIndex(cleanBody);
  if (bodyMatch) {
    return {
      excerpt: sliceWindow(cleanBody, bodyMatch.index),
      matchField: "content",
    };
  }

  // 2. Check description match
  const descMatch = findMatchIndex(cleanDescription);
  if (descMatch) {
    return {
      excerpt: sliceWindow(cleanDescription, descMatch.index),
      matchField: "description",
    };
  }

  // 3. Title matched (or recent item with empty query): provide a concise preview of body/description
  const titleMatch = findMatchIndex(cleanTitle);
  const fallbackSource =
    cleanBody ||
    cleanDescription ||
    (params.entityType === "DOCUMENT"
      ? "Collaborative rich-text document"
      : params.entityType === "WHITEBOARD"
        ? "Collaborative Excalidraw whiteboard"
        : "Workspace project");

  return {
    excerpt: sliceWindow(fallbackSource, 0),
    matchField: titleMatch ? "title" : cleanDescription ? "description" : "title",
  };
}
