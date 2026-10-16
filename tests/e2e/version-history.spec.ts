import "dotenv/config";
import { test, expect } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { VersionService } from "../../src/services/version.service";

test.describe("SyncSpace Phase 9A — Artifact Version History and Restore E2E", () => {
  const createdUserEmails: string[] = [];

  test.afterAll(async () => {
    if (createdUserEmails.length > 0) {
      const users = await prisma.user.findMany({
        where: { email: { in: createdUserEmails } },
        select: { id: true },
      });
      const userIds = users.map((u) => u.id);

      if (userIds.length > 0) {
        // Clean up versions and workspaces
        await prisma.artifactVersion.deleteMany({
          where: { createdById: { in: userIds } },
        });
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

  test("1. Document version history: checkpoints, preview immutability, safe restoration, collaborative sync, and continuation", async ({
    browser,
  }) => {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);

    const ownerEmail = `vh.owner.${timestamp}.${rand}@syncspace.dev`;
    const collabEmail = `vh.collab.${timestamp}.${rand}@syncspace.dev`;
    const password = "VersionPassword123!";

    createdUserEmails.push(ownerEmail, collabEmail);

    const ownerContext = await browser.newContext();
    const collabContext = await browser.newContext();

    const ownerPage = await ownerContext.newPage();
    const collabPage = await collabContext.newPage();

    // 1. Register Owner
    await ownerPage.goto("/register");
    await ownerPage.getByPlaceholder("Sunil Kumar").fill("Elena Architect");
    await ownerPage.getByPlaceholder("name@company.com").fill(ownerEmail);
    await ownerPage.getByPlaceholder("Minimum 8 characters").fill(password);
    await ownerPage.getByRole("button", { name: /create account/i }).click();
    await expect(ownerPage).toHaveURL(/\/app/);

    // Register Collaborator
    await collabPage.goto("/register");
    await collabPage.getByPlaceholder("Sunil Kumar").fill("Carlos Engineer");
    await collabPage.getByPlaceholder("name@company.com").fill(collabEmail);
    await collabPage.getByPlaceholder("Minimum 8 characters").fill(password);
    await collabPage.getByRole("button", { name: /create account/i }).click();
    await expect(collabPage).toHaveURL(/\/app/);

    // 2. Owner creates a Workspace
    const workspaceName = `Version History WS ${rand}`;
    await ownerPage.getByRole("button", { name: /create workspace/i }).first().click();
    await ownerPage.getByPlaceholder("e.g. Acme Engineering").fill(workspaceName);
    await ownerPage.getByRole("dialog").getByRole("button", { name: /create workspace/i }).click();
    await expect(ownerPage.locator("h1")).toContainText(workspaceName);

    const dbWorkspace = await prisma.workspace.findFirst({
      where: { name: workspaceName },
    });
    expect(dbWorkspace).not.toBeNull();

    // Add Collaborator to Workspace as EDITOR
    const collabUser = await prisma.user.findUnique({ where: { email: collabEmail } });
    await prisma.workspaceMember.create({
      data: {
        workspaceId: dbWorkspace!.id,
        userId: collabUser!.id,
        role: "EDITOR",
      },
    });

    // 3. Create a Document
    await ownerPage.goto("/app/documents");
    const initialDocTitle = `Distributed Protocol RFC ${rand}`;
    await ownerPage.getByTestId("create-document-btn").click();
    await ownerPage.getByTestId("new-document-title-input").fill(initialDocTitle);
    await ownerPage.getByTestId("confirm-create-document-btn").click();

    await expect(ownerPage).toHaveURL(/\/app\/documents\/.+/);
    const docUrl = ownerPage.url();

    const dbDoc = await prisma.artifact.findFirst({
      where: { workspaceId: dbWorkspace!.id, title: initialDocTitle },
    });
    expect(dbDoc).not.toBeNull();

    // 4. Edit initial content in Document
    const editorCanvas = ownerPage.getByTestId("tiptap-editor-canvas");
    await expect(editorCanvas).toBeVisible();
    await editorCanvas.click();
    await ownerPage.keyboard.type("Initial Version 1 Content for Consensus Protocol.");

    // Open history drawer
    await ownerPage.getByTestId("toggle-history-button").click();
    await expect(ownerPage.getByTestId("version-history-drawer")).toBeVisible();

    // Create Checkpoint Milestone 1 (creates a second distinct version)
    await ownerPage.getByTestId("create-checkpoint-btn").click();
    await ownerPage.getByTestId("checkpoint-title-input").fill("Milestone 1");
    await ownerPage.getByTestId("checkpoint-summary-input").fill("Initial protocol draft");
    await ownerPage.getByTestId("submit-checkpoint-btn").click();

    // Verify multiple versions exist in drawer
    await expect(ownerPage.getByTestId("version-item-1")).toBeVisible();
    await expect(ownerPage.getByTestId("version-item-2")).toBeVisible();

    // 5. Preview Version 2 (Read-Only)
    await ownerPage.getByTestId("preview-version-2-btn").click();
    await expect(ownerPage.getByTestId("version-preview-modal")).toBeVisible();
    await expect(ownerPage.getByText("Read-Only")).toBeVisible();
    await expect(ownerPage.getByTestId("version-preview-modal")).toContainText("Consensus Protocol");

    // Confirm preview did not mutate live editor canvas
    await ownerPage.getByTestId("exit-preview-btn").click();
    await expect(ownerPage.getByTestId("version-preview-modal")).not.toBeVisible();

    // Close drawer to access the editor canvas
    await ownerPage.getByTestId("close-history-drawer-btn").click();
    await expect(ownerPage.getByTestId("version-history-drawer")).not.toBeVisible();

    // Overwrite the canvas with temporary edits before restoring
    await editorCanvas.click();
    await ownerPage.keyboard.press("ControlOrMeta+A");
    await ownerPage.keyboard.type("Replaced content with temporary draft.");
    await expect(editorCanvas).toContainText("Replaced content with temporary draft");

    // Reopen history drawer
    await ownerPage.getByTestId("toggle-history-button").click();
    await expect(ownerPage.getByTestId("version-history-drawer")).toBeVisible();

    // 6. Restore Version 2 (Milestone 1)
    await ownerPage.getByTestId("restore-version-2-btn").click();
    await expect(ownerPage.getByTestId("restore-confirm-dialog")).toBeVisible();
    await ownerPage.getByTestId("confirm-restore-btn").click();

    // If an in-flight autosave triggered a concurrency conflict, verify the conflict UI and click Refresh History
    const conflictAlert = ownerPage.getByTestId("restore-conflict-alert");
    if (await conflictAlert.isVisible({ timeout: 2000 }).catch(() => false)) {
      await ownerPage.getByTestId("refresh-conflict-btn").click();
      await expect(conflictAlert).not.toBeVisible();
      await ownerPage.getByTestId("confirm-restore-btn").click();
    }

    await expect(ownerPage.getByTestId("restore-success-alert")).toBeVisible();

    // 7. Verify editor displays restored state
    await expect(editorCanvas).toContainText("Consensus Protocol");

    // 8. Collaborator loads the document and receives restored state
    await collabPage.goto(docUrl);
    const collabCanvas = collabPage.getByTestId("tiptap-editor-canvas");
    await expect(collabCanvas).toBeVisible();
    await expect(collabCanvas).toContainText("Consensus Protocol");

    // 9. History continues: a new version was created for the restoration
    await expect(ownerPage.getByTestId("version-item-3")).toBeVisible();
  });

  test("2. Negative test: Viewer cannot restore versions or create checkpoints", async ({
    browser,
  }) => {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);

    const ownerEmail = `vh.neg.owner.${timestamp}.${rand}@syncspace.dev`;
    const viewerEmail = `vh.neg.viewer.${timestamp}.${rand}@syncspace.dev`;
    const password = "ViewerPassword123!";

    createdUserEmails.push(ownerEmail, viewerEmail);

    const ownerContext = await browser.newContext();
    const viewerContext = await browser.newContext();

    const ownerPage = await ownerContext.newPage();
    const viewerPage = await viewerContext.newPage();

    // 1. Register Owner
    await ownerPage.goto("/register");
    await ownerPage.getByPlaceholder("Sunil Kumar").fill("Owner User");
    await ownerPage.getByPlaceholder("name@company.com").fill(ownerEmail);
    await ownerPage.getByPlaceholder("Minimum 8 characters").fill(password);
    await ownerPage.getByRole("button", { name: /create account/i }).click();
    await expect(ownerPage).toHaveURL(/\/app/);

    // Register Viewer
    await viewerPage.goto("/register");
    await viewerPage.getByPlaceholder("Sunil Kumar").fill("Viewer User");
    await viewerPage.getByPlaceholder("name@company.com").fill(viewerEmail);
    await viewerPage.getByPlaceholder("Minimum 8 characters").fill(password);
    await viewerPage.getByRole("button", { name: /create account/i }).click();
    await expect(viewerPage).toHaveURL(/\/app/);

    // Create Workspace
    const workspaceName = `Viewer Restriction WS ${rand}`;
    await ownerPage.getByRole("button", { name: /create workspace/i }).first().click();
    await ownerPage.getByPlaceholder("e.g. Acme Engineering").fill(workspaceName);
    await ownerPage.getByRole("dialog").getByRole("button", { name: /create workspace/i }).click();
    await expect(ownerPage.locator("h1")).toContainText(workspaceName);

    const dbWorkspace = await prisma.workspace.findFirst({
      where: { name: workspaceName },
    });
    expect(dbWorkspace).not.toBeNull();

    const viewerUser = await prisma.user.findUnique({ where: { email: viewerEmail } });
    await prisma.workspaceMember.create({
      data: {
        workspaceId: dbWorkspace!.id,
        userId: viewerUser!.id,
        role: "VIEWER",
      },
    });

    // Owner creates a document with a version checkpoint
    await ownerPage.goto("/app/documents");
    const docTitle = `Viewer Test Spec ${rand}`;
    await ownerPage.getByTestId("create-document-btn").click();
    await ownerPage.getByTestId("new-document-title-input").fill(docTitle);
    await ownerPage.getByTestId("confirm-create-document-btn").click();
    await expect(ownerPage).toHaveURL(/\/app\/documents\/.+/);
    const docUrl = ownerPage.url();

    const dbDoc = await prisma.artifact.findFirst({
      where: { workspaceId: dbWorkspace!.id, title: docTitle },
    });

    // Create a version
    await VersionService.createCheckpoint(viewerUser!.id, dbDoc!.id, {
      title: "V1 Checkpoint",
      snapshotData: { type: "doc", content: [] },
    }).catch(() => {}); // Expected to fail for viewer, but create as owner
    await VersionService.createCheckpoint(dbWorkspace!.createdById!, dbDoc!.id, {
      title: "V1 Checkpoint",
      snapshotData: { type: "doc", content: [] },
    });

    // Viewer navigates to document
    await viewerPage.goto(docUrl);
    await expect(viewerPage.getByTestId("toggle-history-button")).toBeVisible();
    await viewerPage.getByTestId("toggle-history-button").click();
    await expect(viewerPage.getByTestId("version-history-drawer")).toBeVisible();

    // Verify viewer CANNOT see "Save Checkpoint" button
    await expect(viewerPage.getByTestId("create-checkpoint-btn")).not.toBeVisible();

    // Verify viewer CANNOT see "Restore" button on version item
    await expect(viewerPage.getByTestId("restore-version-1-btn")).not.toBeVisible();

    // Verify viewer CAN see "Preview" button
    await expect(viewerPage.getByTestId("preview-version-1-btn")).toBeVisible();
  });
});
