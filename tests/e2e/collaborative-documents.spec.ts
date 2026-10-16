import "dotenv/config";
import { test, expect } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { isLiveblocksSecretKeyConfigured } from "../../src/services/liveblocks-auth.service";

const LIVEBLOCKS_CLOUD_READY = isLiveblocksSecretKeyConfigured();

test.describe("SyncSpace Phase 5 — Collaborative Rich-Text Document Editor & Room Security E2E", () => {
  const createdUserEmails: string[] = [];

  test.afterAll(async () => {
    if (createdUserEmails.length > 0) {
      const users = await prisma.user.findMany({
        where: { email: { in: createdUserEmails } },
        select: { id: true },
      });
      const userIds = users.map((u) => u.id);

      if (userIds.length > 0) {
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

  test("1. Document creation, Tiptap rich-text formatting, slash commands, outline, safe links, title & snapshot persistence, /api/liveblocks-auth security, and VIEWER / ArtifactPermission overrides", async ({
    browser,
  }) => {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);

    const ownerEmail = `doc.owner.${timestamp}.${rand}@syncspace.dev`;
    const viewerEmail = `doc.viewer.${timestamp}.${rand}@syncspace.dev`;
    const outsiderEmail = `doc.outsider.${timestamp}.${rand}@syncspace.dev`;
    const password = "DocPassword123!";

    createdUserEmails.push(ownerEmail, viewerEmail, outsiderEmail);

    const ownerContext = await browser.newContext();
    const viewerContext = await browser.newContext();
    const outsiderContext = await browser.newContext();
    const unauthContext = await browser.newContext();

    const ownerPage = await ownerContext.newPage();
    const viewerPage = await viewerContext.newPage();
    const outsiderPage = await outsiderContext.newPage();
    const unauthPage = await unauthContext.newPage();

    // 1. Register Owner, Viewer, and Outsider
    await ownerPage.goto("/register");
    await ownerPage.getByPlaceholder("Sunil Kumar").fill("Elena Architect");
    await ownerPage.getByPlaceholder("name@company.com").fill(ownerEmail);
    await ownerPage.getByPlaceholder("Minimum 8 characters").fill(password);
    await ownerPage.getByRole("button", { name: /create account/i }).click();
    await expect(ownerPage).toHaveURL(/\/app/);

    await viewerPage.goto("/register");
    await viewerPage.getByPlaceholder("Sunil Kumar").fill("Victor Reviewer");
    await viewerPage.getByPlaceholder("name@company.com").fill(viewerEmail);
    await viewerPage.getByPlaceholder("Minimum 8 characters").fill(password);
    await viewerPage.getByRole("button", { name: /create account/i }).click();
    await expect(viewerPage).toHaveURL(/\/app/);

    await outsiderPage.goto("/register");
    await outsiderPage.getByPlaceholder("Sunil Kumar").fill("Oscar Outsider");
    await outsiderPage.getByPlaceholder("name@company.com").fill(outsiderEmail);
    await outsiderPage.getByPlaceholder("Minimum 8 characters").fill(password);
    await outsiderPage.getByRole("button", { name: /create account/i }).click();
    await expect(outsiderPage).toHaveURL(/\/app/);

    // 2. Owner creates a Workspace
    const workspaceName = `Spec Engineering ${rand}`;
    await ownerPage
      .getByRole("button", { name: /create workspace/i })
      .first()
      .click();
    await ownerPage
      .getByPlaceholder("e.g. Acme Engineering")
      .fill(workspaceName);
    await ownerPage
      .getByRole("dialog")
      .getByRole("button", { name: /create workspace/i })
      .click();
    await expect(ownerPage.locator("h1")).toContainText(workspaceName);

    const dbWorkspace = await prisma.workspace.findFirst({
      where: { name: workspaceName },
    });
    expect(dbWorkspace).not.toBeNull();

    // 3. Navigate to /app/documents and create a new collaborative document
    await ownerPage.goto("/app/documents");
    await expect(ownerPage.locator("h1")).toContainText("Documents");

    const initialDocTitle = `RFC-2026 Consensus Protocol ${rand}`;
    await ownerPage.getByTestId("create-document-btn").click();
    await ownerPage.getByTestId("new-document-title-input").fill(initialDocTitle);
    await ownerPage.getByTestId("confirm-create-document-btn").click();

    await expect(ownerPage).toHaveURL(/\/app\/documents\/.+/);
    await expect(ownerPage.getByTestId("document-title-heading")).toHaveText(
      initialDocTitle
    );

    const dbDoc = await prisma.artifact.findFirst({
      where: { workspaceId: dbWorkspace!.id, title: initialDocTitle },
    });
    expect(dbDoc).not.toBeNull();
    expect(dbDoc?.type).toBe("DOCUMENT");
    expect(dbDoc?.liveblocksRoomId).toMatch(/^art_/);

    // Verify room badge and collaborator avatar are visible
    await expect(ownerPage.getByTestId("room-connection-status")).toContainText(
      `Room: ${dbDoc!.liveblocksRoomId}`
    );
    await expect(ownerPage.getByTestId("collaborator-self-avatar")).toBeVisible();

    if (!LIVEBLOCKS_CLOUD_READY) {
      await expect(
        ownerPage.getByTestId("liveblocks-credential-banner")
      ).toBeVisible();
    }

    // 4. Rename the document title inline and verify PostgreSQL persistence
    const updatedDocTitle = `RFC-2026 Distributed Yjs Engine ${rand}`;
    await ownerPage.getByTestId("document-title-heading").click();
    await ownerPage.getByTestId("document-title-input").fill(updatedDocTitle);
    await ownerPage.getByTestId("document-title-save").click();

    await expect(ownerPage.getByTestId("document-title-heading")).toHaveText(
      updatedDocTitle
    );

    await expect
      .poll(async () => {
        const refreshed = await prisma.artifact.findUnique({
          where: { id: dbDoc!.id },
        });
        return refreshed?.title;
      })
      .toBe(updatedDocTitle);

    // 5. Rich-Text Editing: headings, formatting, slash command menu, safe link validation, and table
    const editorCanvas = ownerPage.getByTestId("tiptap-editor-canvas");
    await expect(editorCanvas).toBeVisible();
    await editorCanvas.click();

    // Insert a Heading 1 via Toolbar and type heading text
    await ownerPage.getByTestId("toolbar-h1").click();
    await editorCanvas.focus();
    await ownerPage.keyboard.type("Zero-Trust Synchronization Guarantees");
    await ownerPage.keyboard.press("Enter");

    // Type body text with Bold formatting
    await ownerPage.getByTestId("toolbar-bold").click();
    await editorCanvas.focus();
    await ownerPage.keyboard.type("Deterministic Convergence:");
    await ownerPage.getByTestId("toolbar-bold").click();
    await ownerPage.keyboard.type(
      " Concurrent Yjs state vectors merge without data loss."
    );
    await ownerPage.keyboard.press("Enter");

    // Use Slash Command menu to insert a 3x3 Table
    await ownerPage.getByTestId("toolbar-slash-trigger").click();
    await expect(ownerPage.getByTestId("slash-command-menu")).toBeVisible();
    await ownerPage.getByTestId("slash-item-table").click();
    await expect(editorCanvas.locator("table")).toBeVisible();

    // Test Safe Link validation in Link Popover (reject javascript: URI, accept https: URI)
    await ownerPage.getByTestId("toolbar-link").click();
    await ownerPage.getByTestId("link-url-input").fill("javascript:alert(1)");
    await ownerPage.getByTestId("apply-link-button").click();
    await expect(
      ownerPage.getByText(/Please enter a valid http/i)
    ).toBeVisible();

    await ownerPage
      .getByTestId("link-url-input")
      .fill("https://syncspace.dev/architecture");
    await ownerPage.getByTestId("apply-link-button").click();

    // Wait for debounced PostgreSQL snapshot save to complete
    await expect
      .poll(
        async () => {
          const ver = await prisma.artifactVersion.findFirst({
            where: { artifactId: dbDoc!.id },
          });
          return ver ? JSON.stringify(ver.snapshotData) : "";
        },
        { timeout: 10000 }
      )
      .toContain("Zero-Trust Synchronization Guarantees");

    // Reload the page and verify both title and rich-text content persist
    await ownerPage.reload();
    await expect(ownerPage.getByTestId("document-title-heading")).toHaveText(
      updatedDocTitle
    );
    await expect(ownerPage.getByTestId("tiptap-editor-canvas")).toContainText(
      "Zero-Trust Synchronization Guarantees"
    );
    await expect(ownerPage.getByTestId("tiptap-editor-canvas")).toContainText(
      "Deterministic Convergence:"
    );

    // 6. Verify /api/liveblocks-auth security boundaries
    // Unauthenticated -> 401
    const unauthRoomRes = await unauthPage.request.post(
      "/api/liveblocks-auth",
      {
        data: { room: dbDoc!.liveblocksRoomId },
      }
    );
    expect(unauthRoomRes.status()).toBe(401);

    // Missing room -> 400
    const missingRoomRes = await ownerPage.request.post(
      "/api/liveblocks-auth",
      {
        data: { room: "" },
      }
    );
    expect(missingRoomRes.status()).toBe(400);

    // Nonexistent room -> 403
    const fakeRoomRes = await ownerPage.request.post("/api/liveblocks-auth", {
      data: { room: "art_nonexistent_room_id" },
    });
    expect(fakeRoomRes.status()).toBe(403);

    // Outsider User -> 403 on /api/liveblocks-auth and 404 on document page
    const outsiderRoomRes = await outsiderPage.request.post(
      "/api/liveblocks-auth",
      {
        data: { room: dbDoc!.liveblocksRoomId },
      }
    );
    expect(outsiderRoomRes.status()).toBe(403);

    await outsiderPage.goto(`/app/documents/${dbDoc!.id}`);
    await expect(
      outsiderPage.getByText("Artifact or Page Not Found")
    ).toBeVisible();

    // 7. Add Viewer user to the workspace as VIEWER and verify Read-Only Editor enforcement
    const addViewerRes = await ownerPage.request.post(
      `/api/workspaces/${dbWorkspace!.id}/members`,
      {
        data: {
          email: viewerEmail,
          role: "VIEWER",
        },
      }
    );
    expect(addViewerRes.status()).toBe(201);

    await viewerPage.goto(`/app/documents/${dbDoc!.id}`);
    await expect(viewerPage.getByTestId("document-title-heading")).toHaveText(
      updatedDocTitle
    );
    await expect(viewerPage.getByTestId("document-effective-role")).toHaveText(
      "VIEWER"
    );
    await expect(viewerPage.getByTestId("viewer-readonly-banner")).toBeVisible();
    await expect(viewerPage.getByTestId("tiptap-editor-canvas")).toHaveAttribute(
      "contenteditable",
      "false"
    );
    await expect(viewerPage.getByTestId("toolbar-bold")).toBeDisabled();

    // Viewer cannot PATCH document title or content via API (403)
    const viewerPatchRes = await viewerPage.request.patch(
      `/api/artifacts/${dbDoc!.id}`,
      {
        data: { title: "Viewer Tampered Title" },
      }
    );
    expect(viewerPatchRes.status()).toBe(403);

    // 8. Owner grants Viewer an artifact-specific EDITOR override -> Viewer becomes EDITOR on this document
    const dbViewer = await prisma.user.findUnique({
      where: { email: viewerEmail },
    });
    expect(dbViewer).not.toBeNull();

    const grantEditorOverrideRes = await ownerPage.request.put(
      `/api/artifacts/${dbDoc!.id}/permissions`,
      {
        data: {
          userId: dbViewer!.id,
          role: "EDITOR",
        },
      }
    );
    expect(grantEditorOverrideRes.status()).toBe(200);

    await viewerPage.reload();
    await expect(viewerPage.getByTestId("document-effective-role")).toHaveText(
      "EDITOR"
    );
    await expect(viewerPage.getByTestId("tiptap-editor-canvas")).toHaveAttribute(
      "contenteditable",
      "true"
    );

    // 9. Owner revokes access (NONE override) for that user -> immediately blocked on page and /api/liveblocks-auth
    const revokeOverrideRes = await ownerPage.request.put(
      `/api/artifacts/${dbDoc!.id}/permissions`,
      {
        data: {
          userId: dbViewer!.id,
          role: "NONE",
        },
      }
    );
    expect(revokeOverrideRes.status()).toBe(200);

    const revokedRoomRes = await viewerPage.request.post(
      "/api/liveblocks-auth",
      {
        data: { room: dbDoc!.liveblocksRoomId },
      }
    );
    expect(revokedRoomRes.status()).toBe(403);

    await viewerPage.goto(`/app/documents/${dbDoc!.id}`);
    await expect(
      viewerPage.getByText("Artifact or Page Not Found")
    ).toBeVisible();

    await ownerContext.close();
    await viewerContext.close();
    await outsiderContext.close();
    await unauthContext.close();
  });

  test("2. Liveblocks Cloud Multi-User Real-Time Yjs Sync (Requires valid LIVEBLOCKS_SECRET_KEY)", async ({
    browser,
  }) => {
    test.skip(
      !LIVEBLOCKS_CLOUD_READY,
      "Blocked by missing or placeholder LIVEBLOCKS_SECRET_KEY in .env; configure a live sk_... key from liveblocks.io to verify cloud WebSocket room synchronization."
    );

    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);
    const userAEmail = `collab.a.${timestamp}.${rand}@syncspace.dev`;
    const userBEmail = `collab.b.${timestamp}.${rand}@syncspace.dev`;
    const userCEmail = `collab.c.${timestamp}.${rand}@syncspace.dev`;
    const outsiderEmail = `collab.out.${timestamp}.${rand}@syncspace.dev`;
    const password = "CollabPassword123!";
    createdUserEmails.push(userAEmail, userBEmail, userCEmail, outsiderEmail);

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const contextC = await browser.newContext();
    const contextOutsider = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const pageC = await contextC.newPage();
    const pageOutsider = await contextOutsider.newPage();

    // 1. Register User A (Alpha - Owner/Editor)
    await pageA.goto("/register");
    await pageA.getByPlaceholder("Sunil Kumar").fill("Collaborator Alpha");
    await pageA.getByPlaceholder("name@company.com").fill(userAEmail);
    await pageA.getByPlaceholder("Minimum 8 characters").fill(password);
    await pageA.getByRole("button", { name: /create account/i }).click();
    await expect(pageA).toHaveURL(/\/app/);

    // 2. Register User B (Beta - Workspace Editor)
    await pageB.goto("/register");
    await pageB.getByPlaceholder("Sunil Kumar").fill("Collaborator Beta");
    await pageB.getByPlaceholder("name@company.com").fill(userBEmail);
    await pageB.getByPlaceholder("Minimum 8 characters").fill(password);
    await pageB.getByRole("button", { name: /create account/i }).click();
    await expect(pageB).toHaveURL(/\/app/);

    // 3. Register User C (Gamma - Workspace Viewer)
    await pageC.goto("/register");
    await pageC.getByPlaceholder("Sunil Kumar").fill("Collaborator Gamma");
    await pageC.getByPlaceholder("name@company.com").fill(userCEmail);
    await pageC.getByPlaceholder("Minimum 8 characters").fill(password);
    await pageC.getByRole("button", { name: /create account/i }).click();
    await expect(pageC).toHaveURL(/\/app/);

    // 4. Register User Outsider (Delta - Non-member)
    await pageOutsider.goto("/register");
    await pageOutsider.getByPlaceholder("Sunil Kumar").fill("Intruder Delta");
    await pageOutsider.getByPlaceholder("name@company.com").fill(outsiderEmail);
    await pageOutsider.getByPlaceholder("Minimum 8 characters").fill(password);
    await pageOutsider.getByRole("button", { name: /create account/i }).click();
    await expect(pageOutsider).toHaveURL(/\/app/);

    // 5. User A creates workspace, adds User B as EDITOR and User C as VIEWER
    await pageA.getByRole("button", { name: /create workspace/i }).first().click();
    const wsName = `Live Collab ${rand}`;
    await pageA.getByPlaceholder("e.g. Acme Engineering").fill(wsName);
    await pageA
      .getByRole("dialog")
      .getByRole("button", { name: /create workspace/i })
      .click();
    await expect(pageA.locator("h1")).toContainText(wsName);

    const ws = await prisma.workspace.findFirst({ where: { name: wsName } });
    expect(ws).not.toBeNull();

    const addMemberBRes = await pageA.request.post(
      `/api/workspaces/${ws!.id}/members`,
      {
        data: { email: userBEmail, role: "EDITOR" },
      }
    );
    expect(addMemberBRes.status()).toBe(201);

    const addMemberCRes = await pageA.request.post(
      `/api/workspaces/${ws!.id}/members`,
      {
        data: { email: userCEmail, role: "VIEWER" },
      }
    );
    expect(addMemberCRes.status()).toBe(201);

    // 6. User A creates a DOCUMENT artifact
    const createDocRes = await pageA.request.post("/api/artifacts", {
      data: {
        workspaceId: ws!.id,
        type: "DOCUMENT",
        title: `Live Sync Spec ${rand}`,
      },
    });
    expect(createDocRes.status()).toBe(201);
    const docData = (await createDocRes.json()).data;
    expect(docData.liveblocksRoomId).toMatch(/^art_/);

    // 7. Simultaneous room entry by Alpha, Beta, and Gamma
    await Promise.all([
      pageA.goto(`/app/documents/${docData.id}`),
      pageB.goto(`/app/documents/${docData.id}`),
      pageC.goto(`/app/documents/${docData.id}`),
    ]);

    // Verify WebSocket room connection status across all three participants
    await expect(pageA.getByTestId("room-connection-status")).toContainText(
      "Connected & Synced"
    );
    await expect(pageB.getByTestId("room-connection-status")).toContainText(
      "Connected & Synced"
    );
    await expect(pageC.getByTestId("room-connection-status")).toContainText(
      "Connected & Synced"
    );

    // Verify presence self avatars
    await expect(pageA.getByTestId("collaborator-self-avatar")).toBeVisible();
    await expect(pageB.getByTestId("collaborator-self-avatar")).toBeVisible();
    await expect(pageC.getByTestId("collaborator-self-avatar")).toBeVisible();

    // Verify presence indicators update to reflect active peers in room
    await expect(
      pageA
        .getByTestId("collaborator-avatars")
        .locator("[data-testid^='collaborator-remote-']")
    ).toHaveCount(2, { timeout: 15000 });

    await expect(
      pageB
        .getByTestId("collaborator-avatars")
        .locator("[data-testid^='collaborator-remote-']")
    ).toHaveCount(2, { timeout: 15000 });

    // 8. User A types in paragraph 1 -> User B and C observe text appear live via WebSocket without page reload
    await pageA.getByTestId("tiptap-editor-canvas").click();
    await pageA.keyboard.type("Alpha consensus edit: verified real-time stream.");

    await expect(pageB.getByTestId("tiptap-editor-canvas")).toContainText(
      "Alpha consensus edit: verified real-time stream.",
      { timeout: 15000 }
    );
    await expect(pageC.getByTestId("tiptap-editor-canvas")).toContainText(
      "Alpha consensus edit: verified real-time stream.",
      { timeout: 15000 }
    );

    // 9. User B types paragraph 2 -> User A and C observe text appear live without page reload
    await pageB.getByTestId("tiptap-editor-canvas").click();
    await pageB.keyboard.press("Enter");
    await pageB.keyboard.type("Beta response edit: peer synchronization acknowledged.");

    await expect(pageA.getByTestId("tiptap-editor-canvas")).toContainText(
      "Beta response edit: peer synchronization acknowledged.",
      { timeout: 15000 }
    );
    await expect(pageC.getByTestId("tiptap-editor-canvas")).toContainText(
      "Beta response edit: peer synchronization acknowledged.",
      { timeout: 15000 }
    );

    // 10. Rapid concurrent/interleaved typing merges cleanly without overwriting
    await Promise.all([
      (async () => {
        await pageA.getByTestId("tiptap-editor-canvas").click();
        await pageA.keyboard.press("Enter");
        await pageA.keyboard.type(" [Concurrent Stream Alpha]");
      })(),
      (async () => {
        await pageB.getByTestId("tiptap-editor-canvas").click();
        await pageB.keyboard.press("Enter");
        await pageB.keyboard.type(" [Concurrent Stream Beta]");
      })(),
    ]);

    await expect(pageA.getByTestId("tiptap-editor-canvas")).toContainText(
      "[Concurrent Stream Alpha]"
    );
    await expect(pageA.getByTestId("tiptap-editor-canvas")).toContainText(
      "[Concurrent Stream Beta]"
    );
    await expect(pageB.getByTestId("tiptap-editor-canvas")).toContainText(
      "[Concurrent Stream Alpha]"
    );
    await expect(pageB.getByTestId("tiptap-editor-canvas")).toContainText(
      "[Concurrent Stream Beta]"
    );

    // 11. Role enforcement: Viewer cannot edit
    await expect(pageC.getByTestId("document-effective-role")).toHaveText("VIEWER");
    await expect(pageC.getByTestId("viewer-readonly-banner")).toBeVisible();
    await expect(pageC.getByTestId("tiptap-editor-canvas")).toHaveAttribute(
      "contenteditable",
      "false"
    );
    await expect(pageC.getByTestId("toolbar-bold")).toBeDisabled();

    // Viewer API tamper attempt is rejected with 403
    const viewerTamperRes = await pageC.request.patch(
      `/api/artifacts/${docData.id}`,
      {
        data: { title: "Malicious Viewer Rename" },
      }
    );
    expect(viewerTamperRes.status()).toBe(403);

    // 12. Unauthorized user rejected:
    // Direct room authorization endpoint rejects outsider with 403
    const outsiderTokenRes = await pageOutsider.request.post(
      "/api/liveblocks-auth",
      {
        data: { room: docData.liveblocksRoomId },
      }
    );
    expect(outsiderTokenRes.status()).toBe(403);

    // Document page navigation rejects outsider with Not Found UI
    await pageOutsider.goto(`/app/documents/${docData.id}`);
    await expect(
      pageOutsider.getByText("Artifact or Page Not Found")
    ).toBeVisible();

    // 13. Refreshing browser contexts confirms persisted synchronized document state
    // Allow debounce (900ms) for snapshot save
    await pageA.waitForTimeout(1500);

    await Promise.all([pageA.reload(), pageB.reload()]);

    await expect(pageA.getByTestId("room-connection-status")).toContainText(
      "Connected & Synced"
    );
    await expect(pageB.getByTestId("room-connection-status")).toContainText(
      "Connected & Synced"
    );

    await expect(pageA.getByTestId("tiptap-editor-canvas")).toContainText(
      "Alpha consensus edit: verified real-time stream."
    );
    await expect(pageA.getByTestId("tiptap-editor-canvas")).toContainText(
      "Beta response edit: peer synchronization acknowledged."
    );
    await expect(pageA.getByTestId("tiptap-editor-canvas")).toContainText(
      "[Concurrent Stream Alpha]"
    );
    await expect(pageA.getByTestId("tiptap-editor-canvas")).toContainText(
      "[Concurrent Stream Beta]"
    );

    await expect(pageB.getByTestId("tiptap-editor-canvas")).toContainText(
      "Alpha consensus edit: verified real-time stream."
    );
    await expect(pageB.getByTestId("tiptap-editor-canvas")).toContainText(
      "Beta response edit: peer synchronization acknowledged."
    );
    await expect(pageB.getByTestId("tiptap-editor-canvas")).toContainText(
      "[Concurrent Stream Alpha]"
    );
    await expect(pageB.getByTestId("tiptap-editor-canvas")).toContainText(
      "[Concurrent Stream Beta]"
    );

    // Verify document record and room ID in PostgreSQL
    const dbDocAfter = await prisma.artifact.findUnique({
      where: { id: docData.id },
      select: {
        id: true,
        liveblocksRoomId: true,
        versions: {
          select: { id: true, snapshotData: true },
        },
      },
    });
    expect(dbDocAfter).not.toBeNull();
    expect(dbDocAfter?.liveblocksRoomId).toBe(docData.liveblocksRoomId);

    await contextA.close();
    await contextB.close();
    await contextC.close();
    await contextOutsider.close();
  });
});
