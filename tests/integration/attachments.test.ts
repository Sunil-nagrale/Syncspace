import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { ArtifactService } from "@/services/artifact.service";
import { VersionService } from "@/services/version.service";
import {
  AttachmentIntegrityError,
  AttachmentService,
  AttachmentValidationError,
} from "@/services/attachment.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";
import {
  InMemoryStorageProvider,
  StorageError,
  isFinalStorageKey,
  isStagingStorageKey,
  setStorageProviderForTests,
} from "@/lib/storage";
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  computeSha256Hex,
} from "@/lib/validations/attachment";

const SAMPLE_PDF_BYTES = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n"
);
const SAMPLE_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01,
]);
const SAMPLE_TXT_BYTES = new TextEncoder().encode(
  "SyncSpace Phase 9B integration test attachment payload."
);

describe("Artifact File Attachments PostgreSQL Integration Tests", () => {
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const memoryStorage = new InMemoryStorageProvider();

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
    setStorageProviderForTests(memoryStorage);
  });

  beforeEach(() => {
    memoryStorage.setFailNextPut(false);
    memoryStorage.setFailNextDelete(false);
    memoryStorage.setFailNextGet(false);
    memoryStorage.setFailNextHead(false);
    memoryStorage.setFailNextPromote(false);
    memoryStorage.setBeforePromoteHookForTests(null);
    AttachmentService.setFailNextCompleteTransactionForTests(false);
  });

  afterAll(async () => {
    memoryStorage.setBeforePromoteHookForTests(null);
    setStorageProviderForTests(null);
    memoryStorage.clear();

    if (createdWorkspaceIds.length > 0) {
      for (const wid of createdWorkspaceIds) {
        await prisma.workspace.delete({ where: { id: wid } }).catch(() => {});
      }
    }
    if (createdUserIds.length > 0) {
      await prisma.user
        .deleteMany({
          where: { id: { in: createdUserIds } },
        })
        .catch(() => {});
    }
    await prisma.$disconnect();
  });

  async function createTestUser(suffix: string) {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);
    const email = `att.user.${timestamp}.${rand}.${suffix}@syncspace.dev`;

    const user = await prisma.user.create({
      data: {
        name: `User ${suffix}`,
        email,
        emailVerified: true,
        color: "#6366F1",
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function createTestWorkspaceFixture() {
    const owner = await createTestUser("owner");
    const admin = await createTestUser("admin");
    const editor1 = await createTestUser("editor1");
    const editor2 = await createTestUser("editor2");
    const viewer = await createTestUser("viewer");
    const outsider = await createTestUser("outsider");

    const slug = `att-ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const workspace = await prisma.workspace.create({
      data: {
        name: `Attachments Workspace ${slug}`,
        slug,
        createdById: owner.id,
        members: {
          create: [
            { userId: owner.id, role: "OWNER" },
            { userId: admin.id, role: "ADMIN" },
            { userId: editor1.id, role: "EDITOR" },
            { userId: editor2.id, role: "EDITOR" },
            { userId: viewer.id, role: "VIEWER" },
          ],
        },
      },
    });
    createdWorkspaceIds.push(workspace.id);

    const doc = await ArtifactService.createArtifact(editor1.id, {
      workspaceId: workspace.id,
      type: "DOCUMENT",
      title: "Architecture Spec With Attachments",
    });

    const board = await ArtifactService.createArtifact(editor1.id, {
      workspaceId: workspace.id,
      type: "WHITEBOARD",
      title: "Topology Board With Attachments",
    });

    return {
      owner,
      admin,
      editor1,
      editor2,
      viewer,
      outsider,
      workspace,
      doc,
      board,
    };
  }

  it("1. Creates pending upload metadata, verifies stored object on completion, associates with artifact & workspace, and never exposes storageKey", async () => {
    const { editor1, viewer, workspace, doc } =
      await createTestWorkspaceFixture();

    const initiated = await AttachmentService.initiateUpload(
      editor1.id,
      doc.id,
      {
        fileName: "../specs/system-architecture.pdf",
        fileType: "application/pdf",
        fileSize: SAMPLE_PDF_BYTES.byteLength,
      }
    );

    expect(initiated.attachment.status).toBe("PENDING");
    expect(initiated.attachment.fileName).toBe("system-architecture.pdf");
    expect(initiated.attachment.workspaceId).toBe(workspace.id);
    expect(initiated.attachment.artifactId).toBe(doc.id);
    expect(initiated.attachment.uploadedById).toBe(editor1.id);
    expect("storageKey" in initiated.attachment).toBe(false);

    // Pending attachments must NOT appear in ready list or be downloadable yet
    const listWhilePending = await AttachmentService.listAttachments(
      viewer.id,
      doc.id
    );
    expect(listWhilePending.items).toHaveLength(0);

    await expect(
      AttachmentService.getDownloadPayload(
        viewer.id,
        doc.id,
        initiated.attachment.id
      )
    ).rejects.toThrow(NotFoundError);

    // Complete upload with actual bytes
    const completed = await AttachmentService.completeUpload(
      editor1.id,
      doc.id,
      initiated.attachment.id,
      SAMPLE_PDF_BYTES
    );

    expect(completed.status).toBe("READY");
    expect(completed.sha256).toBe(computeSha256Hex(SAMPLE_PDF_BYTES));
    expect("storageKey" in completed).toBe(false);

    // Duplicate completion request is idempotent
    const duplicateComplete = await AttachmentService.completeUpload(
      editor1.id,
      doc.id,
      initiated.attachment.id
    );
    expect(duplicateComplete.id).toBe(completed.id);
    expect(duplicateComplete.status).toBe("READY");

    // Verify database row has unpredictable storageKey and no publicUrl
    const dbRow = await prisma.attachment.findUnique({
      where: { id: completed.id },
    });
    expect(dbRow).not.toBeNull();
    expect(dbRow!.storageKey).toContain(
      `workspaces/${workspace.id}/artifacts/${doc.id}/blobs/`
    );
    expect(dbRow!.storageKey).not.toContain("system-architecture");
    expect(dbRow!.publicUrl).toBeNull();
  });

  it("2. Supports authorized listing, inline preview, download with safe headers, and enforces uploader vs admin deletion policy", async () => {
    const { owner, editor1, editor2, viewer, board } =
      await createTestWorkspaceFixture();

    const uploaded = await AttachmentService.uploadAttachment(
      editor1.id,
      board.id,
      {
        fileName: "topology-diagram.png",
        fileType: "image/png",
        bytes: SAMPLE_PNG_BYTES,
      }
    );

    // Viewer can list and download/preview
    const viewerList = await AttachmentService.listAttachments(
      viewer.id,
      board.id
    );
    expect(viewerList.totalCount).toBe(1);
    expect(viewerList.items[0].id).toBe(uploaded.id);
    expect(viewerList.items[0].canDelete).toBe(false);

    const previewPayload = await AttachmentService.getDownloadPayload(
      viewer.id,
      board.id,
      uploaded.id,
      "inline"
    );
    expect(Buffer.from(previewPayload.bytes)).toEqual(
      Buffer.from(SAMPLE_PNG_BYTES)
    );
    expect(previewPayload.headers["Content-Type"]).toBe("image/png");
    expect(previewPayload.headers["Content-Disposition"]).toContain("inline;");
    expect(previewPayload.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(previewPayload.headers["Cache-Control"]).toContain("private");

    // Viewer cannot upload or delete
    await expect(
      AttachmentService.uploadAttachment(viewer.id, board.id, {
        fileName: "viewer-note.txt",
        fileType: "text/plain",
        bytes: SAMPLE_TXT_BYTES,
      })
    ).rejects.toThrow(AuthorizationError);

    await expect(
      AttachmentService.deleteAttachment(viewer.id, board.id, uploaded.id)
    ).rejects.toThrow(AuthorizationError);

    // Another editor (editor2) who did NOT upload the file cannot delete editor1's attachment
    await expect(
      AttachmentService.deleteAttachment(editor2.id, board.id, uploaded.id)
    ).rejects.toThrow(AuthorizationError);

    // Uploader (editor1) CAN delete their own attachment
    const delRes = await AttachmentService.deleteAttachment(
      editor1.id,
      board.id,
      uploaded.id
    );
    expect(delRes.deleted).toBe(true);

    // Upload a second attachment by editor1 and verify workspace OWNER can delete it
    const secondUpload = await AttachmentService.uploadAttachment(
      editor1.id,
      board.id,
      {
        fileName: "notes.txt",
        fileType: "text/plain",
        bytes: SAMPLE_TXT_BYTES,
      }
    );
    const ownerDelete = await AttachmentService.deleteAttachment(
      owner.id,
      board.id,
      secondUpload.id
    );
    expect(ownerDelete.deleted).toBe(true);
  });

  it("3. Rejects cross-workspace and cross-artifact IDOR for listing, completion, download, and deletion", async () => {
    const fixtureA = await createTestWorkspaceFixture();
    const fixtureB = await createTestWorkspaceFixture();

    const attA = await AttachmentService.uploadAttachment(
      fixtureA.editor1.id,
      fixtureA.doc.id,
      {
        fileName: "confidential-a.txt",
        fileType: "text/plain",
        bytes: SAMPLE_TXT_BYTES,
      }
    );

    // Outsider or user from Workspace B cannot list, download, or delete Workspace A's attachment
    await expect(
      AttachmentService.listAttachments(fixtureB.owner.id, fixtureA.doc.id)
    ).rejects.toThrow(NotFoundError);

    await expect(
      AttachmentService.getDownloadPayload(
        fixtureB.owner.id,
        fixtureA.doc.id,
        attA.id
      )
    ).rejects.toThrow(NotFoundError);

    // Passing Workspace B's artifactId with Workspace A's attachmentId must fail with 404
    await expect(
      AttachmentService.getDownloadPayload(
        fixtureB.owner.id,
        fixtureB.doc.id,
        attA.id
      )
    ).rejects.toThrow(NotFoundError);

    await expect(
      AttachmentService.deleteAttachment(
        fixtureB.owner.id,
        fixtureB.doc.id,
        attA.id
      )
    ).rejects.toThrow(NotFoundError);

    // Pending upload initiated on doc cannot be completed against board (even within same workspace)
    const pendingOnDoc = await AttachmentService.initiateUpload(
      fixtureA.editor1.id,
      fixtureA.doc.id,
      {
        fileName: "scoped.txt",
        fileType: "text/plain",
        fileSize: SAMPLE_TXT_BYTES.byteLength,
      }
    );

    await expect(
      AttachmentService.completeUpload(
        fixtureA.editor1.id,
        fixtureA.board.id,
        pendingOnDoc.attachment.id,
        SAMPLE_TXT_BYTES
      )
    ).rejects.toThrow(NotFoundError);

    // Another editor in the same workspace cannot complete editor1's pending upload
    await expect(
      AttachmentService.completeUpload(
        fixtureA.editor2.id,
        fixtureA.doc.id,
        pendingOnDoc.attachment.id,
        SAMPLE_TXT_BYTES
      )
    ).rejects.toThrow(AuthorizationError);
  });

  it("4. Immediately enforces explicit NONE overrides, VIEWER overrides, and revoked workspace membership", async () => {
    const { editor1, editor2, workspace, doc } =
      await createTestWorkspaceFixture();

    const attachment = await AttachmentService.uploadAttachment(
      editor1.id,
      doc.id,
      {
        fileName: "shared-spec.pdf",
        fileType: "application/pdf",
        bytes: SAMPLE_PDF_BYTES,
      }
    );

    // Apply explicit NONE override to editor2 on doc
    await prisma.artifactPermission.create({
      data: {
        artifactId: doc.id,
        userId: editor2.id,
        role: "NONE",
      },
    });

    await expect(
      AttachmentService.listAttachments(editor2.id, doc.id)
    ).rejects.toThrow(AuthorizationError);

    await expect(
      AttachmentService.getDownloadPayload(editor2.id, doc.id, attachment.id)
    ).rejects.toThrow(AuthorizationError);

    await expect(
      AttachmentService.uploadAttachment(editor2.id, doc.id, {
        fileName: "blocked.txt",
        fileType: "text/plain",
        bytes: SAMPLE_TXT_BYTES,
      })
    ).rejects.toThrow(AuthorizationError);

    // Downgrade editor1 via explicit VIEWER override -> can view/download, but can no longer upload or delete their own attachment
    await prisma.artifactPermission.create({
      data: {
        artifactId: doc.id,
        userId: editor1.id,
        role: "VIEWER",
      },
    });

    await expect(
      AttachmentService.deleteAttachment(editor1.id, doc.id, attachment.id)
    ).rejects.toThrow(AuthorizationError);

    // Revoke editor1's workspace membership -> immediately loses download access
    await prisma.workspaceMember.delete({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId: editor1.id,
        },
      },
    });

    await expect(
      AttachmentService.getDownloadPayload(editor1.id, doc.id, attachment.id)
    ).rejects.toThrow(NotFoundError);
  });

  it("5. Rejects oversized files, unsupported types, and invalid stored object metadata / tampered content", async () => {
    const { editor1, doc } = await createTestWorkspaceFixture();

    // Oversized initiation rejected
    await expect(
      AttachmentService.initiateUpload(editor1.id, doc.id, {
        fileName: "too-big.pdf",
        fileType: "application/pdf",
        fileSize: MAX_ATTACHMENT_SIZE_BYTES + 1,
      })
    ).rejects.toThrow(AttachmentValidationError);

    // Unsupported type rejected
    await expect(
      AttachmentService.initiateUpload(editor1.id, doc.id, {
        fileName: "vector.svg",
        fileType: "image/svg+xml",
        fileSize: 512,
      })
    ).rejects.toThrow(AttachmentValidationError);

    // Initiate valid PDF upload, but upload mismatched byte length or invalid magic header
    const initiated = await AttachmentService.initiateUpload(
      editor1.id,
      doc.id,
      {
        fileName: "tampered.pdf",
        fileType: "application/pdf",
        fileSize: SAMPLE_TXT_BYTES.byteLength,
      }
    );

    await expect(
      AttachmentService.completeUpload(
        editor1.id,
        doc.id,
        initiated.attachment.id,
        SAMPLE_TXT_BYTES // Not a valid %PDF- header!
      )
    ).rejects.toThrow(AttachmentValidationError);

    // Verify record was marked FAILED and cleaned from storage
    const failedRow = await prisma.attachment.findUnique({
      where: { id: initiated.attachment.id },
    });
    expect(failedRow?.status).toBe("FAILED");
    expect(memoryStorage.hasKey(failedRow!.storageKey)).toBe(false);
  });

  it("6. Handles storage deletion failure safely without leaving accessible files, and supports idempotent retry", async () => {
    const { editor1, viewer, doc } = await createTestWorkspaceFixture();

    const attachment = await AttachmentService.uploadAttachment(
      editor1.id,
      doc.id,
      {
        fileName: "resilient-delete.pdf",
        fileType: "application/pdf",
        bytes: SAMPLE_PDF_BYTES,
      }
    );

    // Inject storage failure on next delete
    memoryStorage.setFailNextDelete(true);

    await expect(
      AttachmentService.deleteAttachment(editor1.id, doc.id, attachment.id)
    ).rejects.toThrow(StorageError);

    // While storage delete failed, the DB record is in DELETING state and MUST NOT be downloadable or listed
    const listAfterFailedDelete = await AttachmentService.listAttachments(
      viewer.id,
      doc.id
    );
    expect(listAfterFailedDelete.items).toHaveLength(0);

    await expect(
      AttachmentService.getDownloadPayload(viewer.id, doc.id, attachment.id)
    ).rejects.toThrow(NotFoundError);

    // Retrying deleteAttachment succeeds idempotently and removes both the storage object and DB row
    const retryRes = await AttachmentService.deleteAttachment(
      editor1.id,
      doc.id,
      attachment.id
    );
    expect(retryRes.deleted).toBe(true);

    const dbRowAfterRetry = await prisma.attachment.findUnique({
      where: { id: attachment.id },
    });
    expect(dbRowAfterRetry).toBeNull();
  });

  it("7. Preserves attachments intact when a document or whiteboard is edited and restored to an older version", async () => {
    const { editor1, doc } = await createTestWorkspaceFixture();

    const v1Content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Version 1" }] },
      ],
    };
    const v1 = await VersionService.createCheckpoint(editor1.id, doc.id, {
      title: "Doc v1",
      snapshotData: v1Content,
      source: "MANUAL",
    });

    const attachment = await AttachmentService.uploadAttachment(
      editor1.id,
      doc.id,
      {
        fileName: "persistent-evidence.pdf",
        fileType: "application/pdf",
        bytes: SAMPLE_PDF_BYTES,
      }
    );

    const v2Content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Version 2" }] },
      ],
    };
    await VersionService.createCheckpoint(editor1.id, doc.id, {
      title: "Doc v2",
      snapshotData: v2Content,
      source: "MANUAL",
    });

    const latestArtifact = await prisma.artifact.findUniqueOrThrow({
      where: { id: doc.id },
    });

    await VersionService.restoreVersion(
      editor1.id,
      doc.id,
      v1.id,
      { expectedRevision: latestArtifact.currentRevision }
    );

    // Verify attachment remains READY and downloadable after version restoration
    const afterRestoreList = await AttachmentService.listAttachments(
      editor1.id,
      doc.id
    );
    expect(afterRestoreList.items).toHaveLength(1);
    expect(afterRestoreList.items[0].id).toBe(attachment.id);

    const downloadAfterRestore = await AttachmentService.getDownloadPayload(
      editor1.id,
      doc.id,
      attachment.id
    );
    expect(Buffer.from(downloadAfterRestore.bytes)).toEqual(
      Buffer.from(SAMPLE_PDF_BYTES)
    );
  });

  it("8. Promotes staged uploads to a distinct final key and prevents post-verification overwrites via reused staging keys", async () => {
    const { editor1, viewer, workspace, doc } =
      await createTestWorkspaceFixture();

    const initiated = await AttachmentService.initiateUpload(
      editor1.id,
      doc.id,
      {
        fileName: "immutable-contract.pdf",
        fileType: "application/pdf",
        fileSize: SAMPLE_PDF_BYTES.byteLength,
      }
    );

    const pendingRow = await prisma.attachment.findUniqueOrThrow({
      where: { id: initiated.attachment.id },
    });
    const originalStagingKey = pendingRow.storageKey;

    expect(pendingRow.status).toBe("PENDING");
    expect(isStagingStorageKey(originalStagingKey)).toBe(true);
    expect(originalStagingKey).toContain(
      `workspaces/${workspace.id}/artifacts/${doc.id}/staging/`
    );

    // Simulate client uploading directly to the staging key
    await memoryStorage.putObject({
      storageKey: originalStagingKey,
      bytes: SAMPLE_PDF_BYTES,
      contentType: "application/pdf",
    });
    expect(memoryStorage.hasKey(originalStagingKey)).toBe(true);

    // Complete upload -> validates staged bytes, promotes to final 'blobs/' key, and deletes staging object
    const completed = await AttachmentService.completeUpload(
      editor1.id,
      doc.id,
      initiated.attachment.id
    );

    const expectedSha256 = computeSha256Hex(SAMPLE_PDF_BYTES);
    expect(completed.status).toBe("READY");
    expect(completed.sha256).toBe(expectedSha256);

    const finalizedRow = await prisma.attachment.findUniqueOrThrow({
      where: { id: completed.id },
    });
    const finalStorageKey = finalizedRow.storageKey;

    expect(finalStorageKey).not.toBe(originalStagingKey);
    expect(isFinalStorageKey(finalStorageKey)).toBe(true);
    expect(finalStorageKey).toContain(
      `workspaces/${workspace.id}/artifacts/${doc.id}/blobs/`
    );

    // Staging object must be removed and final object must exist
    expect(memoryStorage.hasKey(originalStagingKey)).toBe(false);
    expect(memoryStorage.hasKey(finalStorageKey)).toBe(true);

    // Simulate an attacker or buggy client reusing the still-valid presigned PUT URL (writing to originalStagingKey)
    const tamperedPdfBytes = new TextEncoder().encode(
      "%PDF-1.7\n1 0 obj\n<< /Tampered true >>\nendobj\n%%EOF\n"
    );
    await memoryStorage.putObject({
      storageKey: originalStagingKey,
      bytes: tamperedPdfBytes,
      contentType: "application/pdf",
    });

    // Also attempt calling completeUpload again with tampered bytes
    const repeatComplete = await AttachmentService.completeUpload(
      editor1.id,
      doc.id,
      completed.id,
      tamperedPdfBytes
    );
    expect(repeatComplete.sha256).toBe(expectedSha256);

    // Verify the finalized attachment at finalStorageKey is completely untouched and serves original verified bytes
    const download = await AttachmentService.getDownloadPayload(
      viewer.id,
      doc.id,
      completed.id
    );
    expect(Buffer.from(download.bytes)).toEqual(Buffer.from(SAMPLE_PDF_BYTES));
    expect(computeSha256Hex(download.bytes)).toBe(expectedSha256);
  });

  it("9. Blocks promotion of invalid staged bytes and keeps attachment PENDING if storage promotion fails", async () => {
    const { editor1, workspace, doc } = await createTestWorkspaceFixture();

    // Case A: Invalid staged bytes (MZ executable disguised as PDF) must never be promoted to blobs/
    const badInit = await AttachmentService.initiateUpload(
      editor1.id,
      doc.id,
      {
        fileName: "disguised-malware.pdf",
        fileType: "application/pdf",
        fileSize: 6,
      }
    );
    const badPendingRow = await prisma.attachment.findUniqueOrThrow({
      where: { id: badInit.attachment.id },
    });
    const badStagingKey = badPendingRow.storageKey;

    await memoryStorage.putObject({
      storageKey: badStagingKey,
      bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]),
      contentType: "application/pdf",
    });

    await expect(
      AttachmentService.completeUpload(
        editor1.id,
        doc.id,
        badInit.attachment.id
      )
    ).rejects.toThrow(AttachmentValidationError);

    const failedRow = await prisma.attachment.findUniqueOrThrow({
      where: { id: badInit.attachment.id },
    });
    expect(failedRow.status).toBe("FAILED");
    expect(memoryStorage.hasKey(badStagingKey)).toBe(false);
    expect(
      memoryStorage
        .getKeys()
        .filter((k) =>
          k.startsWith(`workspaces/${workspace.id}/artifacts/${doc.id}/blobs/`)
        )
    ).toHaveLength(0);

    // Case B: Promotion failure does not mark attachment READY and allows clean retry
    const validInit = await AttachmentService.initiateUpload(
      editor1.id,
      doc.id,
      {
        fileName: "retryable-diagram.png",
        fileType: "image/png",
        fileSize: SAMPLE_PNG_BYTES.byteLength,
      }
    );
    const validStagingRow = await prisma.attachment.findUniqueOrThrow({
      where: { id: validInit.attachment.id },
    });

    await memoryStorage.putObject({
      storageKey: validStagingRow.storageKey,
      bytes: SAMPLE_PNG_BYTES,
      contentType: "image/png",
    });

    memoryStorage.setFailNextPromote(true);
    await expect(
      AttachmentService.completeUpload(
        editor1.id,
        doc.id,
        validInit.attachment.id
      )
    ).rejects.toThrow(StorageError);

    const afterFailedPromoRow = await prisma.attachment.findUniqueOrThrow({
      where: { id: validInit.attachment.id },
    });
    expect(afterFailedPromoRow.status).toBe("PENDING");
    expect(afterFailedPromoRow.storageKey).toBe(validStagingRow.storageKey);
    expect(memoryStorage.hasKey(validStagingRow.storageKey)).toBe(true);

    // Retry completeUpload after storage recovers -> succeeds and promotes to final key
    const recovered = await AttachmentService.completeUpload(
      editor1.id,
      doc.id,
      validInit.attachment.id
    );
    expect(recovered.status).toBe("READY");
    const recoveredRow = await prisma.attachment.findUniqueOrThrow({
      where: { id: validInit.attachment.id },
    });
    expect(isFinalStorageKey(recoveredRow.storageKey)).toBe(true);
    expect(memoryStorage.hasKey(validStagingRow.storageKey)).toBe(false);
    expect(memoryStorage.hasKey(recoveredRow.storageKey)).toBe(true);
  });

  it("10. Recovers or cleans up safely without orphaned final objects when database transition fails after promotion", async () => {
    const { editor1, workspace, doc } = await createTestWorkspaceFixture();

    // Part A: Database failure after promotion -> cleans up promoted final key, keeps attachment PENDING, and succeeds on retry
    const initRetry = await AttachmentService.initiateUpload(
      editor1.id,
      doc.id,
      {
        fileName: "db-retry-spec.pdf",
        fileType: "application/pdf",
        fileSize: SAMPLE_PDF_BYTES.byteLength,
      }
    );
    const retryPendingRow = await prisma.attachment.findUniqueOrThrow({
      where: { id: initRetry.attachment.id },
    });
    const retryStagingKey = retryPendingRow.storageKey;

    await memoryStorage.putObject({
      storageKey: retryStagingKey,
      bytes: SAMPLE_PDF_BYTES,
      contentType: "application/pdf",
    });

    AttachmentService.setFailNextCompleteTransactionForTests(true);
    await expect(
      AttachmentService.completeUpload(
        editor1.id,
        doc.id,
        initRetry.attachment.id
      )
    ).rejects.toThrow(/Simulated database failure after object promotion/i);

    const rowAfterDbFailure = await prisma.attachment.findUniqueOrThrow({
      where: { id: initRetry.attachment.id },
    });
    expect(rowAfterDbFailure.status).toBe("PENDING");
    expect(rowAfterDbFailure.storageKey).toBe(retryStagingKey);

    // No orphaned final 'blobs/' key may remain in storage after the rolled-back DB transaction
    const blobKeysAfterDbFail = memoryStorage
      .getKeys()
      .filter((k) =>
        k.startsWith(`workspaces/${workspace.id}/artifacts/${doc.id}/blobs/`)
      );
    expect(blobKeysAfterDbFail).toHaveLength(0);
    // Staging key was restored so completeUpload can be retried
    expect(memoryStorage.hasKey(retryStagingKey)).toBe(true);

    // Retry completeUpload -> succeeds and transitions to READY with a clean final key
    const completedOnRetry = await AttachmentService.completeUpload(
      editor1.id,
      doc.id,
      initRetry.attachment.id
    );
    expect(completedOnRetry.status).toBe("READY");
    const rowAfterRetry = await prisma.attachment.findUniqueOrThrow({
      where: { id: initRetry.attachment.id },
    });
    expect(isFinalStorageKey(rowAfterRetry.storageKey)).toBe(true);
    expect(memoryStorage.hasKey(retryStagingKey)).toBe(false);
    expect(memoryStorage.hasKey(rowAfterRetry.storageKey)).toBe(true);

    // Part B: Database failure after promotion -> stale pending upload cleanup removes staging object and DB row cleanly
    const initCleanup = await AttachmentService.initiateUpload(
      editor1.id,
      doc.id,
      {
        fileName: "abandoned-after-db-error.txt",
        fileType: "text/plain",
        fileSize: SAMPLE_TXT_BYTES.byteLength,
      }
    );
    const cleanupPendingRow = await prisma.attachment.findUniqueOrThrow({
      where: { id: initCleanup.attachment.id },
    });

    await memoryStorage.putObject({
      storageKey: cleanupPendingRow.storageKey,
      bytes: SAMPLE_TXT_BYTES,
      contentType: "text/plain",
    });

    AttachmentService.setFailNextCompleteTransactionForTests(true);
    await expect(
      AttachmentService.completeUpload(
        editor1.id,
        doc.id,
        initCleanup.attachment.id
      )
    ).rejects.toThrow(/Simulated database failure after object promotion/i);

    const cleanedCount = await AttachmentService.cleanupStalePendingUploadsForUser(
      editor1.id,
      new Date(Date.now() + 60_000)
    );
    expect(cleanedCount).toBe(1);
    expect(memoryStorage.hasKey(cleanupPendingRow.storageKey)).toBe(false);
    const deletedPendingRow = await prisma.attachment.findUnique({
      where: { id: initCleanup.attachment.id },
    });
    expect(deletedPendingRow).toBeNull();
  });

  it("11. Verifies SHA-256 digest on retrieval, blocks corrupted downloads with safe error, and quarantines the attachment from READY list", async () => {
    const { editor1, viewer, doc } = await createTestWorkspaceFixture();

    const uploaded = await AttachmentService.uploadAttachment(
      editor1.id,
      doc.id,
      {
        fileName: "financial-controls.pdf",
        fileType: "application/pdf",
        bytes: SAMPLE_PDF_BYTES,
      }
    );

    const readyRow = await prisma.attachment.findUniqueOrThrow({
      where: { id: uploaded.id },
    });
    expect(readyRow.status).toBe("READY");
    expect(readyRow.sha256).toBe(computeSha256Hex(SAMPLE_PDF_BYTES));

    // Simulate out-of-band storage corruption on the finalized object
    const corruptedBytes = new TextEncoder().encode(
      "%PDF-1.7\n1 0 obj\n<< /Corrupted true >>\nendobj\n%%EOF\n"
    );
    memoryStorage.corruptObjectBytesForTests(
      readyRow.storageKey,
      corruptedBytes
    );

    // Retrieval must verify checksum, block download, and never expose internal storageKey or paths
    let caughtError: unknown = null;
    try {
      await AttachmentService.getDownloadPayload(
        viewer.id,
        doc.id,
        uploaded.id
      );
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(AttachmentIntegrityError);
    const errorMessage = (caughtError as Error).message;
    expect(errorMessage).toMatch(/integrity|checksum/i);
    expect(errorMessage).not.toContain(readyRow.storageKey);
    expect(errorMessage).not.toContain("workspaces/");

    // Attachment must be transitioned to FAILED and removed from READY listings
    const quarantinedRow = await prisma.attachment.findUniqueOrThrow({
      where: { id: uploaded.id },
    });
    expect(quarantinedRow.status).toBe("FAILED");
    expect(quarantinedRow.failureReason).toMatch(/SHA-256 digest mismatch/i);
    expect(quarantinedRow.failureReason).not.toContain(readyRow.storageKey);

    const listAfterMismatch = await AttachmentService.listAttachments(
      viewer.id,
      doc.id
    );
    expect(listAfterMismatch.items).toHaveLength(0);

    // Server-side integrity audit event recorded
    const integrityEvent = await prisma.activityEvent.findFirst({
      where: {
        entityType: "ATTACHMENT",
        entityId: uploaded.id,
        action: "ATTACHMENT_INTEGRITY_FAILED",
      },
    });
    expect(integrityEvent).not.toBeNull();
  });

  it("12. Closes the staging-to-final TOCTOU race when staging object is overwritten after validation but before promotion completes", async () => {
    const { editor1, viewer, doc } = await createTestWorkspaceFixture();

    const initiated = await AttachmentService.initiateUpload(
      editor1.id,
      doc.id,
      {
        fileName: "toctou-protected-contract.pdf",
        fileType: "application/pdf",
        fileSize: SAMPLE_PDF_BYTES.byteLength,
      }
    );

    const pendingRow = await prisma.attachment.findUniqueOrThrow({
      where: { id: initiated.attachment.id },
    });
    const stagingKey = pendingRow.storageKey;

    // 1. Client uploads original valid PDF bytes to the staging key
    await memoryStorage.putObject({
      storageKey: stagingKey,
      bytes: SAMPLE_PDF_BYTES,
      contentType: "application/pdf",
    });

    // Prepare a second payload of the exact same length (or different bytes) to simulate a TOCTOU overwrite
    // via a still-valid presigned PUT URL after completeUpload() reads and validates the staging object
    // but before promoteObject() writes the final destination object.
    const toctouReplacementBytes = new TextEncoder().encode(
      "%PDF-1.7\n1 0 obj\n<< /Type /Tamperd >>\nendobj\n%%EOF\n"
    );
    expect(toctouReplacementBytes.byteLength).toBe(SAMPLE_PDF_BYTES.byteLength);
    expect(computeSha256Hex(toctouReplacementBytes)).not.toBe(
      computeSha256Hex(SAMPLE_PDF_BYTES)
    );

    let toctouOverwriteExecuted = false;
    memoryStorage.setBeforePromoteHookForTests(async ({ sourceKey, destinationKey }) => {
      expect(sourceKey).toBe(stagingKey);
      expect(memoryStorage.hasKey(destinationKey)).toBe(false);

      // Overwrite the staging object right after validation passed and before destinationKey is written
      await memoryStorage.putObject({
        storageKey: sourceKey,
        bytes: toctouReplacementBytes,
        contentType: "application/pdf",
      });
      toctouOverwriteExecuted = true;
    });

    // 2. Complete the upload while the TOCTOU hook overwrites the staging object mid-finalization
    const finalized = await AttachmentService.completeUpload(
      editor1.id,
      doc.id,
      initiated.attachment.id
    );

    expect(toctouOverwriteExecuted).toBe(true);
    expect(finalized.status).toBe("READY");
    expect(finalized.sha256).toBe(computeSha256Hex(SAMPLE_PDF_BYTES));

    // 3. Verify database metadata and underlying storage object at final key
    const readyRow = await prisma.attachment.findUniqueOrThrow({
      where: { id: initiated.attachment.id },
    });
    expect(readyRow.status).toBe("READY");
    expect(readyRow.storageKey).not.toBe(stagingKey);
    expect(readyRow.sha256).toBe(computeSha256Hex(SAMPLE_PDF_BYTES));
    expect(memoryStorage.hasKey(stagingKey)).toBe(false);

    const finalizedObjectBytes = await memoryStorage.getObjectBytes(
      readyRow.storageKey
    );
    expect(finalizedObjectBytes).not.toBeNull();
    expect(Buffer.from(finalizedObjectBytes!)).toEqual(
      Buffer.from(SAMPLE_PDF_BYTES)
    );
    expect(computeSha256Hex(finalizedObjectBytes!)).toBe(readyRow.sha256);

    // 4. Authorized download returns the exact validated bytes without integrity failure
    const downloaded = await AttachmentService.getDownloadPayload(
      viewer.id,
      doc.id,
      initiated.attachment.id
    );
    expect(Buffer.from(downloaded.bytes)).toEqual(Buffer.from(SAMPLE_PDF_BYTES));
    expect(computeSha256Hex(downloaded.bytes)).toBe(readyRow.sha256);
  });
});
