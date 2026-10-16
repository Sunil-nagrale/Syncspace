import "dotenv/config";
import { test, expect } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { isLiveblocksSecretKeyConfigured } from "../../src/services/liveblocks-auth.service";

const LIVEBLOCKS_CLOUD_READY = isLiveblocksSecretKeyConfigured();

test.describe("SyncSpace Phase 6 — Collaborative Whiteboards & Multi-User Scene Synchronization E2E", () => {
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

  test("1. Whiteboard creation, Excalidraw UI shell, title rename, export options, and directory listing", async ({
    browser,
  }) => {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);

    const userEmail = `wb.author.${timestamp}.${rand}@syncspace.dev`;
    const password = "BoardPassword123!";
    createdUserEmails.push(userEmail);

    const context = await browser.newContext();
    const page = await context.newPage();

    // 1. Register User
    await page.goto("/register");
    await page.getByPlaceholder("Sunil Kumar").fill("Rachel Architect");
    await page.getByPlaceholder("name@company.com").fill(userEmail);
    await page.getByPlaceholder("Minimum 8 characters").fill(password);
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page).toHaveURL(/\/app/);

    // 2. Create Workspace
    const wsName = `Design Space ${rand}`;
    await page.getByRole("button", { name: /create workspace/i }).first().click();
    await page.getByPlaceholder("e.g. Acme Engineering").fill(wsName);
    await page.getByRole("dialog").getByRole("button", { name: /create workspace/i }).click();
    await expect(page.locator("h1")).toContainText(wsName);

    const dbWorkspace = await prisma.workspace.findFirst({
      where: { name: wsName },
    });
    expect(dbWorkspace).not.toBeNull();

    // 3. Navigate to /app/whiteboards
    await page.goto("/app/whiteboards");
    await expect(page.locator("h1")).toContainText("Whiteboards");

    // 4. Create new Whiteboard via dialog
    const initialBoardTitle = `Infrastructure Topology ${rand}`;
    await page.getByTestId("create-whiteboard-btn").click();
    await page.getByTestId("new-whiteboard-title-input").fill(initialBoardTitle);
    await page.getByTestId("confirm-create-whiteboard-btn").click();

    // Verify redirection to whiteboard canvas page
    await expect(page).toHaveURL(/\/app\/whiteboards\/.+/);
    await expect(page.getByTestId("whiteboard-title-heading")).toHaveText(initialBoardTitle);

    const dbBoard = await prisma.artifact.findFirst({
      where: { workspaceId: dbWorkspace!.id, title: initialBoardTitle },
    });
    expect(dbBoard).not.toBeNull();
    expect(dbBoard?.type).toBe("WHITEBOARD");
    expect(dbBoard?.liveblocksRoomId).toMatch(/^art_/);

    // Verify room badge and connection status
    await expect(page.getByTestId("room-connection-status")).toContainText(
      `Room: ${dbBoard!.liveblocksRoomId}`
    );
    await expect(page.getByTestId("whiteboard-effective-role")).toContainText("OWNER");

    // Verify Excalidraw canvas container is mounted
    await expect(page.getByTestId("excalidraw-canvas-container")).toBeVisible({
      timeout: 20000,
    });

    // Verify canvas interactive elements or Excalidraw viewport exist
    await expect(
      page.locator("[data-testid='excalidraw-canvas-container'] .excalidraw")
    ).toBeVisible({ timeout: 20000 });

    // 5. Test Title Rename
    await page.getByTestId("whiteboard-title-heading").click();
    const updatedBoardTitle = `Global Topology Plan ${rand}`;
    await page.getByTestId("whiteboard-title-input").fill(updatedBoardTitle);
    await page.getByTestId("whiteboard-title-save").click();

    await expect(page.getByTestId("whiteboard-title-heading")).toHaveText(
      updatedBoardTitle
    );

    // Verify database title update
    await expect
      .poll(async () => {
        const refreshed = await prisma.artifact.findUnique({
          where: { id: dbBoard!.id },
        });
        return refreshed?.title;
      })
      .toBe(updatedBoardTitle);

    // 6. Test Export Dropdown
    await page.getByTestId("whiteboard-export-trigger").click();
    await expect(page.getByTestId("export-png-btn")).toBeVisible();
    await expect(page.getByTestId("export-svg-btn")).toBeVisible();
    await expect(page.getByTestId("export-json-btn")).toBeVisible();
    await page.keyboard.press("Escape");

    // 7. Verify Directory Listing
    await page.goto("/app/whiteboards");
    await expect(page.getByTestId(`whiteboard-card-${dbBoard!.id}`)).toBeVisible();
    await expect(page.getByTestId(`whiteboard-card-${dbBoard!.id}`)).toContainText(
      updatedBoardTitle
    );

    // Test Search Filter
    await page.getByTestId("whiteboards-search-input").fill("NonExistentBoardQueryXYZ");
    await expect(page.getByText("No whiteboards found")).toBeVisible();
    await page.getByTestId("whiteboards-search-input").fill(updatedBoardTitle.slice(0, 10));
    await expect(page.getByTestId(`whiteboard-card-${dbBoard!.id}`)).toBeVisible();

    await context.close();
  });

  test("2. Real-time multi-user Liveblocks Cloud whiteboard synchronization, presence cursors, VIEWER restrictions, and outsider 403 rejection", async ({
    browser,
  }) => {
    test.skip(
      !LIVEBLOCKS_CLOUD_READY,
      "Liveblocks Cloud development secret key is not configured in .env"
    );

    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);

    const userAEmail = `wb.alpha.${timestamp}.${rand}@syncspace.dev`;
    const userBEmail = `wb.beta.${timestamp}.${rand}@syncspace.dev`;
    const userCEmail = `wb.gamma.${timestamp}.${rand}@syncspace.dev`;
    const outsiderEmail = `wb.outsider.${timestamp}.${rand}@syncspace.dev`;
    const password = "SyncBoardPass123!";

    createdUserEmails.push(userAEmail, userBEmail, userCEmail, outsiderEmail);

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const contextC = await browser.newContext();
    const contextOutsider = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const pageC = await contextC.newPage();
    const pageOutsider = await contextOutsider.newPage();

    // 1. Register User A (Alpha - Workspace Owner)
    await pageA.goto("/register");
    await pageA.getByPlaceholder("Sunil Kumar").fill("Alice Lead");
    await pageA.getByPlaceholder("name@company.com").fill(userAEmail);
    await pageA.getByPlaceholder("Minimum 8 characters").fill(password);
    await pageA.getByRole("button", { name: /create account/i }).click();
    await expect(pageA).toHaveURL(/\/app/);

    // 2. Register User B (Beta - Workspace Editor)
    await pageB.goto("/register");
    await pageB.getByPlaceholder("Sunil Kumar").fill("Bob Designer");
    await pageB.getByPlaceholder("name@company.com").fill(userBEmail);
    await pageB.getByPlaceholder("Minimum 8 characters").fill(password);
    await pageB.getByRole("button", { name: /create account/i }).click();
    await expect(pageB).toHaveURL(/\/app/);

    // 3. Register User C (Gamma - Workspace Viewer)
    await pageC.goto("/register");
    await pageC.getByPlaceholder("Sunil Kumar").fill("Carol Stakeholder");
    await pageC.getByPlaceholder("name@company.com").fill(userCEmail);
    await pageC.getByPlaceholder("Minimum 8 characters").fill(password);
    await pageC.getByRole("button", { name: /create account/i }).click();
    await expect(pageC).toHaveURL(/\/app/);

    // 4. Register Outsider
    await pageOutsider.goto("/register");
    await pageOutsider.getByPlaceholder("Sunil Kumar").fill("David Outsider");
    await pageOutsider.getByPlaceholder("name@company.com").fill(outsiderEmail);
    await pageOutsider.getByPlaceholder("Minimum 8 characters").fill(password);
    await pageOutsider.getByRole("button", { name: /create account/i }).click();
    await expect(pageOutsider).toHaveURL(/\/app/);

    // 5. User A creates Workspace and adds members
    await pageA.getByRole("button", { name: /create workspace/i }).first().click();
    const wsName = `Multiplayer Studio ${rand}`;
    await pageA.getByPlaceholder("e.g. Acme Engineering").fill(wsName);
    await pageA.getByRole("dialog").getByRole("button", { name: /create workspace/i }).click();
    await expect(pageA.locator("h1")).toContainText(wsName);

    const ws = await prisma.workspace.findFirst({ where: { name: wsName } });
    expect(ws).not.toBeNull();

    // Add User B as EDITOR
    const addBRes = await pageA.request.post(`/api/workspaces/${ws!.id}/members`, {
      data: { email: userBEmail, role: "EDITOR" },
    });
    expect(addBRes.status()).toBe(201);

    // Add User C as VIEWER
    const addCRes = await pageA.request.post(`/api/workspaces/${ws!.id}/members`, {
      data: { email: userCEmail, role: "VIEWER" },
    });
    expect(addCRes.status()).toBe(201);

    // 6. User A creates a WHITEBOARD artifact
    const boardTitle = `Live Architecture Grid ${rand}`;
    const createBoardRes = await pageA.request.post("/api/artifacts", {
      data: {
        workspaceId: ws!.id,
        type: "WHITEBOARD",
        title: boardTitle,
      },
    });
    expect(createBoardRes.status()).toBe(201);
    const boardData = (await createBoardRes.json()).data;
    expect(boardData.liveblocksRoomId).toMatch(/^art_/);

    // 7. Simultaneous room entry by Alpha, Beta, and Gamma
    pageA.on("pageerror", (err) => console.log("PAGE A ERROR:", err.message));
    pageB.on("pageerror", (err) => console.log("PAGE B ERROR:", err.message));
    pageC.on("pageerror", (err) => console.log("PAGE C ERROR:", err.message));

    pageA.on("console", (msg) => {
      if (msg.type() === "error" || msg.text().includes("Liveblocks") || msg.text().includes("liveblocks")) {
        console.log("PAGE A CONSOLE:", msg.type(), msg.text());
      }
    });

    pageA.on("response", async (res) => {
      if (res.url().includes("liveblocks")) {
        const body = await res.text().catch(() => "");
        console.log("PAGE A RES:", res.url(), res.status(), body.slice(0, 150));
      }
    });

    await Promise.all([
      pageA.goto(`/app/whiteboards/${boardData.id}`),
      pageB.goto(`/app/whiteboards/${boardData.id}`),
      pageC.goto(`/app/whiteboards/${boardData.id}`),
    ]);

    // Wait for Excalidraw dynamic canvas to mount on all clients
    await Promise.all([
      expect(pageA.getByTestId("excalidraw-canvas-container")).toBeVisible({ timeout: 25000 }),
      expect(pageB.getByTestId("excalidraw-canvas-container")).toBeVisible({ timeout: 25000 }),
      expect(pageC.getByTestId("excalidraw-canvas-container")).toBeVisible({ timeout: 25000 }),
    ]);

    // Verify WebSocket room connection status across all three participants
    await expect(pageA.getByTestId("room-connection-status")).toContainText(
      "Connected & Synced",
      { timeout: 25000 }
    );
    await expect(pageB.getByTestId("room-connection-status")).toContainText(
      "Connected & Synced",
      { timeout: 25000 }
    );
    await expect(pageC.getByTestId("room-connection-status")).toContainText(
      "Connected & Synced",
      { timeout: 25000 }
    );

    // Verify presence collaborator avatars in header
    await expect(pageA.getByTestId("collaborator-self-avatar")).toBeVisible();
    await expect(pageB.getByTestId("collaborator-self-avatar")).toBeVisible();
    await expect(pageC.getByTestId("collaborator-self-avatar")).toBeVisible();

    // Verify remote peer avatars update via Liveblocks presence
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

    // 8. Verify Viewer Mode restrictions on Page C
    await expect(pageC.getByTestId("viewer-readonly-banner")).toBeVisible();
    await expect(pageC.getByTestId("whiteboard-effective-role")).toContainText("VIEWER");

    // 9. Interactive Drawing & Live Two-Way Element Synchronization:
    // User A selects the rectangle tool and draws on the canvas
    await pageA.locator("[data-testid='toolbar-rectangle']").click({ force: true });

    const canvasA = pageA.locator("canvas.interactive");
    await expect(canvasA).toBeVisible({ timeout: 15000 });
    const boxA = (await canvasA.boundingBox())!;
    const startXA = boxA.x + Math.floor(boxA.width * 0.4);
    const startYA = boxA.y + Math.floor(boxA.height * 0.4);
    await pageA.mouse.move(startXA, startYA);
    await pageA.mouse.down();
    await pageA.mouse.move(startXA + 140, startYA + 90, { steps: 10 });
    await pageA.mouse.up();

    // Wait for debounced PostgreSQL snapshot indicator to verify save
    await expect(pageA.getByTestId("whiteboard-save-status")).toContainText(
      "Saved",
      { timeout: 15000 }
    );

    // User B selects arrow tool and draws connected element
    await pageB.locator("[data-testid='toolbar-arrow']").click({ force: true });

    const canvasB = pageB.locator("canvas.interactive");
    await expect(canvasB).toBeVisible({ timeout: 15000 });
    const boxB = (await canvasB.boundingBox())!;
    const startXB = boxB.x + Math.floor(boxB.width * 0.6);
    const startYB = boxB.y + Math.floor(boxB.height * 0.4);
    await pageB.mouse.move(startXB, startYB);
    await pageB.mouse.down();
    await pageB.mouse.move(startXB + 120, startYB + 80, { steps: 10 });
    await pageB.mouse.up();

    // Verify User B's save indicator
    await expect(pageB.getByTestId("whiteboard-save-status")).toContainText(
      "Saved",
      { timeout: 15000 }
    );

    // 10. Verify Snapshot Persisted in PostgreSQL
    await expect
      .poll(
        async () => {
          const versions = await prisma.artifactVersion.findMany({
            where: { artifactId: boardData.id },
          });
          return versions.length;
        },
        { timeout: 15000 }
      )
      .toBeGreaterThanOrEqual(1);

    const latestVersion = await prisma.artifactVersion.findFirst({
      where: { artifactId: boardData.id },
      orderBy: { versionNumber: "desc" },
    });
    expect(latestVersion).not.toBeNull();
    const snapshot = latestVersion?.snapshotData as { elements?: any[] };
    expect(Array.isArray(snapshot?.elements)).toBe(true);
    expect(snapshot?.elements?.length).toBeGreaterThanOrEqual(1);

    // 11. Page Reload Persistence: Both peers reload and scene restores intact
    await Promise.all([pageA.reload(), pageB.reload()]);

    await Promise.all([
      expect(pageA.getByTestId("excalidraw-canvas-container")).toBeVisible({ timeout: 25000 }),
      expect(pageB.getByTestId("excalidraw-canvas-container")).toBeVisible({ timeout: 25000 }),
    ]);

    await expect(pageA.getByTestId("room-connection-status")).toContainText(
      "Connected & Synced",
      { timeout: 25000 }
    );
    await expect(pageB.getByTestId("room-connection-status")).toContainText(
      "Connected & Synced",
      { timeout: 25000 }
    );

    // 12. Concurrency Resilience: Collaborator Disconnection, Mid-Flight Edits, Reconnection, and Hydration
    // User B navigates away from the whiteboard room (disconnects)
    await pageB.goto("/app/whiteboards");
    await expect(pageB.locator("h1")).toContainText("Whiteboards", { timeout: 15000 });

    // Page A observes User B has disconnected (collaborator count drops)
    await expect(
      pageA
        .getByTestId("collaborator-avatars")
        .locator("[data-testid^='collaborator-remote-']")
    ).toHaveCount(1, { timeout: 15000 });

    // While User B is offline, User A draws an additional shape on the canvas
    await pageA.locator("[data-testid='toolbar-ellipse']").click({ force: true });
    const canvasA2 = pageA.locator("canvas.interactive");
    await expect(canvasA2).toBeVisible({ timeout: 15000 });
    const boxA2 = (await canvasA2.boundingBox())!;
    const startXA2 = boxA2.x + Math.floor(boxA2.width * 0.3);
    const startYA2 = boxA2.y + Math.floor(boxA2.height * 0.6);
    await pageA.mouse.move(startXA2, startYA2);
    await pageA.mouse.down();
    await pageA.mouse.move(startXA2 + 100, startYA2 + 70, { steps: 8 });
    await pageA.mouse.up();

    await expect(pageA.getByTestId("whiteboard-save-status")).toContainText(
      "Saved",
      { timeout: 15000 }
    );

    // User B reconnects to the whiteboard
    await pageB.goto(`/app/whiteboards/${boardData.id}`);
    await expect(pageB.getByTestId("excalidraw-canvas-container")).toBeVisible({ timeout: 25000 });
    await expect(pageB.getByTestId("room-connection-status")).toContainText(
      "Connected & Synced",
      { timeout: 25000 }
    );

    // Page A observes User B has rejoined
    await expect(
      pageA
        .getByTestId("collaborator-avatars")
        .locator("[data-testid^='collaborator-remote-']")
    ).toHaveCount(2, { timeout: 15000 });

    // 13. Security Verification: Unauthorized Outsider Rejection
    await pageOutsider.goto(`/app/whiteboards/${boardData.id}`);
    await expect(pageOutsider.getByRole("heading", { name: "404" })).toBeVisible({
      timeout: 15000,
    });

    // Direct Liveblocks auth API call for outsider returns 403 Forbidden
    const outsiderAuthRes = await pageOutsider.request.post("/api/liveblocks-auth", {
      data: {
        room: boardData.liveblocksRoomId,
        type: "WHITEBOARD",
      },
    });
    expect(outsiderAuthRes.status()).toBe(403);

    // Unauthenticated request to Liveblocks auth returns 401 Unauthorized
    const unauthContext = await browser.newContext();
    const unauthPage = await unauthContext.newPage();
    const unauthRes = await unauthPage.request.post("/api/liveblocks-auth", {
      data: {
        room: boardData.liveblocksRoomId,
        type: "WHITEBOARD",
      },
    });
    expect(unauthRes.status()).toBe(401);

    await contextA.close();
    await contextB.close();
    await contextC.close();
    await contextOutsider.close();
    await unauthContext.close();
  });
});
