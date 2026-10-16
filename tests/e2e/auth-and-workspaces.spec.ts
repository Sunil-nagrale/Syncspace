import "dotenv/config";
import { test, expect } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";

test.describe("SyncSpace Phase 4B — Real Authentication & Multi-Tenant Workspace E2E", () => {
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

  test("1. Complete Authentication Lifecycle: register, PostgreSQL persistence, duplicate rejection, session retrieval, protected routes, logout, former session invalidation, invalid login rejection, and re-login", async ({
    browser,
  }) => {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);
    const userEmail = `e2e.auth.${timestamp}.${rand}@syncspace.dev`;
    const userName = `E2E Auth User ${rand}`;
    const userPassword = "ValidPassword123!";
    createdUserEmails.push(userEmail);

    // --- Step 7 (Pre-check): Protected API routes reject unauthenticated access ---
    const unauthContext = await browser.newContext();
    const unauthPage = await unauthContext.newPage();

    const unauthWsRes = await unauthPage.request.get("/api/workspaces");
    expect(unauthWsRes.status()).toBe(401);

    const unauthCreateWsRes = await unauthPage.request.post("/api/workspaces", {
      data: { name: "Unauth Workspace" },
    });
    expect(unauthCreateWsRes.status()).toBe(401);

    const unauthProjRes = await unauthPage.request.get(
      "/api/projects?workspaceId=fake_ws"
    );
    expect(unauthProjRes.status()).toBe(401);

    const unauthArtRes = await unauthPage.request.get(
      "/api/artifacts?workspaceId=fake_ws"
    );
    expect(unauthArtRes.status()).toBe(401);

    await unauthContext.close();

    // --- Step 1: Register a new user through the application UI ---
    const authContext = await browser.newContext();
    const page = await authContext.newPage();

    await page.goto("/register");
    await page.getByPlaceholder("Sunil Kumar").fill(userName);
    await page.getByPlaceholder("name@company.com").fill(userEmail);
    await page.getByPlaceholder("Minimum 8 characters").fill(userPassword);
    await page.getByRole("button", { name: /create account/i }).click();

    // Wait for navigation to /app after registration
    await expect(page).toHaveURL(/\/app/);
    await expect(page.locator("h1")).toContainText("Welcome to SyncSpace");

    // --- Step 2: Verify user, credential account, and session records persist in PostgreSQL ---
    const dbUser = await prisma.user.findUnique({
      where: { email: userEmail },
      include: {
        accounts: true,
        sessions: true,
      },
    });

    expect(dbUser).not.toBeNull();
    expect(dbUser?.name).toBe(userName);
    expect(dbUser?.email).toBe(userEmail);
    expect(dbUser?.accounts).toHaveLength(1);
    expect(dbUser?.accounts[0].providerId).toBe("credential");
    expect(dbUser?.accounts[0].password).toBeTruthy();
    expect(dbUser?.sessions.length).toBeGreaterThanOrEqual(1);

    // --- Step 6: Verify authenticated session can be retrieved via API ---
    const sessionRes = await page.request.get("/api/auth/get-session");
    expect(sessionRes.status()).toBe(200);
    const sessionBody = await sessionRes.json();
    expect(sessionBody?.user?.id).toBe(dbUser?.id);
    expect(sessionBody?.user?.email).toBe(userEmail);
    expect(sessionBody?.session?.token).toBeTruthy();

    // Capture the active session cookies before logging out
    const formerCookies = await authContext.cookies();
    expect(formerCookies.length).toBeGreaterThan(0);

    // --- Step 5: Verify duplicate registration is rejected safely ---
    const dupContext = await browser.newContext();
    const dupPage = await dupContext.newPage();
    await dupPage.goto("/register");
    await dupPage.getByPlaceholder("Sunil Kumar").fill("Duplicate User");
    await dupPage.getByPlaceholder("name@company.com").fill(userEmail);
    await dupPage.getByPlaceholder("Minimum 8 characters").fill(userPassword);
    await dupPage.getByRole("button", { name: /create account/i }).click();

    // Must remain on /register and display error alert
    await expect(dupPage).toHaveURL(/\/register/);
    await expect(
      dupPage.locator(".text-destructive").first()
    ).toBeVisible();

    const userCount = await prisma.user.count({
      where: { email: userEmail },
    });
    expect(userCount).toBe(1);
    await dupContext.close();

    // --- Step 8: Logout invalidates the session ---
    // Open user profile dropdown in sidebar and click "Log out"
    await page
      .locator("aside")
      .getByRole("button")
      .filter({ hasText: userName })
      .click();
    await page.getByRole("menuitem", { name: /log out/i }).click();

    await expect(page).toHaveURL(/\/login/);

    // Verify session was deleted from PostgreSQL
    const remainingSessions = await prisma.session.findMany({
      where: { userId: dbUser!.id },
    });
    expect(remainingSessions).toHaveLength(0);

    // --- Step 9: Logged-out user cannot access protected data using the former session ---
    const replayContext = await browser.newContext();
    await replayContext.addCookies(formerCookies);
    const replayPage = await replayContext.newPage();

    const replaySessionRes = await replayPage.request.get(
      "/api/auth/get-session"
    );
    const replaySessionData = await replaySessionRes.json();
    expect(replaySessionData).toBeNull();

    const replayWorkspacesRes = await replayPage.request.get("/api/workspaces");
    expect(replayWorkspacesRes.status()).toBe(401);

    await replayContext.close();

    // --- Step 4: Invalid credentials are rejected on login ---
    await page.goto("/login");
    await page.locator("input[type='email']").fill(userEmail);
    await page.locator("input[type='password']").fill("WrongPassword999!");
    await page.getByRole("button", { name: /continue to workspace/i }).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator(".text-destructive").first()).toBeVisible();

    // --- Step 3: Registered user can log in with valid credentials ---
    await page.locator("input[type='email']").fill(userEmail);
    await page.locator("input[type='password']").fill(userPassword);
    await page.getByRole("button", { name: /continue to workspace/i }).click();

    await expect(page).toHaveURL(/\/app/);
    const reloginSessionRes = await page.request.get("/api/auth/get-session");
    const reloginSession = await reloginSessionRes.json();
    expect(reloginSession?.user?.id).toBe(dbUser?.id);

    await authContext.close();
  });

  test("2. Multi-User Workspace Workflows: workspace, project, document & whiteboard creation, persistence across refresh, cross-tenant IDOR isolation, and viewer role restrictions", async ({
    browser,
  }) => {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);

    const userAEmail = `user.a.${timestamp}.${rand}@syncspace.dev`;
    const userBEmail = `user.b.${timestamp}.${rand}@syncspace.dev`;
    const password = "TeamPassword123!";
    createdUserEmails.push(userAEmail, userBEmail);

    const workspaceName = `Alpha Engineering ${rand}`;
    const projectName = `Core Sync Engine ${rand}`;
    const docTitle = `CRDT Protocol Spec ${rand}`;
    const boardTitle = `Topology Architecture ${rand}`;

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // 1. Register User A and User B in distinct browser contexts
    await pageA.goto("/register");
    await pageA.getByPlaceholder("Sunil Kumar").fill("Alice Owner");
    await pageA.getByPlaceholder("name@company.com").fill(userAEmail);
    await pageA.getByPlaceholder("Minimum 8 characters").fill(password);
    await pageA.getByRole("button", { name: /create account/i }).click();
    await expect(pageA).toHaveURL(/\/app/);

    await pageB.goto("/register");
    await pageB.getByPlaceholder("Sunil Kumar").fill("Bob Outsider");
    await pageB.getByPlaceholder("name@company.com").fill(userBEmail);
    await pageB.getByPlaceholder("Minimum 8 characters").fill(password);
    await pageB.getByRole("button", { name: /create account/i }).click();
    await expect(pageB).toHaveURL(/\/app/);

    // 2. User A creates a Workspace via the UI dialog
    await pageA.getByRole("button", { name: /create workspace/i }).first().click();
    await pageA.getByPlaceholder("e.g. Acme Engineering").fill(workspaceName);
    await pageA
      .getByRole("dialog")
      .getByRole("button", { name: /create workspace/i })
      .click();

    await expect(pageA.locator("h1")).toContainText(workspaceName);
    await expect(pageA.getByText("OWNER").first()).toBeVisible();

    // Confirm workspace persists in PostgreSQL
    const dbUserA = await prisma.user.findUnique({ where: { email: userAEmail } });
    const dbUserB = await prisma.user.findUnique({ where: { email: userBEmail } });
    expect(dbUserA).not.toBeNull();
    expect(dbUserB).not.toBeNull();

    const dbWorkspace = await prisma.workspace.findFirst({
      where: { createdById: dbUserA!.id, name: workspaceName },
    });
    expect(dbWorkspace).not.toBeNull();

    // 3. User A creates a Project via the UI dialog
    await pageA.getByRole("button", { name: /new project/i }).first().click();
    await pageA
      .getByPlaceholder("e.g. Infrastructure Modernization")
      .fill(projectName);
    await pageA
      .getByPlaceholder("Brief summary of the project goals...")
      .fill("Zero-trust synchronization project");
    await pageA
      .getByRole("dialog")
      .getByRole("button", { name: /create project/i })
      .click();

    await expect(pageA.getByText(projectName).first()).toBeVisible();

    const dbProject = await prisma.project.findFirst({
      where: { workspaceId: dbWorkspace!.id, name: projectName },
    });
    expect(dbProject).not.toBeNull();

    // 4. User A creates a Document Artifact via the UI dialog
    await pageA.getByRole("button", { name: /new document/i }).first().click();
    await pageA
      .getByPlaceholder("e.g. Architecture Overview")
      .fill(docTitle);
    await pageA.locator("select").selectOption(dbProject!.id);
    await pageA
      .getByRole("dialog")
      .getByRole("button", { name: /create document/i })
      .click();

    // Verify navigation to the persisted document page
    await expect(pageA).toHaveURL(/\/app\/documents\/.+/);
    await expect(pageA.locator("h1")).toContainText(docTitle);

    const dbDoc = await prisma.artifact.findFirst({
      where: {
        workspaceId: dbWorkspace!.id,
        title: docTitle,
        type: "DOCUMENT",
      },
    });
    expect(dbDoc).not.toBeNull();
    expect(dbDoc?.projectId).toBe(dbProject!.id);

    // 5. User A returns to /app and creates a Whiteboard Artifact via the UI dialog
    await pageA.goto("/app");
    await expect(pageA.locator("h1")).toContainText(workspaceName);

    await pageA.getByRole("button", { name: /new whiteboard/i }).first().click();
    await pageA
      .getByPlaceholder("e.g. System Topology Diagram")
      .fill(boardTitle);
    await pageA.locator("select").selectOption(dbProject!.id);
    await pageA
      .getByRole("dialog")
      .getByRole("button", { name: /create whiteboard/i })
      .click();

    // Verify navigation to the persisted whiteboard page
    await expect(pageA).toHaveURL(/\/app\/whiteboards\/.+/);
    await expect(pageA.locator("h1")).toContainText(boardTitle);

    const dbBoard = await prisma.artifact.findFirst({
      where: {
        workspaceId: dbWorkspace!.id,
        title: boardTitle,
        type: "WHITEBOARD",
      },
    });
    expect(dbBoard).not.toBeNull();
    expect(dbBoard?.projectId).toBe(dbProject!.id);

    // 6. Refresh the application and verify that the correct records remain visible
    await pageA.goto("/app");
    await pageA.reload();
    await expect(pageA.locator("h1")).toContainText(workspaceName);
    await expect(pageA.getByText(projectName).first()).toBeVisible();
    await expect(pageA.getByText(docTitle).first()).toBeVisible();
    await expect(pageA.getByText(boardTitle).first()).toBeVisible();

    // Also verify project detail page persists across refresh
    await pageA.goto(`/app/projects/${dbProject!.id}`);
    await pageA.reload();
    await expect(pageA.locator("h1")).toContainText(projectName);
    await expect(pageA.getByText(docTitle).first()).toBeVisible();
    await expect(pageA.getByText(boardTitle).first()).toBeVisible();

    // 7. Cross-workspace IDOR Isolation: User B cannot access User A's private workspace, projects, or artifacts
    // 7a. By changing URL identifiers in the browser
    await pageB.goto(`/app?workspaceId=${dbWorkspace!.id}`);
    await expect(pageB.getByText("404")).toBeVisible();
    await expect(pageB.getByText(workspaceName)).toHaveCount(0);

    await pageB.goto(`/app/projects/${dbProject!.id}`);
    await expect(pageB.getByText("404")).toBeVisible();
    await expect(pageB.getByText(projectName)).toHaveCount(0);

    await pageB.goto(`/app/documents/${dbDoc!.id}`);
    await expect(pageB.getByText("404")).toBeVisible();
    await expect(pageB.getByText(docTitle)).toHaveCount(0);

    await pageB.goto(`/app/whiteboards/${dbBoard!.id}`);
    await expect(pageB.getByText("404")).toBeVisible();
    await expect(pageB.getByText(boardTitle)).toHaveCount(0);

    // 7b. By changing API request parameters
    expect(
      (await pageB.request.get(`/api/workspaces/${dbWorkspace!.id}`)).status()
    ).toBe(404);
    expect(
      (
        await pageB.request.get(
          `/api/projects?workspaceId=${dbWorkspace!.id}`
        )
      ).status()
    ).toBe(404);
    expect(
      (await pageB.request.get(`/api/projects/${dbProject!.id}`)).status()
    ).toBe(404);
    expect(
      (
        await pageB.request.get(
          `/api/artifacts?workspaceId=${dbWorkspace!.id}`
        )
      ).status()
    ).toBe(404);
    expect(
      (await pageB.request.get(`/api/artifacts/${dbDoc!.id}`)).status()
    ).toBe(404);
    expect(
      (await pageB.request.get(`/api/artifacts/${dbBoard!.id}`)).status()
    ).toBe(404);

    // 8. Verify unauthorized mutations by User B fail
    expect(
      (
        await pageB.request.patch(`/api/workspaces/${dbWorkspace!.id}`, {
          data: { name: "Hacked by User B" },
        })
      ).status()
    ).toBe(404);

    expect(
      (
        await pageB.request.post("/api/projects", {
          data: { workspaceId: dbWorkspace!.id, name: "Intruder Project" },
        })
      ).status()
    ).toBe(404);

    expect(
      (
        await pageB.request.patch(`/api/projects/${dbProject!.id}`, {
          data: { name: "Intruder Project Rename" },
        })
      ).status()
    ).toBe(404);

    expect(
      (await pageB.request.delete(`/api/projects/${dbProject!.id}`)).status()
    ).toBe(404);

    expect(
      (
        await pageB.request.post("/api/artifacts", {
          data: {
            workspaceId: dbWorkspace!.id,
            type: "DOCUMENT",
            title: "Intruder Doc",
          },
        })
      ).status()
    ).toBe(404);

    expect(
      (
        await pageB.request.patch(`/api/artifacts/${dbDoc!.id}`, {
          data: { title: "Intruder Doc Rename" },
        })
      ).status()
    ).toBe(404);

    expect(
      (await pageB.request.delete(`/api/artifacts/${dbDoc!.id}`)).status()
    ).toBe(404);

    // 9. Verify documented role restrictions for VIEWER
    // User A adds User B as a VIEWER to Workspace A via the members API
    const addViewerRes = await pageA.request.post(
      `/api/workspaces/${dbWorkspace!.id}/members`,
      {
        data: {
          email: userBEmail,
          role: "VIEWER",
        },
      }
    );
    expect(addViewerRes.status()).toBe(201);

    // User B (now VIEWER) can view the workspace dashboard and see Read-Only Viewer Access
    await pageB.goto(`/app?workspaceId=${dbWorkspace!.id}`);
    await expect(pageB.locator("h1")).toContainText(workspaceName);
    await expect(pageB.getByText("VIEWER").first()).toBeVisible();
    await expect(pageB.getByText("Read-Only Viewer Access")).toBeVisible();
    await expect(pageB.getByText(projectName).first()).toBeVisible();
    await expect(pageB.getByText(docTitle).first()).toBeVisible();
    await expect(pageB.getByText(boardTitle).first()).toBeVisible();

    // Viewer can read artifacts and sees VIEWER role badge
    const viewerGetDoc = await pageB.request.get(`/api/artifacts/${dbDoc!.id}`);
    expect(viewerGetDoc.status()).toBe(200);
    const viewerGetDocBody = await viewerGetDoc.json();
    expect(viewerGetDocBody.effectiveRole).toBe("VIEWER");

    // Viewer CANNOT create, update, or delete projects, artifacts, workspace settings, or members (all return 403 Forbidden)
    expect(
      (
        await pageB.request.post("/api/projects", {
          data: {
            workspaceId: dbWorkspace!.id,
            name: "Viewer Forbidden Project",
          },
        })
      ).status()
    ).toBe(403);

    expect(
      (
        await pageB.request.patch(`/api/projects/${dbProject!.id}`, {
          data: { name: "Viewer Project Edit" },
        })
      ).status()
    ).toBe(403);

    expect(
      (await pageB.request.delete(`/api/projects/${dbProject!.id}`)).status()
    ).toBe(403);

    expect(
      (
        await pageB.request.post("/api/artifacts", {
          data: {
            workspaceId: dbWorkspace!.id,
            type: "DOCUMENT",
            title: "Viewer Forbidden Doc",
          },
        })
      ).status()
    ).toBe(403);

    expect(
      (
        await pageB.request.patch(`/api/artifacts/${dbDoc!.id}`, {
          data: { title: "Viewer Doc Edit" },
        })
      ).status()
    ).toBe(403);

    expect(
      (await pageB.request.delete(`/api/artifacts/${dbBoard!.id}`)).status()
    ).toBe(403);

    expect(
      (
        await pageB.request.patch(`/api/workspaces/${dbWorkspace!.id}`, {
          data: { name: "Viewer Workspace Edit" },
        })
      ).status()
    ).toBe(403);

    expect(
      (
        await pageB.request.post(`/api/workspaces/${dbWorkspace!.id}/members`, {
          data: { email: userAEmail, role: "VIEWER" },
        })
      ).status()
    ).toBe(403);

    await contextA.close();
    await contextB.close();
  });
});
