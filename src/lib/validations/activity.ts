import { z } from "zod";

export const DEFAULT_ACTIVITY_LIMIT = 15;
export const MAX_ACTIVITY_LIMIT = 50;
export const MAX_METADATA_STRING_LENGTH = 160;

export class ActivityValidationError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = "ActivityValidationError";
  }
}

export const activityCategorySchema = z.enum([
  "ALL",
  "ARTIFACT",
  "PROJECT",
  "COMMENT",
  "VERSION",
  "ATTACHMENT",
  "MEMBER",
]);

export type ActivityCategoryFilter = z.infer<typeof activityCategorySchema>;

export interface ActivityCursorPayload {
  t: string;
  id: string;
}

export interface WorkspaceActivityItem {
  id: string;
  workspaceId: string;
  action: string;
  category: Exclude<ActivityCategoryFilter, "ALL">;
  entityType: string;
  entityId: string | null;
  targetTitle: string | null;
  targetUrl: string | null;
  summary: string;
  actor: {
    id: string;
    name: string;
    image: string | null;
    color: string;
  };
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export interface WorkspaceActivityResponse {
  workspaceId: string;
  items: WorkspaceActivityItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

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

export const activityFeedQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int("limit must be an integer.")
    .min(1, "limit must be at least 1.")
    .max(MAX_ACTIVITY_LIMIT, `limit cannot exceed ${MAX_ACTIVITY_LIMIT}.`)
    .optional()
    .default(DEFAULT_ACTIVITY_LIMIT),
  cursor: z
    .string()
    .trim()
    .min(1, "Invalid pagination cursor.")
    .max(256, "Invalid pagination cursor.")
    .refine(
      (val) => !hasUnsafeControlChars(val),
      "Cursor contains invalid characters."
    )
    .optional(),
  category: activityCategorySchema.optional().default("ALL"),
});

export type ValidatedActivityFeedQuery = z.infer<typeof activityFeedQuerySchema>;

/**
 * Encodes a deterministic keyset cursor `(createdAt ISO timestamp, id)` into URL-safe base64.
 */
export function encodeActivityCursor(createdAt: Date | string, id: string): string {
  const iso =
    createdAt instanceof Date
      ? createdAt.toISOString()
      : new Date(createdAt).toISOString();
  if (!id || typeof id !== "string" || Number.isNaN(Date.parse(iso))) {
    throw new ActivityValidationError("Invalid cursor parameters.", 400);
  }
  return Buffer.from(JSON.stringify({ t: iso, id }), "utf8").toString(
    "base64url"
  );
}

/**
 * Decodes and validates a deterministic keyset cursor `(createdAt, id)`.
 */
export function decodeActivityCursor(cursor: string): {
  createdAt: Date;
  id: string;
} {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as { t?: unknown; id?: unknown };
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.t !== "string" ||
      typeof parsed.id !== "string" ||
      parsed.id.trim().length === 0 ||
      parsed.id.length > 128 ||
      hasUnsafeControlChars(parsed.id)
    ) {
      throw new ActivityValidationError("Invalid pagination cursor.", 400);
    }

    const timestampMs = Date.parse(parsed.t);
    if (Number.isNaN(timestampMs)) {
      throw new ActivityValidationError("Invalid pagination cursor.", 400);
    }

    return {
      createdAt: new Date(timestampMs),
      id: parsed.id.trim(),
    };
  } catch (err) {
    if (err instanceof ActivityValidationError) {
      throw err;
    }
    throw new ActivityValidationError("Invalid pagination cursor.", 400);
  }
}

const ALLOWED_SAFE_METADATA_KEYS = new Set([
  "title",
  "name",
  "type",
  "artifactType",
  "artifactId",
  "projectId",
  "threadId",
  "commentId",
  "anchorType",
  "versionNumber",
  "restoredFromVersion",
  "newVersionNumber",
  "fileName",
  "fileType",
  "fileSize",
  "role",
  "previousRole",
  "newRole",
  "removedUserRole",
  "targetUserName",
  "targetUserId",
  "isPinned",
  "isArchived",
]);

const FORBIDDEN_METADATA_KEY_PATTERN =
  /password|secret|token|cookie|session|presign|uploadurl|downloadurl|storagekey|snapshot|content|body|email|sha256/i;

