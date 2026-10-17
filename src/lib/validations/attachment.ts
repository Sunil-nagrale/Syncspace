import { z } from "zod";
import { createHash, randomBytes, randomUUID } from "crypto";

export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MiB
export const MAX_PENDING_UPLOADS_PER_USER = 5;
export const MAX_ATTACHMENTS_PER_ARTIFACT = 50;

export const ALLOWED_ATTACHMENT_TYPES = {
  "application/pdf": {
    extension: ".pdf",
    label: "PDF Document",
    category: "pdf" as const,
    inlinePreviewAllowed: true,
  },
  "image/png": {
    extension: ".png",
    label: "PNG Image",
    category: "image" as const,
    inlinePreviewAllowed: true,
  },
  "image/jpeg": {
    extension: ".jpg",
    label: "JPEG Image",
    category: "image" as const,
    inlinePreviewAllowed: true,
  },
  "image/webp": {
    extension: ".webp",
    label: "WebP Image",
    category: "image" as const,
    inlinePreviewAllowed: true,
  },
  "text/plain": {
    extension: ".txt",
    label: "Plain Text",
    category: "text" as const,
    inlinePreviewAllowed: true,
  },
  "text/csv": {
    extension: ".csv",
    label: "CSV Spreadsheet",
    category: "text" as const,
    inlinePreviewAllowed: false,
  },
} as const;

export type AllowedAttachmentMimeType = keyof typeof ALLOWED_ATTACHMENT_TYPES;

const FORBIDDEN_EXTENSIONS = new Set([
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bat",
  ".cmd",
  ".ps1",
  ".sh",
  ".bash",
  ".zsh",
  ".msi",
  ".scr",
  ".vbs",
  ".vbe",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".html",
  ".htm",
  ".xhtml",
  ".svg",
  ".svgz",
  ".php",
  ".py",
  ".rb",
  ".pl",
  ".jar",
  ".war",
  ".com",
  ".pif",
  ".hta",
  ".swf",
]);

/**
 * Normalizes a MIME type string (lowercase, strips parameters like `; charset=utf-8`).
 */
export function normalizeMimeType(rawMime: string): string {
  return rawMime.split(";")[0].trim().toLowerCase();
}

/**
 * Checks if a MIME type is in the documented safe allowlist.
 */
export function isAllowedMimeType(mime: string): mime is AllowedAttachmentMimeType {
  const normalized = normalizeMimeType(mime);
  return Object.prototype.hasOwnProperty.call(ALLOWED_ATTACHMENT_TYPES, normalized);
}

/**
 * Sanitizes a user-supplied filename for safe storage in database metadata and display/download headers.
 * Strips directory paths, traversal sequences, control characters, and unsafe punctuation.
 */
