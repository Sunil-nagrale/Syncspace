import { prisma } from "@/lib/prisma";
import {
  AuthorizationService,
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";
import {
  getStorageProvider,
  StorageError,
  type PresignedUploadTarget,
} from "@/lib/storage";
import {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_ATTACHMENTS_PER_ARTIFACT,
  MAX_PENDING_UPLOADS_PER_USER,
  buildContentDispositionHeader,
  generateAttachmentStorageKey,
  hasForbiddenExtension,
  isAllowedMimeType,
  normalizeMimeType,
  sanitizeAttachmentFileName,
  validateFileSignatureAndContent,
} from "@/lib/validations/attachment";

export class AttachmentValidationError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = "AttachmentValidationError";
  }
}

export interface PublicAttachmentItem {
  id: string;
  workspaceId: string;
  artifactId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  status: "PENDING" | "READY" | "FAILED" | "DELETING";
  sha256: string | null;
  uploadedById: string;
  createdAt: Date;
  updatedAt: Date;
  uploadedBy: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    color: string;
  };
  canDelete: boolean;
  inlinePreviewSupported: boolean;
}

const STALE_PENDING_UPLOAD_TTL_MS = 15 * 60 * 1000; // 15 minutes

function canUserDeleteAttachment(params: {
  userId: string;
  uploadedById: string;
  effectiveRole: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
  workspaceRole: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
}): boolean {
  const { userId, uploadedById, effectiveRole, workspaceRole } = params;
  if (effectiveRole === "VIEWER") {
    return false;
  }
  if (workspaceRole === "OWNER" || workspaceRole === "ADMIN") {
    return true;
  }
  return uploadedById === userId && effectiveRole === "EDITOR";
}

function toPublicAttachmentItem(
  row: {
    id: string;
    workspaceId: string;
    artifactId: string | null;
    fileName: string;
    fileType: string;
    fileSize: number;
    status: "PENDING" | "READY" | "FAILED" | "DELETING";
    sha256: string | null;
    uploadedById: string;
    createdAt: Date;
    updatedAt: Date;
    uploadedBy: {
      id: string;
      name: string;
      email: string;
      image: string | null;
      color: string;
    };
  },
  userContext: {
    userId: string;
    effectiveRole: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
    workspaceRole: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
  }
): PublicAttachmentItem {
  const normalizedMime = normalizeMimeType(row.fileType);
  const inlinePreviewSupported = isAllowedMimeType(normalizedMime)
    ? ALLOWED_ATTACHMENT_TYPES[normalizedMime].inlinePreviewAllowed
    : false;

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    artifactId: row.artifactId ?? "",
    fileName: row.fileName,
    fileType: row.fileType,
    fileSize: row.fileSize,
    status: row.status,
    sha256: row.sha256,
    uploadedById: row.uploadedById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    uploadedBy: row.uploadedBy,
    canDelete: canUserDeleteAttachment({
      userId: userContext.userId,
      uploadedById: row.uploadedById,
      effectiveRole: userContext.effectiveRole,
      workspaceRole: userContext.workspaceRole,
    }),
    inlinePreviewSupported,
  };
}

export class AttachmentService {
  /**
   * Lists verified READY attachments for an artifact.
   * Enforces active workspace membership, non-archived artifact state, and artifact VIEW permission.
   */
  static async listAttachments(
    userId: string,
    artifactId: string,
    options: { limit?: number } = {}
  ): Promise<{
    items: PublicAttachmentItem[];
    totalCount: number;
  }> {
    const { artifact, membership, effectiveRole } =
      await AuthorizationService.requireArtifactAccess(
        userId,
        artifactId,
        "VIEW"
      );

    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);