export function sanitizeTextValue(value: string, maxLen = MAX_METADATA_STRING_LENGTH): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

/**
 * Validates and sanitizes activity metadata so that secrets, tokens, presigned URLs,
 * storage keys, raw document snapshots, full comment bodies, and user email addresses
 * are never stored or returned in activity events.
 */
export function sanitizeActivityMetadata(
  raw: unknown
): Record<string, string | number | boolean | null> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const sanitized: Record<string, string | number | boolean | null> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (
      !ALLOWED_SAFE_METADATA_KEYS.has(key) ||
      FORBIDDEN_METADATA_KEY_PATTERN.test(key)
    ) {
      continue;
    }

    if (typeof val === "string") {
      sanitized[key] = sanitizeTextValue(val);
    } else if (typeof val === "number" && Number.isFinite(val)) {
      sanitized[key] = val;
    } else if (typeof val === "boolean" || val === null) {
      sanitized[key] = val;
    }
  }

  return sanitized;
}

export function classifyActivityCategory(
  action: string,
  entityType: string
): Exclude<ActivityCategoryFilter, "ALL"> {
  const act = action.toLowerCase();
  const ent = entityType.toLowerCase();

  if (act.startsWith("comment.") || ent === "comment" || ent === "comment_thread") {
    return "COMMENT";
  }
  if (act.includes("version") || ent === "artifact_version") {
    return "VERSION";
  }
  if (act.includes("attachment") || ent === "attachment") {
    return "ATTACHMENT";
  }
  if (act.startsWith("project.") || ent === "project") {
    return "PROJECT";
  }
  if (
    act.startsWith("invitation.") ||
    act.startsWith("member.") ||
    act.startsWith("workspace.") ||
    ent === "invitation" ||
    ent === "workspace_member" ||
    ent === "workspace"
  ) {
    return "MEMBER";
  }
  return "ARTIFACT";
}