export function sanitizeAttachmentFileName(
  rawFileName: string,
  fallbackExtension: string = ""
): string {
  if (!rawFileName || typeof rawFileName !== "string") {
    return `attachment${fallbackExtension}`;
  }

  // Extract basename after any forward or backward slashes
  const slashNormalized = rawFileName.replace(/\\/g, "/");
  const segments = slashNormalized.split("/").filter(Boolean);
  let base = segments.length > 0 ? segments[segments.length - 1] : rawFileName;

  // Strip null bytes, control chars (0x00-0x1F, 0x7F-0x9F), and bidirectional overrides
  base = base.replace(/[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e]/g, "");

  // Replace characters unsafe in headers or filesystems
  base = base.replace(/["'<>|:*?;\r\n\\]/g, "_");

  // Collapse multiple consecutive dots (`..` -> `.`) to prevent traversal tricks
  base = base.replace(/\.{2,}/g, ".");

  // Collapse whitespace
  base = base.replace(/\s+/g, " ").trim();

  // Strip leading and trailing dots/spaces
  base = base.replace(/^[.\s]+|[.\s]+$/g, "");

  if (!base || base === "." || base === "..") {
    return `attachment${fallbackExtension}`;
  }

  // Enforce max length of 120 chars while preserving extension if present
  if (base.length > 120) {
    const lastDot = base.lastIndexOf(".");
    if (lastDot > 0 && base.length - lastDot <= 12) {
      const ext = base.slice(lastDot);
      const stem = base.slice(0, 120 - ext.length).replace(/[.\s]+$/g, "");
      base = `${stem || "attachment"}${ext}`;
    } else {
      base = base.slice(0, 120).replace(/[.\s]+$/g, "");
    }
  }

  return base || `attachment${fallbackExtension}`;
}

/**
 * Extracts the lowercase extension (including dot) from a filename.
 */
export function getFileExtension(fileName: string): string {
  const sanitized = sanitizeAttachmentFileName(fileName);
  const lastDot = sanitized.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === sanitized.length - 1) {
    return "";
  }
  return sanitized.slice(lastDot).toLowerCase();
}

/**
 * Checks whether a filename carries a dangerous executable, script, or active-content extension.
 */
export function hasForbiddenExtension(fileName: string): boolean {
  const normalized = fileName.replace(/\\/g, "/").split("/").pop() || fileName;
  const parts = normalized.toLowerCase().split(".").slice(1);
  if (parts.length === 0) return false;
  // Check the final extension and any dangerous double extensions (e.g. file.html.txt is fine, but file.exe or file.svg is not)
  const finalExt = `.${parts[parts.length - 1]}`;
  return FORBIDDEN_EXTENSIONS.has(finalExt);
}

/**
 * Generates an unpredictable, path-safe staging object key for unverified client uploads.
 * Presigned upload URLs are scoped exclusively to staging keys.
 */
export function generateStagingStorageKey(
  workspaceId: string,
  artifactId: string
): string {
  const safeIdPattern = /^[a-zA-Z0-9_-]+$/;
  if (!safeIdPattern.test(workspaceId) || !safeIdPattern.test(artifactId)) {
    throw new Error("Invalid workspace or artifact identifier for storage key.");
  }

  const uniqueToken = `${randomUUID()}-${randomBytes(8).toString("hex")}`;
  return `workspaces/${workspaceId}/artifacts/${artifactId}/staging/${uniqueToken}`;
}

/**
 * Generates an unpredictable, path-safe final object key for verified READY attachments.
 * Clients never receive upload credentials or URLs for final keys.
 */
export function generateFinalStorageKey(
  workspaceId: string,
  artifactId: string
): string {
  const safeIdPattern = /^[a-zA-Z0-9_-]+$/;
  if (!safeIdPattern.test(workspaceId) || !safeIdPattern.test(artifactId)) {
    throw new Error("Invalid workspace or artifact identifier for storage key.");
  }

  const uniqueToken = `${randomUUID()}-${randomBytes(8).toString("hex")}`;
  return `workspaces/${workspaceId}/artifacts/${artifactId}/blobs/${uniqueToken}`;
}

/**
 * Generates an unpredictable, path-safe storage object key completely independent of user-supplied filenames.
 * Defaults to generating a finalized ("blobs") key unless "staging" is specified.
 */
export function generateAttachmentStorageKey(
  workspaceId: string,
  artifactId: string,
  stage: "staging" | "final" = "final"
): string {
  if (stage === "staging") {
    return generateStagingStorageKey(workspaceId, artifactId);
  }
  return generateFinalStorageKey(workspaceId, artifactId);
}

/**
 * Builds a safe Content-Disposition header value preventing header injection and inline execution of unsafe types.
 */
export function buildContentDispositionHeader(
  requestedDisposition: "inline" | "attachment",
  fileName: string,
  mimeType: string
): string {
  const normalizedMime = normalizeMimeType(mimeType);
  const typeMeta = isAllowedMimeType(normalizedMime)
    ? ALLOWED_ATTACHMENT_TYPES[normalizedMime]
    : null;

  const effectiveDisposition =
    requestedDisposition === "inline" && typeMeta?.inlinePreviewAllowed
      ? "inline"
      : "attachment";

  const sanitizedName = sanitizeAttachmentFileName(
    fileName,
    typeMeta?.extension ?? ""
  );
  const asciiFallback = sanitizedName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encodedUtf8 = encodeURIComponent(sanitizedName);

  return `${effectiveDisposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodedUtf8}`;
}

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  normalizedMimeType?: AllowedAttachmentMimeType;
  sanitizedFileName?: string;
  byteLength?: number;
  sha256?: string;
}

