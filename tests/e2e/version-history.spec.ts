import "dotenv/config";
import { test, expect, Page } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { VersionService } from "../../src/services/version.service";

interface ExcalidrawElementSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function getActiveSceneElements(page: Page): Promise<ExcalidrawElementSnapshot[]> {
  const container = page.getByTestId("excalidraw-canvas-container");
  await expect(container).toBeAttached();
  const rawJson = await container.getAttribute("data-active-elements");
  if (!rawJson) return [];
  try {
    return JSON.parse(rawJson) as ExcalidrawElementSnapshot[];
  } catch {
    return [];
  }
}

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

  test("1. Document version history: checkpoints, preview immutability, safe restoration, collaborative sync across connected peers without refresh, and continuation", async ({
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

    // 4. Connect BOTH Owner and Collaborator to the document room BEFORE restore
    await collabPage.goto(docUrl);
    const ownerCanvas = ownerPage.getByTestId("tiptap-editor-canvas");
    const collabCanvas = collabPage.getByTestId("tiptap-editor-canvas");

    await expect(ownerCanvas).toBeVisible({ timeout: 20000 });
    await expect(collabCanvas).toBeVisible({ timeout: 20000 });

    await Promise.all([
      expect(ownerPage.getByTestId("room-connection-status")).toContainText("Connected & Synced", {
        timeout: 25000,
      }),
      expect(collabPage.getByTestId("room-connection-status")).toContainText("Connected & Synced", {
        timeout: 25000,
      }),
    ]);

    // Owner types initial content
    await ownerCanvas.click();
    await ownerPage.keyboard.type("Initial Version 1 Content for Consensus Protocol.");

    // Collaborator receives the initial content live via Yjs / Liveblocks
    await expect(collabCanvas).toContainText("Consensus Protocol", { timeout: 15000 });

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

    // Confirm preview did not mutate live editor canvas on either peer
    await expect(ownerCanvas).toContainText("Consensus Protocol");
    await expect(collabCanvas).toContainText("Consensus Protocol");

    await ownerPage.getByTestId("exit-preview-btn").click();
    await expect(ownerPage.getByTestId("version-preview-modal")).not.toBeVisible();

    // Close drawer to access the editor canvas
    await ownerPage.getByTestId("close-history-drawer-btn").click();
    await expect(ownerPage.getByTestId("version-history-drawer")).not.toBeVisible();

    // Overwrite the canvas with temporary edits before restoring
    await ownerCanvas.click();
    await ownerPage.keyboard.press("ControlOrMeta+A");
    await ownerPage.keyboard.type("Replaced content with temporary draft.");
    await expect(ownerCanvas).toContainText("Replaced content with temporary draft");
    await expect(collabCanvas).toContainText("Replaced content with temporary draft", { timeout: 15000 });

    // Reopen history drawer
    await ownerPage.getByTestId("toggle-history-button").click();
    await expect(ownerPage.getByTestId("version-history-drawer")).toBeVisible();

    // 6. Restore Version 2 (Milestone 1)
    await ownerPage.getByTestId("restore-version-2-btn").click();
    await ownerPage.getByTestId("confirm-restore-btn").click();

    // Check if conflict alert appears (due to debounced autosave changing currentRevision)
    const outcome1 = await Promise.race([
      ownerPage
        .getByTestId("restore-success-alert")
        .waitFor({ state: "visible", timeout: 8000 })
        .then(() => "success" as const),
      ownerPage
        .getByTestId("restore-conflict-alert")
        .waitFor({ state: "visible", timeout: 8000 })
        .then(() => "conflict" as const),
    ]).catch(() => "unknown");

    if (outcome1 === "conflict") {
      await ownerPage.getByTestId("refresh-conflict-btn").click();
      await expect(ownerPage.getByTestId("restore-conflict-alert")).not.toBeVisible();
      await ownerPage.getByTestId("confirm-restore-btn").click();
    }

    await expect(ownerPage.getByTestId("restore-success-alert")).toBeVisible({ timeout: 15000 });

    // 7. Verify Owner editor displays restored state
    await expect(ownerCanvas).toContainText("Consensus Protocol");

    // 8. Verify already-connected Collaborator receives restored state WITHOUT refreshing page
    await expect(collabCanvas).toContainText("Consensus Protocol", { timeout: 15000 });

    // 9. Subsequent edits: Elena types more text, Carlos sees it live
    await ownerPage.getByTestId("close-history-drawer-btn").click();
    await ownerCanvas.click();
    await ownerPage.keyboard.type(" Live collaboration continuing after restore.");
    await expect(ownerCanvas).toContainText("Live collaboration continuing after restore");
    await expect(collabCanvas).toContainText("Live collaboration continuing after restore", { timeout: 15000 });

    // Re-open history drawer and verify monotonic history continuation
    await ownerPage.getByTestId("toggle-history-button").click();
    await expect(ownerPage.getByTestId("version-item-3")).toBeVisible();

    await ownerContext.close();
    await collabContext.close();
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

    // Create a baseline version
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

    await ownerContext.close();
    await viewerContext.close();
  });

  test("3. Whiteboard version history: checkpoints, preview immutability, safe restoration, collaborative sync across connected peers without refresh, and continuation", async ({
    browser,
  }) => {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);

    const ownerEmail = `vh.wb.owner.${timestamp}.${rand}@syncspace.dev`;
    const collabEmail = `vh.wb.collab.${timestamp}.${rand}@syncspace.dev`;
    const password = "BoardPassword123!";

    createdUserEmails.push(ownerEmail, collabEmail);

    const ownerContext = await browser.newContext();
    const collabContext = await browser.newContext();

    const ownerPage = await ownerContext.newPage();
    const collabPage = await collabContext.newPage();

    ownerPage.on("pageerror", (err) => console.log("OWNER PAGE ERROR:", err.message, "\nSTACK:", err.stack));
    collabPage.on("pageerror", (err) => console.log("COLLAB PAGE ERROR:", err.message, "\nSTACK:", err.stack));
    ownerPage.on("response", (res) => {
      if (res.status() >= 400) {
        console.log("OWNER HTTP ERROR:", res.status(), res.url());
      }
    });
    ownerPage.on("console", (msg) => {
      const txt = msg.text();
      if (
        txt.includes("DEBUG EVAL") ||
        txt.includes("CANVAS") ||
        txt.includes("EXCALIDRAW") ||
        msg.type() === "error"
      ) {
        console.log("OWNER CONSOLE:", txt);
      }
    });
    collabPage.on("console", (msg) => {
      const txt = msg.text();
      if (
        txt.includes("DEBUG EVAL") ||
        txt.includes("CANVAS") ||
        txt.includes("EXCALIDRAW") ||
        msg.type() === "error"
      ) {
        console.log("COLLAB CONSOLE:", txt);
      }
    });

    // 1. Register Owner
    await ownerPage.goto("/register");
    await ownerPage.getByPlaceholder("Sunil Kumar").fill("Diana Lead");
    await ownerPage.getByPlaceholder("name@company.com").fill(ownerEmail);
    await ownerPage.getByPlaceholder("Minimum 8 characters").fill(password);
    await ownerPage.getByRole("button", { name: /create account/i }).click();
    await expect(ownerPage).toHaveURL(/\/app/);

    // Register Collaborator
    await collabPage.goto("/register");
    await collabPage.getByPlaceholder("Sunil Kumar").fill("Evan Collaborator");
    await collabPage.getByPlaceholder("name@company.com").fill(collabEmail);
    await collabPage.getByPlaceholder("Minimum 8 characters").fill(password);
    await collabPage.getByRole("button", { name: /create account/i }).click();
    await expect(collabPage).toHaveURL(/\/app/);

    // 2. Owner creates Workspace
    const wsName = `Whiteboard History Studio ${rand}`;
    await ownerPage.getByRole("button", { name: /create workspace/i }).first().click();
    await ownerPage.getByPlaceholder("e.g. Acme Engineering").fill(wsName);
    await ownerPage.getByRole("dialog").getByRole("button", { name: /create workspace/i }).click();
    await expect(ownerPage.locator("h1")).toContainText(wsName);

    const dbWorkspace = await prisma.workspace.findFirst({
      where: { name: wsName },
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

    // 3. Owner creates Whiteboard
    await ownerPage.goto("/app/whiteboards");
    const boardTitle = `System Architecture Topology ${rand}`;
    await ownerPage.getByTestId("create-whiteboard-btn").click();
    await ownerPage.getByTestId("new-whiteboard-title-input").fill(boardTitle);
    await ownerPage.getByTestId("confirm-create-whiteboard-btn").click();

    await expect(ownerPage).toHaveURL(/\/app\/whiteboards\/.+/);
    const boardUrl = ownerPage.url();

    const dbBoard = await prisma.artifact.findFirst({
      where: { workspaceId: dbWorkspace!.id, title: boardTitle },
    });
    expect(dbBoard).not.toBeNull();

    // 4. Connect BOTH Owner and Collaborator to Whiteboard room BEFORE restore
    await collabPage.goto(boardUrl);

    await Promise.all([
      expect(ownerPage.getByTestId("excalidraw-canvas-container")).toBeVisible({ timeout: 25000 }),
      expect(collabPage.getByTestId("excalidraw-canvas-container")).toBeVisible({ timeout: 25000 }),
    ]);

    await Promise.all([
      expect(ownerPage.getByTestId("room-connection-status")).toContainText("Connected & Synced", {
        timeout: 25000,
      }),
      expect(collabPage.getByTestId("room-connection-status")).toContainText("Connected & Synced", {
        timeout: 25000,
      }),
    ]);

    await Promise.all([
      expect(
        ownerPage
          .getByTestId("collaborator-avatars")
          .locator("[data-testid^='collaborator-remote-']")
      ).toHaveCount(1, { timeout: 20000 }),
      expect(
        collabPage
          .getByTestId("collaborator-avatars")
          .locator("[data-testid^='collaborator-remote-']")
      ).toHaveCount(1, { timeout: 20000 }),
    ]);

    // 5. Draw Milestone 1 element (rectangle) and create Checkpoint 1
    await ownerPage.locator("[data-testid='toolbar-rectangle']").click({ force: true });
    const canvasOwner = ownerPage.locator("canvas.interactive");
    await expect(canvasOwner).toBeVisible({ timeout: 15000 });
    const box = (await canvasOwner.boundingBox())!;
    const startX = box.x + Math.floor(box.width * 0.3);
    const startY = box.y + Math.floor(box.height * 0.3);
    await ownerPage.mouse.move(startX, startY);
    await ownerPage.mouse.down();
    await ownerPage.mouse.move(startX + 140, startY + 90, { steps: 10 });
    await ownerPage.mouse.up();

    await expect(ownerPage.getByTestId("whiteboard-save-status")).toContainText("Saved", {
      timeout: 15000,
    });

    // Verify Owner has 1 active element
    await expect
      .poll(async () => (await getActiveSceneElements(ownerPage)).length, { timeout: 25000 })
      .toBe(1);

    // Verify Collaborator receives Milestone 1 element via live sync
    await expect
      .poll(async () => (await getActiveSceneElements(collabPage)).length, { timeout: 25000 })
      .toBe(1);

    const m1OwnerElements = await getActiveSceneElements(ownerPage);
    const m1CollabElements = await getActiveSceneElements(collabPage);
    expect(m1OwnerElements[0].type).toBe("rectangle");
    expect(m1CollabElements[0].id).toBe(m1OwnerElements[0].id);
    expect(m1CollabElements[0].type).toBe("rectangle");

    // Owner creates Checkpoint 1: Milestone 1
    await ownerPage.getByTestId("toggle-history-button").click();
    await expect(ownerPage.getByTestId("version-history-drawer")).toBeVisible();

    await ownerPage.getByTestId("create-checkpoint-btn").click();
    await ownerPage.getByTestId("checkpoint-title-input").fill("Milestone 1");
    await ownerPage.getByTestId("checkpoint-summary-input").fill("Initial topology layout");
    await ownerPage.getByTestId("submit-checkpoint-btn").click();

    await expect(ownerPage.getByTestId("version-item-1")).toBeVisible();

    // Close drawer to interact with canvas
    await ownerPage.getByTestId("close-history-drawer-btn").click();
    await expect(ownerPage.getByTestId("version-history-drawer")).not.toBeVisible();

    // Owner draws a second element (arrow) for Milestone 2
    await ownerPage.locator("[data-testid='toolbar-arrow']").click({ force: true });
    const startX2 = box.x + Math.floor(box.width * 0.55);
    const startY2 = box.y + Math.floor(box.height * 0.35);
    await ownerPage.mouse.move(startX2, startY2);
    await ownerPage.mouse.down();
    await ownerPage.mouse.move(startX2 + 100, startY2 + 60, { steps: 5 });
    await ownerPage.mouse.up();

    await expect(ownerPage.getByTestId("whiteboard-save-status")).toContainText("Saved", {
      timeout: 15000,
    });

    // Verify Owner has 2 active elements
    await expect
      .poll(async () => (await getActiveSceneElements(ownerPage)).length, { timeout: 15000 })
      .toBe(2);

    // Verify Collaborator receives second element via live sync
    await expect
      .poll(async () => (await getActiveSceneElements(collabPage)).length, { timeout: 15000 })
      .toBe(2);

    const m2OwnerElements = await getActiveSceneElements(ownerPage);
    const m2CollabElements = await getActiveSceneElements(collabPage);
    const displacedElement = m2OwnerElements.find((e) => e.id !== m1OwnerElements[0].id)!;
    expect(displacedElement).toBeDefined();
    expect(m2CollabElements.some((e) => e.id === displacedElement.id)).toBe(true);

    // Owner creates Checkpoint 2: Milestone 2
    await ownerPage.getByTestId("toggle-history-button").click();
    await expect(ownerPage.getByTestId("version-history-drawer")).toBeVisible();

    await ownerPage.getByTestId("create-checkpoint-btn").click();
    await ownerPage.getByTestId("checkpoint-title-input").fill("Milestone 2");
    await ownerPage.getByTestId("checkpoint-summary-input").fill("Added gateway connection");
    await ownerPage.getByTestId("submit-checkpoint-btn").click();

    await expect(ownerPage.getByTestId("version-item-2")).toBeVisible();

    // 6. Preview Version 1 (Read-Only)
    await ownerPage.getByTestId("preview-version-1-btn").click();
    await expect(ownerPage.getByTestId("version-preview-modal")).toBeVisible();
    await expect(ownerPage.getByText("Read-Only")).toBeVisible();
    await expect(ownerPage.getByText("Canvas Scene Metadata")).toBeVisible();

    // Confirm preview did not mutate live canvas for either peer (both still have 2 elements)
    const ownerPreviewActive = await getActiveSceneElements(ownerPage);
    const collabPreviewActive = await getActiveSceneElements(collabPage);
    expect(ownerPreviewActive.length).toBe(2);
    expect(collabPreviewActive.length).toBe(2);
    expect(ownerPreviewActive.some((e) => e.id === displacedElement.id)).toBe(true);
    expect(collabPreviewActive.some((e) => e.id === displacedElement.id)).toBe(true);

    await ownerPage.getByTestId("exit-preview-btn").click();
    await expect(ownerPage.getByTestId("version-preview-modal")).not.toBeVisible();

    // 7. Restore Version 1
    await ownerPage.getByTestId("restore-version-1-btn").click();
    await ownerPage.getByTestId("confirm-restore-btn").click();

    const outcome3 = await Promise.race([
      ownerPage
        .getByTestId("restore-success-alert")
        .waitFor({ state: "visible", timeout: 8000 })
        .then(() => "success" as const),
      ownerPage
        .getByTestId("restore-conflict-alert")
        .waitFor({ state: "visible", timeout: 8000 })
        .then(() => "conflict" as const),
    ]).catch(() => "unknown");

    if (outcome3 === "conflict") {
      await ownerPage.getByTestId("refresh-conflict-btn").click();
      await expect(ownerPage.getByTestId("restore-conflict-alert")).not.toBeVisible();
      await ownerPage.getByTestId("confirm-restore-btn").click();
    }

    await expect(ownerPage.getByTestId("restore-success-alert")).toBeVisible({ timeout: 15000 });

    // 8. Verify Owner editor displays restored Milestone 1 (displaced element absent)
    await expect
      .poll(async () => (await getActiveSceneElements(ownerPage)).length, { timeout: 25000 })
      .toBe(1);

    const restoredOwnerElements = await getActiveSceneElements(ownerPage);
    expect(restoredOwnerElements[0].id).toBe(m1OwnerElements[0].id);
    expect(restoredOwnerElements[0].type).toBe("rectangle");
    expect(restoredOwnerElements.some((e) => e.id === displacedElement.id)).toBe(false);

    // 9. Collaborator receives restored scene WITHOUT PAGE RELOAD
    await expect
      .poll(async () => (await getActiveSceneElements(collabPage)).length, { timeout: 25000 })
      .toBe(1);

    const restoredCollabElements = await getActiveSceneElements(collabPage);
    expect(restoredCollabElements[0].id).toBe(m1OwnerElements[0].id);
    expect(restoredCollabElements[0].type).toBe("rectangle");
    expect(restoredCollabElements.some((e) => e.id === displacedElement.id)).toBe(false);

    await expect(collabPage.getByTestId("room-connection-status")).toContainText(
      "Connected & Synced",
      { timeout: 15000 }
    );

    // 10. Subsequent edits: Collaborator draws an element post-restore, both see live continuation
    await ownerPage.getByTestId("close-history-drawer-btn").click();
    await expect(ownerPage.getByTestId("version-history-drawer")).not.toBeVisible();

    await collabPage.locator("[data-testid='toolbar-rectangle']").click({ force: true });
    const canvasCollab = collabPage.locator("canvas.interactive");
    await expect(canvasCollab).toBeVisible({ timeout: 15000 });
    const boxCollab = (await canvasCollab.boundingBox())!;
    const startXC = boxCollab.x + Math.floor(boxCollab.width * 0.6);
    const startYC = boxCollab.y + Math.floor(boxCollab.height * 0.5);
    await collabPage.mouse.move(startXC, startYC);
    await collabPage.mouse.down();
    await collabPage.mouse.move(startXC + 80, startYC + 50, { steps: 5 });
    await collabPage.mouse.up();

    await expect
      .poll(async () => (await getActiveSceneElements(collabPage)).length, { timeout: 25000 })
      .toBe(2);
    await expect
      .poll(async () => (await getActiveSceneElements(ownerPage)).length, { timeout: 25000 })
      .toBe(2);

    // Reopen history drawer and verify monotonic history continuation (version 3 exists)
    await ownerPage.getByTestId("toggle-history-button").click();
    await expect(ownerPage.getByTestId("version-item-3")).toBeVisible();

    await ownerContext.close();
    await collabContext.close();
  });
});