export function formatActivitySummary(params: {
  action: string;
  entityType: string;
  targetTitle: string | null;
  isTargetArchivedOrDeleted: boolean;
  metadata: Record<string, string | number | boolean | null>;
}): string {
  const { action, targetTitle, isTargetArchivedOrDeleted, metadata } = params;
  const act = action.toLowerCase();
  const safeTarget = targetTitle ? `"${targetTitle}"` : null;

  switch (act) {
    case "artifact.created.document":
      return isTargetArchivedOrDeleted
        ? "created a document (archived)"
        : `created document ${safeTarget ?? "Untitled Document"}`;
    case "artifact.created.whiteboard":
      return isTargetArchivedOrDeleted
        ? "created a whiteboard (archived)"
        : `created whiteboard ${safeTarget ?? "Untitled Whiteboard"}`;
    case "artifact.updated":
      if (metadata.isPinned === true) {
        return isTargetArchivedOrDeleted
          ? "pinned an artifact (archived)"
          : `pinned ${safeTarget ?? "an artifact"}`;
      }
      if (metadata.isPinned === false) {
        return isTargetArchivedOrDeleted
          ? "unpinned an artifact (archived)"
          : `unpinned ${safeTarget ?? "an artifact"}`;
      }
      return isTargetArchivedOrDeleted
        ? "updated an artifact (archived)"
        : `updated ${safeTarget ?? "an artifact"}`;
    case "artifact.archived":
      return "archived an artifact";
    case "artifact.permission_updated": {
      const role = typeof metadata.role === "string" ? metadata.role : "updated";
      return isTargetArchivedOrDeleted
        ? `updated artifact access permissions (${role})`
        : `updated access permissions (${role}) on ${safeTarget ?? "an artifact"}`;
    }
    case "project.created":
      return isTargetArchivedOrDeleted
        ? "created a project (archived)"
        : `created project ${safeTarget ?? "Untitled Project"}`;
    case "project.updated":
      return isTargetArchivedOrDeleted
        ? "updated a project (archived)"
        : `updated project ${safeTarget ?? "Untitled Project"}`;
    case "project.archived":
      return "archived a project";
    case "comment.thread_created":
      return isTargetArchivedOrDeleted
        ? "started a discussion thread on an archived artifact"
        : `started a discussion thread on ${safeTarget ?? "an artifact"}`;
    case "comment.reply_created":
      return isTargetArchivedOrDeleted
        ? "replied to a discussion on an archived artifact"
        : `replied to a discussion on ${safeTarget ?? "an artifact"}`;
    case "comment.thread_resolved":
      return isTargetArchivedOrDeleted
        ? "resolved a discussion thread on an archived artifact"
        : `resolved a discussion thread on ${safeTarget ?? "an artifact"}`;
    case "comment.thread_reopened":
      return isTargetArchivedOrDeleted
        ? "reopened a discussion thread on an archived artifact"
        : `reopened a discussion thread on ${safeTarget ?? "an artifact"}`;
    case "comment.deleted":
      return isTargetArchivedOrDeleted
        ? "deleted a comment on an archived artifact"
        : `deleted a comment on ${safeTarget ?? "an artifact"}`;
    case "comment.thread_deleted":
      return isTargetArchivedOrDeleted
        ? "deleted a discussion thread on an archived artifact"
        : `deleted a discussion thread on ${safeTarget ?? "an artifact"}`;
    case "artifact.version.created": {
      const ver =
        typeof metadata.versionNumber === "number"
          ? `v${metadata.versionNumber}`
          : "a checkpoint";
      return isTargetArchivedOrDeleted
        ? `saved version ${ver} on an archived artifact`
        : `saved version ${ver} of ${safeTarget ?? "an artifact"}`;
    }
    case "artifact.version.restored": {
      const fromVer =
        typeof metadata.restoredFromVersion === "number"
          ? `v${metadata.restoredFromVersion}`
          : "an earlier version";
      return isTargetArchivedOrDeleted
        ? `restored ${fromVer} on an archived artifact`
        : `restored ${safeTarget ?? "an artifact"} to ${fromVer}`;
    }
    case "uploaded_attachment":
    case "attachment.uploaded": {
      const fileName =
        !isTargetArchivedOrDeleted && typeof metadata.fileName === "string"
          ? `"${metadata.fileName}"`
          : "a file";
      return isTargetArchivedOrDeleted
        ? "uploaded a file attachment to an archived artifact"
        : `uploaded attachment ${fileName} to ${safeTarget ?? "an artifact"}`;
    }
    case "deleted_attachment":
    case "attachment.deleted": {
      const fileName =
        !isTargetArchivedOrDeleted && typeof metadata.fileName === "string"
          ? `"${metadata.fileName}"`
          : "a file";
      return isTargetArchivedOrDeleted
        ? "deleted a file attachment from an archived artifact"
        : `deleted attachment ${fileName} from ${safeTarget ?? "an artifact"}`;
    }
    case "attachment_integrity_failed":
      return isTargetArchivedOrDeleted
        ? "quarantined a failed attachment on an archived artifact"
        : `quarantined an attachment failing integrity verification on ${safeTarget ?? "an artifact"}`;
    case "invitation.created": {
      const role = typeof metadata.role === "string" ? metadata.role : "member";
      return `created a workspace invitation (${role})`;
    }
    case "invitation.accepted": {
      const role = typeof metadata.role === "string" ? metadata.role : "member";
      return `accepted an invitation to join the workspace as ${role}`;
    }
    case "invitation.revoked":
      return "revoked a pending workspace invitation";
    case "invitation.resent":
      return "regenerated a pending workspace invitation link";
    case "invitation.declined":
      return "declined a workspace invitation";
    case "member.role_updated": {
      const prev =
        typeof metadata.previousRole === "string"
          ? metadata.previousRole
          : null;
      const next =
        typeof metadata.newRole === "string" ? metadata.newRole : "updated role";
      return prev
        ? `changed a workspace member's role from ${prev} to ${next}`
        : `updated a workspace member's role to ${next}`;
    }
    case "member.removed":
      return "removed a member from the workspace";
    case "workspace.created":
      return `created workspace ${safeTarget ?? ""}`.trim();
    case "workspace.updated":
      return `updated workspace settings${safeTarget ? ` for ${safeTarget}` : ""}`;
    default:
      return `performed ${act.replace(/[._]/g, " ")}`;
  }
}