    const [rows, totalCount] = await Promise.all([
      prisma.attachment.findMany({
        where: {
          artifactId: artifact.id,
          workspaceId: artifact.workspaceId,
          status: "READY",
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
        include: {
          uploadedBy: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              color: true,
            },
          },
        },
      }),
      prisma.attachment.count({
        where: {
          artifactId: artifact.id,
          workspaceId: artifact.workspaceId,
          status: "READY",
        },
      }),
    ]);

    return {
      items: rows.map((row) =>
        toPublicAttachmentItem(row, {
          userId,
          effectiveRole,
          workspaceRole: membership.role,
        })
      ),
      totalCount,
    };
  }

  /**
   * Initiates a pending attachment upload after validating permissions, rate/concurrency limits,
   * filename safety, allowlisted MIME type, and file size.
   */
  static async initiateUpload(
    userId: string,
    artifactId: string,
    input: {
      fileName: string;
      fileType: string;
      fileSize: number;
    }
  ): Promise<{
    attachment: PublicAttachmentItem;
    uploadTarget: PresignedUploadTarget;
  }> {
    if (!input.fileName || typeof input.fileName !== "string" || !input.fileName.trim()) {
      throw new AttachmentValidationError("File name is required.", 400);
    }

    if (hasForbiddenExtension(input.fileName)) {
      throw new AttachmentValidationError(
        "Executable, script, HTML, and SVG file extensions are not permitted.",
        400
      );
    }

    const normalizedMime = normalizeMimeType(input.fileType || "");
    if (!isAllowedMimeType(normalizedMime)) {
      throw new AttachmentValidationError(
        `Unsupported file type '${input.fileType || "unknown"}'. Allowed types: PDF, PNG, JPEG, WebP, TXT, CSV.`,
        400
      );
    }

    if (
      typeof input.fileSize !== "number" ||
      !Number.isInteger(input.fileSize) ||
      input.fileSize <= 0
    ) {
      throw new AttachmentValidationError(
        "File size must be a positive integer.",
        400
      );
    }

    if (input.fileSize > MAX_ATTACHMENT_SIZE_BYTES) {
      throw new AttachmentValidationError(
        `File size (${input.fileSize} bytes) exceeds the maximum limit of 10 MiB (${MAX_ATTACHMENT_SIZE_BYTES} bytes).`,
        400
      );
    }

    const typeMeta = ALLOWED_ATTACHMENT_TYPES[normalizedMime];
    const sanitizedFileName = sanitizeAttachmentFileName(
      input.fileName,
      typeMeta.extension
    );

    // Clean up stale pending uploads for this user before checking concurrency limits
    await this.cleanupStalePendingUploadsForUser(userId);

    const txResult = await prisma.$transaction(async (tx) => {
      const { artifact, membership, effectiveRole } =
        await AuthorizationService.requireArtifactAccessTx(
          tx,
          userId,
          artifactId,
          "EDIT"
        );

      const pendingCount = await tx.attachment.count({
        where: {
          uploadedById: userId,
          status: "PENDING",
        },
      });

      if (pendingCount >= MAX_PENDING_UPLOADS_PER_USER) {
        throw new AttachmentValidationError(
          `Too many pending uploads in progress (maximum ${MAX_PENDING_UPLOADS_PER_USER}). Complete or cancel existing uploads first.`,
          429
        );
      }

      const existingArtifactAttachments = await tx.attachment.count({
        where: {
          artifactId: artifact.id,
          status: "READY",
        },
      });

      if (existingArtifactAttachments >= MAX_ATTACHMENTS_PER_ARTIFACT) {
        throw new AttachmentValidationError(
          `Maximum attachment limit (${MAX_ATTACHMENTS_PER_ARTIFACT}) reached for this artifact.`,
          400
        );
      }

      const storageKey = generateAttachmentStorageKey(
        artifact.workspaceId,
        artifact.id
      );

      const created = await tx.attachment.create({
        data: {
          workspaceId: artifact.workspaceId,
          artifactId: artifact.id,
          fileName: sanitizedFileName,
          fileType: normalizedMime,
          fileSize: input.fileSize,
          storageKey,
          status: "PENDING",
          uploadedById: userId,
        },
        include: {
          uploadedBy: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              color: true,
            },
          },
        },
      });

      return {
        created,
        membership,
        effectiveRole,
      };
    });

    const storage = getStorageProvider();
    let uploadTarget: PresignedUploadTarget;

    if (storage.createPresignedUploadUrl) {
      uploadTarget = await storage.createPresignedUploadUrl({
        storageKey: txResult.created.storageKey,
        contentType: normalizedMime,
        contentLength: input.fileSize,
        expiresInSeconds: 300,
      });
    } else {
      uploadTarget = {
        url: `/api/artifacts/${artifactId}/attachments/${txResult.created.id}/complete`,
        method: "PUT",
        headers: {
          "Content-Type": normalizedMime,
        },
        expiresInSeconds: 300,
      };
    }

    return {
      attachment: toPublicAttachmentItem(txResult.created, {
        userId,
        effectiveRole: txResult.effectiveRole,
        workspaceRole: txResult.membership.role,
      }),
      uploadTarget,
    };
  }

  /**
   * Verifies the stored object in private storage and marks a PENDING attachment as READY.
   * Idempotent for already-READY attachments belonging to the same uploader and artifact.
   * If optionalBytes are supplied, writes them to storage prior to verification.
   */
  static async completeUpload(
    userId: string,
    artifactId: string,
    attachmentId: string,
    optionalBytes?: Uint8Array
  ): Promise<PublicAttachmentItem> {
    const { artifact, membership, effectiveRole } =
      await AuthorizationService.requireArtifactAccess(
        userId,
        artifactId,
        "EDIT"
      );

    const existing = await prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: {
        uploadedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            color: true,
          },
        },
      },
    });

    if (
      !existing ||
      existing.artifactId !== artifact.id ||
      existing.workspaceId !== artifact.workspaceId
    ) {
      throw new NotFoundError("Attachment not found.");
    }

    if (existing.uploadedById !== userId) {
      throw new AuthorizationError(
        "Only the user who initiated the upload can complete it.",
        403
      );
    }

    // Idempotent return if already completed
    if (existing.status === "READY") {
      return toPublicAttachmentItem(existing, {
        userId,
        effectiveRole,
        workspaceRole: membership.role,
      });
    }

    if (existing.status === "DELETING" || existing.status === "FAILED") {
      throw new AttachmentValidationError(
        `Cannot complete upload for an attachment in '${existing.status}' state.`,
        409
      );
    }

    const storage = getStorageProvider();

    if (optionalBytes) {
      if (optionalBytes.byteLength !== existing.fileSize) {
        await this.markUploadFailedAndCleanup(
          existing.id,
          existing.storageKey,
          `Uploaded byte length (${optionalBytes.byteLength}) does not match declared file size (${existing.fileSize}).`
        );
        throw new AttachmentValidationError(
          `Uploaded byte length (${optionalBytes.byteLength}) does not match declared file size (${existing.fileSize}).`,
          400
        );
      }

      const precheck = validateFileSignatureAndContent({
        bytes: optionalBytes,
        declaredMimeType: existing.fileType,
        fileName: existing.fileName,
      });

      if (!precheck.valid) {
        await this.markUploadFailedAndCleanup(
          existing.id,
          existing.storageKey,
          precheck.error || "File content validation failed."
        );
        throw new AttachmentValidationError(
          precheck.error || "File content validation failed.",
          400
        );
      }

      await storage.putObject({
        storageKey: existing.storageKey,
        bytes: optionalBytes,
        contentType: existing.fileType,
      });
    }

    // Verify stored object metadata & content in private storage
    const head = await storage.headObject(existing.storageKey);
    if (!head.exists) {
      throw new AttachmentValidationError(
        "Uploaded object was not found in private storage. Complete the upload before finalizing.",
        400
      );
    }

    if (
      head.byteLength <= 0 ||
      head.byteLength > MAX_ATTACHMENT_SIZE_BYTES ||
      head.byteLength !== existing.fileSize
    ) {
      await this.markUploadFailedAndCleanup(
        existing.id,
        existing.storageKey,
        `Stored object size (${head.byteLength}) does not match declared size (${existing.fileSize}).`
      );
      throw new AttachmentValidationError(
        `Stored object size (${head.byteLength} bytes) does not match declared file size (${existing.fileSize} bytes).`,
        400
      );
    }

    const storedBytes = await storage.getObjectBytes(existing.storageKey);
    if (!storedBytes) {
      throw new AttachmentValidationError(
        "Failed to read uploaded object for content verification.",
        400
      );
    }

    const validation = validateFileSignatureAndContent({
      bytes: storedBytes,
      declaredMimeType: existing.fileType,
      fileName: existing.fileName,
    });

    if (!validation.valid) {
      await this.markUploadFailedAndCleanup(
        existing.id,
        existing.storageKey,
        validation.error || "File signature verification failed."
      );
      throw new AttachmentValidationError(
        validation.error || "File signature verification failed.",
        400
      );
    }

    // Atomically transition to READY inside transaction with re-validated authorization
    const finalized = await prisma.$transaction(async (tx) => {
      const txAccess = await AuthorizationService.requireArtifactAccessTx(
        tx,
        userId,
        artifactId,
        "EDIT"
      );

      const current = await tx.attachment.findUnique({
        where: { id: existing.id },
        include: {
          uploadedBy: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              color: true,
            },
          },
        },
      });

      if (
        !current ||
        current.artifactId !== txAccess.artifact.id ||
        current.workspaceId !== txAccess.artifact.workspaceId
      ) {
        throw new NotFoundError("Attachment not found.");
      }

      if (current.status === "READY") {
        return {
          row: current,
          effectiveRole: txAccess.effectiveRole,
          workspaceRole: txAccess.membership.role,
        };
      }

      if (current.status !== "PENDING") {
        throw new AttachmentValidationError(
          `Cannot complete attachment in '${current.status}' state.`,
          409
        );
      }

      const updated = await tx.attachment.update({
        where: { id: current.id },
        data: {
          status: "READY",
          sha256: validation.sha256 ?? null,
          failureReason: null,
        },
        include: {
          uploadedBy: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              color: true,
            },
          },
        },
      });

      await tx.activityEvent.create({
        data: {
          workspaceId: txAccess.artifact.workspaceId,
          userId,
          action: "UPLOADED_ATTACHMENT",
          entityType: "ATTACHMENT",
          entityId: updated.id,
          metadata: {
            artifactId: txAccess.artifact.id,
            fileName: updated.fileName,
            fileType: updated.fileType,
            fileSize: updated.fileSize,
          },
        },
      });

      return {
        row: updated,
        effectiveRole: txAccess.effectiveRole,
        workspaceRole: txAccess.membership.role,
      };
    });

    return toPublicAttachmentItem(finalized.row, {
      userId,
      effectiveRole: finalized.effectiveRole,
      workspaceRole: finalized.workspaceRole,
    });
  }

  /**
   * Convenience server-side upload that validates content, creates a PENDING record,
   * writes bytes to private storage, and completes verification to READY.
   * Cleans up storage and marks FAILED if any step fails.
   */
  static async uploadAttachment(
    userId: string,
    artifactId: string,
    input: {
      fileName: string;
      fileType: string;
      bytes: Uint8Array;
    }
  ): Promise<PublicAttachmentItem> {
    const validation = validateFileSignatureAndContent({
      bytes: input.bytes,
      declaredMimeType: input.fileType,
      fileName: input.fileName,
    });

    if (!validation.valid || !validation.normalizedMimeType || !validation.sanitizedFileName) {
      throw new AttachmentValidationError(
        validation.error || "File validation failed.",
        400
      );
    }

    const { attachment } = await this.initiateUpload(userId, artifactId, {
      fileName: validation.sanitizedFileName,
      fileType: validation.normalizedMimeType,
      fileSize: input.bytes.byteLength,
    });

    try {
      return await this.completeUpload(
        userId,
        artifactId,
        attachment.id,
        input.bytes
      );
    } catch (err) {
      const record = await prisma.attachment.findUnique({
        where: { id: attachment.id },
        select: { id: true, storageKey: true, status: true },
      });
      if (record && record.status === "PENDING") {
        await this.markUploadFailedAndCleanup(
          record.id,
          record.storageKey,
          err instanceof Error ? err.message : "Upload failed"
        );
      }
      throw err;
    }
  }

  /**
   * Authorizes and retrieves an attachment's verified bytes and safe response headers for download or inline preview.
   * Re-checks workspace membership, archived artifact state, and explicit NONE overrides on every request.
   */
  static async getDownloadPayload(
    userId: string,
    artifactId: string,
    attachmentId: string,
    disposition: "inline" | "attachment" = "attachment"
  ): Promise<{
    bytes: Uint8Array;
    headers: Record<string, string>;
    attachment: PublicAttachmentItem;
  }> {
    const { artifact, membership, effectiveRole } =
      await AuthorizationService.requireArtifactAccess(
        userId,
        artifactId,
        "VIEW"
      );

    const row = await prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: {
        uploadedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            color: true,
          },
        },
      },
    });

    if (
      !row ||
      row.artifactId !== artifact.id ||
      row.workspaceId !== artifact.workspaceId ||
      row.status !== "READY"
    ) {
      throw new NotFoundError("Attachment not found.");
    }

    const storage = getStorageProvider();
    const bytes = await storage.getObjectBytes(row.storageKey);

    if (!bytes) {
      throw new NotFoundError("Attachment file content not found in storage.");
    }

    const contentDisposition = buildContentDispositionHeader(
      disposition,
      row.fileName,
      row.fileType
    );

    const headers: Record<string, string> = {
      "Content-Type": row.fileType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": contentDisposition,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Security-Policy":
        "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; sandbox",
    };

    if (row.sha256) {
      headers["ETag"] = `"${row.sha256}"`;
    }

    return {
      bytes,
      headers,
      attachment: toPublicAttachmentItem(row, {
        userId,
        effectiveRole,
        workspaceRole: membership.role,
      }),
    };
  }

  /**
   * Deletes an attachment according to the documented permission policy:
   * - Workspace OWNER or ADMIN (with valid artifact access), OR
   * - The original uploader (provided they still have EDIT permission on the artifact).
   *
   * Uses a two-phase DELETING -> storage delete -> DB delete workflow so failed storage deletions
   * never leave accessible files or falsely report success, and retries are idempotent.
   */
  static async deleteAttachment(
    userId: string,
    artifactId: string,
    attachmentId: string
  ): Promise<{ deleted: true; id: string }> {
    const lockedRecord = await prisma.$transaction(async (tx) => {
      const { artifact, membership, effectiveRole } =
        await AuthorizationService.requireArtifactAccessTx(
          tx,
          userId,
          artifactId,
          "VIEW"
        );

      const target = await tx.attachment.findUnique({
        where: { id: attachmentId },
      });

      if (
        !target ||
        target.artifactId !== artifact.id ||
        target.workspaceId !== artifact.workspaceId
      ) {
        throw new NotFoundError("Attachment not found.");
      }

      const allowed = canUserDeleteAttachment({
        userId,
        uploadedById: target.uploadedById,
        effectiveRole,
        workspaceRole: membership.role,
      });

      if (!allowed) {
        throw new AuthorizationError(
          "You do not have permission to delete this attachment. Only the uploader (with edit access) or a workspace administrator can delete it.",
          403
        );
      }

      // Mark as DELETING first so concurrent downloads immediately reject access
      if (target.status !== "DELETING") {
        await tx.attachment.update({
          where: { id: target.id },
          data: { status: "DELETING" },
        });
      }

      return {
        target,
        workspaceId: artifact.workspaceId,
        artifactId: artifact.id,
      };
    });

    const storage = getStorageProvider();

    // Delete from object storage before removing DB metadata.
    // If storage deletion throws, the record stays in DELETING (inaccessible for download) and can be retried.
    await storage.deleteObject(lockedRecord.target.storageKey);

    await prisma.$transaction(async (tx) => {
      await tx.attachment.deleteMany({
        where: { id: lockedRecord.target.id },
      });

      await tx.activityEvent.create({
        data: {
          workspaceId: lockedRecord.workspaceId,
          userId,
          action: "DELETED_ATTACHMENT",
          entityType: "ATTACHMENT",
          entityId: lockedRecord.target.id,
          metadata: {
            artifactId: lockedRecord.artifactId,
            fileName: lockedRecord.target.fileName,
            fileType: lockedRecord.target.fileType,
            fileSize: lockedRecord.target.fileSize,
          },
        },
      });
    });

    return { deleted: true, id: lockedRecord.target.id };
  }

  /**
   * Marks a pending upload as FAILED and attempts to remove any unreferenced object from storage.
   */
  private static async markUploadFailedAndCleanup(
    attachmentId: string,
    storageKey: string,
    reason: string
  ): Promise<void> {
    const storage = getStorageProvider();
    try {
      await storage.deleteObject(storageKey);
    } catch {
      // Best-effort storage cleanup for invalid pending upload
    }

    try {
      await prisma.attachment.updateMany({
        where: {
          id: attachmentId,
          status: "PENDING",
        },
        data: {
          status: "FAILED",
          failureReason: reason.slice(0, 500),
        },
      });
    } catch {
      // Ignore if already cleaned up
    }
  }

  /**
   * Cleans up stale PENDING uploads older than STALE_PENDING_UPLOAD_TTL_MS for a user,
   * and retries any stuck DELETING / FAILED records where storage cleanup is needed.
   */
  static async cleanupStalePendingUploadsForUser(
    userId: string,
    customCutoffDate?: Date
  ): Promise<number> {
    const cutoff =
      customCutoffDate ?? new Date(Date.now() - STALE_PENDING_UPLOAD_TTL_MS);

    const stale = await prisma.attachment.findMany({
      where: {
        uploadedById: userId,
        status: "PENDING",
        createdAt: { lt: cutoff },
      },
      select: { id: true, storageKey: true },
    });

    if (stale.length === 0) return 0;

    const storage = getStorageProvider();
    let cleaned = 0;

    for (const item of stale) {
      try {
        await storage.deleteObject(item.storageKey);
        await prisma.attachment.deleteMany({
          where: { id: item.id, status: "PENDING" },
        });
        cleaned++;
      } catch {
        // Leave for next cleanup pass if storage is temporarily unavailable
      }
    }

    return cleaned;
  }

  /**
   * Retries cleanup for attachments left in DELETING or FAILED states.
   */
  static async retryCleanupForArtifact(artifactId: string): Promise<number> {
    const records = await prisma.attachment.findMany({
      where: {
        artifactId,
        status: { in: ["DELETING", "FAILED"] },
      },
      select: { id: true, storageKey: true, status: true },
    });

    if (records.length === 0) return 0;

    const storage = getStorageProvider();
    let cleaned = 0;

    for (const rec of records) {
      try {
        await storage.deleteObject(rec.storageKey);
        await prisma.attachment.deleteMany({
          where: { id: rec.id, status: { in: ["DELETING", "FAILED"] } },
        });
        cleaned++;
      } catch (err) {
        if (err instanceof StorageError) {
          // Keep record in DELETING/FAILED for future retry if storage is still unreachable
          continue;
        }
      }
    }

    return cleaned;
  }
}