/**
 * Computes SHA-256 hex digest for a binary buffer.
 */
export function computeSha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function startsWithBytes(bytes: Uint8Array, prefix: number[], offset = 0): boolean {
  if (bytes.byteLength < offset + prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[offset + i] !== prefix[i]) return false;
  }
  return true;
}

/**
 * Inspects actual file bytes for executable headers, active content (HTML/SVG/JS),
 * and verifies that the magic-byte signature matches the declared allowlisted MIME type.
 */
export function validateFileSignatureAndContent(params: {
  bytes: Uint8Array;
  declaredMimeType: string;
  fileName: string;
}): FileValidationResult {
  const { bytes, declaredMimeType, fileName } = params;

  if (!fileName || typeof fileName !== "string" || !fileName.trim()) {
    return { valid: false, error: "File name is required." };
  }

  if (hasForbiddenExtension(fileName)) {
    return {
      valid: false,
      error: "Executable, script, HTML, and SVG file extensions are not permitted.",
    };
  }

  const normalizedMime = normalizeMimeType(declaredMimeType || "");
  if (!isAllowedMimeType(normalizedMime)) {
    return {
      valid: false,
      error: `Unsupported file type '${declaredMimeType || "unknown"}'. Allowed types: PDF, PNG, JPEG, WebP, TXT, CSV.`,
    };
  }

  if (!bytes || bytes.byteLength === 0) {
    return {
      valid: false,
      error: "Empty files cannot be uploaded.",
    };
  }

  if (bytes.byteLength > MAX_ATTACHMENT_SIZE_BYTES) {
    return {
      valid: false,
      error: `File size (${bytes.byteLength} bytes) exceeds the maximum limit of 10 MiB (${MAX_ATTACHMENT_SIZE_BYTES} bytes).`,
    };
  }

  // 1. Reject known executable binary headers regardless of declared MIME type
  // Windows MZ / PE executable
  if (startsWithBytes(bytes, [0x4d, 0x5a])) {
    return {
      valid: false,
      error: "Executable binary content (PE/MZ header) is prohibited.",
    };
  }
  // ELF executable
  if (startsWithBytes(bytes, [0x7f, 0x45, 0x4c, 0x46])) {
    return {
      valid: false,
      error: "Executable binary content (ELF header) is prohibited.",
    };
  }
  // Mach-O binary headers
  if (
    startsWithBytes(bytes, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWithBytes(bytes, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWithBytes(bytes, [0xce, 0xfa, 0xed, 0xfe]) ||
    startsWithBytes(bytes, [0xcf, 0xfa, 0xed, 0xfe])
  ) {
    return {
      valid: false,
      error: "Executable binary content (Mach-O header) is prohibited.",
    };
  }

  // 2. Validate magic-byte signatures or text structure per allowed MIME type
  switch (normalizedMime) {
    case "application/pdf": {
      // Must begin with "%PDF-" (0x25 0x50 0x44 0x46 0x2D)
      if (!startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
        return {
          valid: false,
          error: "File content does not match a valid PDF signature (%PDF-).",
        };
      }
      break;
    }

    case "image/png": {
      // Must begin with PNG 8-byte signature: 89 50 4E 47 0D 0A 1A 0A
      if (
        !startsWithBytes(bytes, [
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ])
      ) {
        return {
          valid: false,
          error: "File content does not match a valid PNG signature.",
        };
      }
      break;
    }

    case "image/jpeg": {
      // Must begin with FF D8 FF
      if (!startsWithBytes(bytes, [0xff, 0xd8, 0xff])) {
        return {
          valid: false,
          error: "File content does not match a valid JPEG signature.",
        };
      }
      break;
    }

    case "image/webp": {
      // Must begin with "RIFF" (0..3) and "WEBP" (8..11)
      if (
        bytes.byteLength < 12 ||
        !startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46], 0) ||
        !startsWithBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8)
      ) {
        return {
          valid: false,
          error: "File content does not match a valid WebP RIFF/WEBP signature.",
        };
      }
      break;
    }

    case "text/plain":
    case "text/csv": {
      // Inspect up to first 64 KiB (or entire file if smaller) for null bytes & binary control characters
      const inspectLen = Math.min(bytes.byteLength, 65536);
      for (let i = 0; i < inspectLen; i++) {
        const b = bytes[i];
        if (b === 0x00) {
          return {
            valid: false,
            error: "Binary content (null bytes) is not allowed in plain text or CSV files.",
          };
        }
        // Reject non-whitespace control characters (allow \t=0x09, \n=0x0a, \r=0x0d)
        if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) {
          return {
            valid: false,
            error: "Invalid control characters found in text or CSV file.",
          };
        }
      }

      // Decode UTF-8 strictly to reject invalid byte sequences
      let textSample = "";
      try {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        textSample = decoder.decode(bytes.subarray(0, inspectLen));
      } catch {
        return {
          valid: false,
          error: "Text or CSV file must be valid UTF-8 encoded text.",
        };
      }

      // Reject disguised HTML, SVG, or active script payloads
      const trimmedLower = textSample.trimStart().toLowerCase();
      const activeContentPatterns = [
        /^<!doctype\s+html/i,
        /^<html[\s>]/i,
        /^<head[\s>]/i,
        /^<body[\s>]/i,
        /^<script[\s>]/i,
        /^<svg[\s>]/i,
        /^<\?xml[^>]*>[\s\S]*<svg[\s>]/i,
        /<script[\s>]/i,
        /<iframe[\s>]/i,
        /<object[\s>]/i,
        /<embed[\s>]/i,
        /javascript\s*:/i,
        /\bon(?:error|load|click|mouseover)\s*=/i,
      ];

      for (const pattern of activeContentPatterns) {
        if (pattern.test(trimmedLower) || pattern.test(textSample)) {
          return {
            valid: false,
            error:
              "HTML, SVG, and active script content are prohibited in text or CSV uploads.",
          };
        }
      }
      break;
    }
  }

  const typeMeta = ALLOWED_ATTACHMENT_TYPES[normalizedMime];
  const sanitizedFileName = sanitizeAttachmentFileName(
    fileName,
    typeMeta.extension
  );

  return {
    valid: true,
    normalizedMimeType: normalizedMime,
    sanitizedFileName,
    byteLength: bytes.byteLength,
    sha256: computeSha256Hex(bytes),
  };
}

export const initiateAttachmentUploadSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1, "File name is required.")
    .max(255, "File name is too long."),
  fileType: z
    .string()
    .trim()
    .min(1, "File MIME type is required.")
    .refine((val) => isAllowedMimeType(val), {
      message:
        "Unsupported file type. Allowed types: PDF, PNG, JPEG, WebP, TXT, CSV.",
    }),
  fileSize: z
    .number()
    .int("File size must be an integer.")
    .positive("File size must be greater than 0 bytes.")
    .max(
      MAX_ATTACHMENT_SIZE_BYTES,
      `File size cannot exceed 10 MiB (${MAX_ATTACHMENT_SIZE_BYTES} bytes).`
    ),
});

export const listAttachmentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const downloadAttachmentQuerySchema = z.object({
  disposition: z.enum(["inline", "attachment"]).default("attachment"),
});
