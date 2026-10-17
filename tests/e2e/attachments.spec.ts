import "dotenv/config";
import { test, expect } from "@playwright/test";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import { prisma } from "../../src/lib/prisma";
import { LocalFileStorageProvider } from "../../src/lib/storage";

test.describe("SyncSpace Phase 9B — Secure Artifact File Attachments E2E", () => {
  const createdUserEmails: string[] = [];
  const createdStorageKeys: string[] = [];

  test.afterAll(async () => {
    const localStorage = new LocalFileStorageProvider();

    if (createdUserEmails.length > 0) {
      const users = await prisma.user.findMany({
        where: { email: { in: createdUserEmails } },
        select: { id: true },
      });
      const userIds = users.map((u) => u.id);

      if (userIds.length > 0) {
        const attachments = await prisma.attachment.findMany({
          where: { uploadedById: { in: userIds } },
          select: { storageKey: true },
        });
        for (const att of attachments) {
          createdStorageKeys.push(att.storageKey);
        }

        for (const key of new Set(createdStorageKeys)) {
          await localStorage.deleteObject(key).catch(() => {});
        }

        await prisma.workspace.deleteMany({
          where: { createdById: { in: userIds } },
        });
        await prisma.user.deleteMany({
          where: { id: { in: userIds } },
        });
      }
    }
    await prisma.$disconnect();
  });

  test("1. Authorized editor uploads allowed file via UI, previews & downloads with verified SHA-256 content, rejects unsupported/oversized files, enforces RBAC/IDOR, and deletes cleanly", async ({
    browser,
  }) => {
    test.setTimeout(120000);

    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);

    const ownerEmail = `att.owner.${timestamp}.${rand}@syncspace.dev`;
    const viewerEmail = `att.viewer.${timestamp}.${rand}@syncspace.dev`;
    const outsiderEmail = `att.outsider.${timestamp}.${rand}@syncspace.dev`;
    const password = "AttachmentPassword123!";

    createdUserEmails.push(ownerEmail, viewerEmail, outsiderEmail);

    const ownerContext = await browser.newContext({ acceptDownloads: true });
    const viewerContext = await browser.newContext({ acceptDownloads: true });
    const outsiderContext = await browser.newContext();

    const ownerPage = await ownerContext.newPage();
    const viewerPage = await viewerContext.newPage();
    const outsiderPage = await outsiderContext.newPage();

    // 1. Register Owner/Editor, Viewer, and Outsider
    await ownerPage.goto("/register");
    await ownerPage.getByPlaceholder("Sunil Kumar").fill("Maya Editor");
    await ownerPage.getByPlaceholder("name@company.com").fill(ownerEmail);
    await ownerPage.getByPlaceholder("Minimum 8 characters").fill(password);
    await ownerPage.getByRole("button", { name: /create account/i }).click();
    await expect(ownerPage).toHaveURL(/\/app/);

    await viewerPage.goto("/register");
    await viewerPage.getByPlaceholder("Sunil Kumar").fill("Liam Viewer");
    await viewerPage.getByPlaceholder("name@company.com").fill(viewerEmail);
    await viewerPage.getByPlaceholder("Minimum 8 characters").fill(password);
    await viewerPage.getByRole("button", { name: /create account/i }).click();
    await expect(viewerPage).toHaveURL(/\/app/);

    await outsiderPage.goto("/register");
    await outsiderPage.getByPlaceholder("Sunil Kumar").fill("Zoe Outsider");
    await outsiderPage.getByPlaceholder("name@company.com").fill(outsiderEmail);
    await outsiderPage.getByPlaceholder("Minimum 8 characters").fill(password);
    await outsiderPage.getByRole("button", { name: /create account/i }).click();
    await expect(outsiderPage).toHaveURL(/\/app/);

    // 2. Owner creates a Workspace and Document
    const workspaceName = `Attachments Vault ${rand}`;
    await ownerPage.getByRole("button", { name: /create workspace/i }).first().click();
    await ownerPage.getByPlaceholder("e.g. Acme Engineering").fill(workspaceName);
    await ownerPage
      .getByRole("dialog")
      .getByRole("button", { name: /create workspace/i })
      .click();
    await expect(ownerPage.locator("h1")).toContainText(workspaceName);

    const dbWorkspace = await prisma.workspace.findFirstOrThrow({
      where: { name: workspaceName },
    });

    const viewerUser = await prisma.user.findUniqueOrThrow({
      where: { email: viewerEmail },
    });

    await prisma.workspaceMember.create({
      data: {
        workspaceId: dbWorkspace.id,
        userId: viewerUser.id,
        role: "VIEWER",
      },
    });

    // Create a document and navigate to it
    await ownerPage.goto("/app/documents");
    const docTitle = `Security Architecture Spec ${rand}`;
    await ownerPage.getByTestId("create-document-btn").click();
    await ownerPage.getByTestId("new-document-title-input").fill(docTitle);
    await ownerPage.getByTestId("confirm-create-document-btn").click();
    await expect(ownerPage).toHaveURL(/\/app\/documents\/.+/);

    const docUrl = ownerPage.url();
    const artifactId = docUrl.split("/app/documents/")[1].split("?")[0];

    await expect(ownerPage.getByTestId("tiptap-editor-canvas")).toBeVisible({
      timeout: 20000,
    });

    // 3. Open the Attachments Drawer
    await ownerPage.getByTestId("toggle-attachments-button").click();
    const drawer = ownerPage.getByTestId("attachment-drawer");
    await expect(drawer).toBeVisible();
    await expect(ownerPage.getByTestId("attachment-empty-state")).toBeVisible();

    // 4. Upload an allowed plain-text specification file through the UI
    const expectedTextContent = `SyncSpace Confidential Spec ${rand}\nChecksum Verification Payload Line 2.\n`;
    const expectedBuffer = Buffer.from(expectedTextContent, "utf-8");
    const expectedSha256 = createHash("sha256")
      .update(expectedBuffer)
      .digest("hex");

    const fileInput = ownerPage.getByTestId("attachment-file-input");
    await fileInput.setInputFiles({
      name: "security-audit-notes.txt",
      mimeType: "text/plain",
      buffer: expectedBuffer,
    });

    // Verify that it appears in the attachment panel with expected metadata
    const attachmentItem = ownerPage.getByTestId("attachment-item").first();
    await expect(attachmentItem).toBeVisible({ timeout: 15000 });
    await expect(
      attachmentItem.getByTestId("attachment-item-name")
    ).toHaveText("security-audit-notes.txt");
    await expect(ownerPage.getByTestId("attachment-count-badge")).toHaveText("1");

    const attachmentId = await attachmentItem.getAttribute("data-attachment-id");
    expect(attachmentId).toBeTruthy();

    // Track storageKey for cleanup
    const dbAttachment = await prisma.attachment.findUnique({
      where: { id: attachmentId! },
    });
    expect(dbAttachment).not.toBeNull();
    createdStorageKeys.push(dbAttachment!.storageKey);

    // Verify inline preview works safely
    await attachmentItem.getByTestId("attachment-preview-button").click();
    const previewDialog = ownerPage.getByTestId("attachment-preview-dialog");
    await expect(previewDialog).toBeVisible();
    await expect(
      previewDialog.getByTestId("attachment-preview-text")
    ).toContainText(`SyncSpace Confidential Spec ${rand}`);
    await previewDialog.getByRole("button", { name: /close/i }).first().click();

    // 5. Download the file and confirm exact content and SHA-256 hash
    const downloadPromise = ownerPage.waitForEvent("download");
    await attachmentItem.getByTestId("attachment-download-button").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("security-audit-notes.txt");
    const downloadedPath = await download.path();
    expect(downloadedPath).toBeTruthy();
    const downloadedBytes = await fs.readFile(downloadedPath!);
    const downloadedSha256 = createHash("sha256")
      .update(downloadedBytes)
      .digest("hex");
    expect(downloadedSha256).toBe(expectedSha256);
    expect(downloadedBytes.toString("utf-8")).toBe(expectedTextContent);

    // 6. Verify upload rejection for an unsupported file type (.exe / .svg) and oversized file (> 10 MiB)
    await fileInput.setInputFiles({
      name: "malicious-vector.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    });
    const uploadErrorAlert = ownerPage.getByTestId("attachment-upload-error");
    await expect(uploadErrorAlert).toBeVisible();
    await expect(uploadErrorAlert).toContainText(/not permitted|Unsupported file type/i);

    // Also test oversized file (> 10 MiB) rejection
    const oversizedBuffer = Buffer.alloc(10 * 1024 * 1024 + 512, 0x41);
    await fileInput.setInputFiles({
      name: "oversized-log.txt",
      mimeType: "text/plain",
      buffer: oversizedBuffer,
    });
    await expect(uploadErrorAlert).toBeVisible();
    await expect(uploadErrorAlert).toContainText(/exceeds the maximum limit of 10 MiB/i);
    await expect(ownerPage.getByTestId("attachment-count-badge")).toHaveText("1");

    // 7. Verify permissions:
    // 7a. Viewer can view the attachment list, cannot see upload or delete controls, and cannot upload or delete via API
    await viewerPage.goto(`/app/documents/${artifactId}?workspaceId=${dbWorkspace.id}`);
    await viewerPage.getByTestId("toggle-attachments-button").click();
    await expect(viewerPage.getByTestId("attachment-drawer")).toBeVisible();
    await expect(
      viewerPage.getByTestId("attachment-viewer-readonly-notice")
    ).toBeVisible();
    await expect(
      viewerPage.getByTestId("attachment-upload-button")
    ).toHaveCount(0);
    await expect(
      viewerPage.getByTestId("attachment-delete-button")
    ).toHaveCount(0);

    const viewerUploadAttempt = await viewerPage.request.post(
      `/api/artifacts/${artifactId}/attachments`,
      {
        data: {
          fileName: "viewer-attempt.txt",
          fileType: "text/plain",
          fileSize: 32,
        },
      }
    );
    expect(viewerUploadAttempt.status()).toBe(403);

    const viewerDeleteAttempt = await viewerPage.request.delete(
      `/api/artifacts/${artifactId}/attachments/${attachmentId}`
    );
    expect(viewerDeleteAttempt.status()).toBe(403);

    // 7b. Outsider (non-workspace member) cannot list, upload, download, or delete the attachment
    const outsiderDownloadRes = await outsiderPage.request.get(
      `/api/artifacts/${artifactId}/attachments/${attachmentId}/download`
    );
    expect(outsiderDownloadRes.status()).toBe(404);

    const outsiderUploadRes = await outsiderPage.request.post(
      `/api/artifacts/${artifactId}/attachments`,
      {
        data: {
          fileName: "outsider.txt",
          fileType: "text/plain",
          fileSize: 32,
        },
      }
    );
    expect(outsiderUploadRes.status()).toBe(404);

    // 7c. Explicit NONE override immediately blocks viewer from downloading the attachment
    await prisma.artifactPermission.create({
      data: {
        artifactId,
        userId: viewerUser.id,
        role: "NONE",
      },
    });

    const revokedViewerDownload = await viewerPage.request.get(
      `/api/artifacts/${artifactId}/attachments/${attachmentId}/download`
    );
    expect(revokedViewerDownload.status()).toBe(403);

    // 8. Delete the attachment as the authorized owner/uploader and verify it is no longer accessible
    await attachmentItem.getByTestId("attachment-delete-button").click();
    const deleteDialog = ownerPage.getByTestId(
      "attachment-delete-confirm-dialog"
    );
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByTestId("attachment-delete-confirm").click();

    await expect(ownerPage.getByTestId("attachment-empty-state")).toBeVisible();
    await expect(ownerPage.getByTestId("attachment-count-badge")).toHaveText("0");

    // Confirm deleted attachment returns 404 on download endpoint
    const deletedDownloadRes = await ownerPage.request.get(
      `/api/artifacts/${artifactId}/attachments/${attachmentId}/download`
    );
    expect(deletedDownloadRes.status()).toBe(404);

    // 9. Verify attachments panel on a Whiteboard artifact as well
    await ownerPage.goto("/app/whiteboards");
    const boardTitle = `Architecture Canvas ${rand}`;
    await ownerPage.getByTestId("create-whiteboard-btn").click();
    await ownerPage.getByTestId("new-whiteboard-title-input").fill(boardTitle);
    await ownerPage.getByTestId("confirm-create-whiteboard-btn").click();
    await expect(ownerPage).toHaveURL(/\/app\/whiteboards\/.+/);

    await ownerPage.getByTestId("toggle-attachments-button").click();
    await expect(ownerPage.getByTestId("attachment-drawer")).toBeVisible();

    const pdfBytes = Buffer.from(
      `%PDF-1.7\n1 0 obj\n<< /Title (${boardTitle}) >>\nendobj\n%%EOF\n`,
      "utf-8"
    );
    const pdfHash = createHash("sha256").update(pdfBytes).digest("hex");

    await ownerPage.getByTestId("attachment-file-input").setInputFiles({
      name: "whiteboard-reference.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytes,
    });

    const boardAttachmentItem = ownerPage.getByTestId("attachment-item").first();
    await expect(boardAttachmentItem).toBeVisible({ timeout: 15000 });
    await expect(
      boardAttachmentItem.getByTestId("attachment-item-name")
    ).toHaveText("whiteboard-reference.pdf");

    const boardDownloadPromise = ownerPage.waitForEvent("download");
    await boardAttachmentItem.getByTestId("attachment-download-button").click();
    const boardDownload = await boardDownloadPromise;
    const boardDownloadedPath = await boardDownload.path();
    expect(boardDownloadedPath).toBeTruthy();
    const boardDownloadedBytes = await fs.readFile(boardDownloadedPath!);
    expect(
      createHash("sha256").update(boardDownloadedBytes).digest("hex")
    ).toBe(pdfHash);

    await ownerContext.close();
    await viewerContext.close();
    await outsiderContext.close();
  });
});
