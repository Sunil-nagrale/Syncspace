import "dotenv/config";
import { test, expect } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { ArtifactService } from "../../src/services/artifact.service";

test.describe("SyncSpace Phase 10A — Full-Text Search & Global Command Palette E2E", () => {
  const createdUserEmails: string[] = [];
  const createdWorkspaceIds: string[] = [];

  test.afterAll(async () => {
    if (createdWorkspaceIds.length > 0) {
      for (const wid of createdWorkspaceIds) {
        await prisma.workspace.delete({ where: { id: wid } }).catch(() => {});
      }
    }
    if (createdUserEmails.length > 0) {
      await prisma.user
        .deleteMany({
          where: { email: { in: createdUserEmails } },
        })
        .catch(() => {});
    }
    await prisma.$disconnect();
  });

  test("1. Opens/closes via Ctrl+K without interfering with editor typing, searches Document/Whiteboard/Project content, supports keyboard navigation, and handles empty states", async ({
    browser,
  }) => {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);
    const ownerEmail = `search.e2e.owner.${timestamp}.${rand}@syncspace.dev`;
    const password = "SearchPassword123!";
    createdUserEmails.push(ownerEmail);

    const context = await browser.newContext();
    const page = await context.newPage();

    // 1. Register user
    await page.goto("/register");
    await page.getByPlaceholder("Sunil Kumar").fill("Aria SearchLead");
    await page.getByPlaceholder("name@company.com").fill(ownerEmail);
    await page.getByPlaceholder("Minimum 8 characters").fill(password);
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page).toHaveURL(/\/app/);

    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: ownerEmail },
    });

    // Find or create workspace for this user
    let membership = await prisma.workspaceMember.findFirst({
      where: { userId: owner.id },
      include: { workspace: true },
    });

    if (!membership) {
      const ws = await prisma.workspace.create({
        data: {
          name: `Search E2E Workspace ${rand}`,
          slug: `search-e2e-ws-${timestamp}-${rand}`,
          createdById: owner.id,
          members: {
            create: {
              userId: owner.id,
              role: "OWNER",
            },
          },
        },
      });
      createdWorkspaceIds.push(ws.id);
      membership = await prisma.workspaceMember.findFirstOrThrow({
        where: { userId: owner.id, workspaceId: ws.id },
        include: { workspace: true },
      });
    } else {
      createdWorkspaceIds.push(membership.workspaceId);
    }

    const workspaceId = membership.workspaceId;
    const sharedKeyword = `nebula_${timestamp}`;
    const docBodyKeyword = `krypton_consensus_${timestamp}`;
    const boardElementKeyword = `zephyr_gateway_${timestamp}`;
    const deletedBoardKeyword = `ghost_deleted_${timestamp}`;

    // Seed Project, Document (with rich-text body), and Whiteboard (with active + deleted text elements)
    const project = await prisma.project.create({
      data: {
        workspaceId,
        createdById: owner.id,
        name: `Project ${sharedKeyword} Core`,
        description: `Distributed infrastructure roadmap for ${sharedKeyword}.`,
      },
    });

    const doc = await ArtifactService.createArtifact(owner.id, {
      workspaceId,
      projectId: project.id,
      type: "DOCUMENT",
      title: `Architecture RFC ${sharedKeyword}`,
      description: "Multi-region storage specification",
    });

    await ArtifactService.updateArtifact(owner.id, doc.id, {
      contentSnapshot: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Replication Guarantees" }],
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: `Verified ${docBodyKeyword} state machine safety across availability zones.`,
              },
            ],
          },
        ],
      },
    });

    const editorDoc = await ArtifactService.createArtifact(owner.id, {
      workspaceId,
      type: "DOCUMENT",
      title: "Interactive Typing Sandbox",
      description: "Editor keyboard test document",
    });

    const board = await ArtifactService.createArtifact(owner.id, {
      workspaceId,
      projectId: project.id,
      type: "WHITEBOARD",
      title: `System Topology ${sharedKeyword}`,
      description: "Service mesh diagram",
    });

    await ArtifactService.updateArtifact(owner.id, board.id, {
      contentSnapshot: {
        elements: [
          {
            id: "canvas-text-1",
            type: "text",
            text: `Active Node ${boardElementKeyword}`,
            originalText: `Active Node ${boardElementKeyword}`,
            isDeleted: false,
          },
          {
            id: "canvas-text-2",
            type: "text",
            text: `Removed Node ${deletedBoardKeyword}`,
            originalText: `Removed Node ${deletedBoardKeyword}`,
            isDeleted: true,
          },
        ],
      },
    });

    // Navigate to editorDoc and verify normal typing of 'k' does NOT trigger Command Palette
    await page.goto(`/app/documents/${editorDoc.id}`);
    const editor = page.locator(".ProseMirror").first();
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.click();
    await page.keyboard.type("Checking normal keyboard k typing in editor");
    await expect(page.getByTestId("command-palette-input")).toHaveCount(0);

    // 2. Press Ctrl+K to open the Command Palette
    await page.keyboard.press("Control+k");
    const paletteInput = page.getByTestId("command-palette-input");
    await expect(paletteInput).toBeVisible();

    // Press Escape to close, then reopen via Ctrl+K
    await page.keyboard.press("Escape");
    await expect(paletteInput).toHaveCount(0);

    await page.keyboard.press("Control+k");
    await expect(paletteInput).toBeVisible();

    // 3. Search by shared keyword and verify Document, Whiteboard, and Project all appear
    await paletteInput.fill(sharedKeyword);
    const results = page.getByTestId("command-palette-result-item");
    await expect(results).toHaveCount(3, { timeout: 10000 });

    // Filter by WHITEBOARD only
    await page.getByTestId("command-palette-filter-WHITEBOARD").click();
    await expect(results).toHaveCount(1);
    await expect(results.first()).toContainText(`System Topology ${sharedKeyword}`);

    // Reset filter to ALL
    await page.getByTestId("command-palette-filter-ALL").click();
    await expect(results).toHaveCount(3);

    // 4. Search by Whiteboard canvas text element and navigate using keyboard (ArrowDown / Enter)
    await paletteInput.fill(boardElementKeyword);
    await expect(results).toHaveCount(1);
    await expect(results.first()).toContainText(`System Topology ${sharedKeyword}`);
    await expect(
      page.getByTestId("command-palette-result-excerpt").first()
    ).toContainText(boardElementKeyword);

    await paletteInput.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/app/whiteboards/${board.id}`), {
      timeout: 15000,
    });

    // 5. Reopen Command Palette, verify deleted whiteboard element is not returned (empty state)
    await page.keyboard.press("Control+k");
    await expect(paletteInput).toBeVisible();
    await paletteInput.fill(deletedBoardKeyword);
    await expect(page.getByTestId("command-palette-empty")).toBeVisible({
      timeout: 10000,
    });

    // 6. Search by Document body text and navigate to Document
    await paletteInput.fill(docBodyKeyword);
    await expect(results).toHaveCount(1);
    await expect(results.first()).toContainText(`Architecture RFC ${sharedKeyword}`);
    await results.first().click();
    await expect(page).toHaveURL(new RegExp(`/app/documents/${doc.id}`), {
      timeout: 15000,
    });

    // 7. Reopen Command Palette, filter by PROJECT, and navigate to Project page
    await page.keyboard.press("Control+k");
    await expect(paletteInput).toBeVisible();
    await page.getByTestId("command-palette-filter-PROJECT").click();
    await paletteInput.fill(sharedKeyword);
    await expect(results).toHaveCount(1);
    await results.first().click();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${project.id}`), {
      timeout: 15000,
    });

    await context.close();
  });

  test("2. Enforces RBAC and workspace isolation: restricted (NONE) artifacts and other workspaces never leak in search results", async ({
    browser,
  }) => {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);
    const ownerEmail = `search.rbac.owner.${timestamp}.${rand}@syncspace.dev`;
    const memberEmail = `search.rbac.member.${timestamp}.${rand}@syncspace.dev`;
    const outsiderEmail = `search.rbac.outsider.${timestamp}.${rand}@syncspace.dev`;
    const password = "SearchPassword123!";

    createdUserEmails.push(ownerEmail, memberEmail, outsiderEmail);

    const ownerCtx = await browser.newContext();
    const memberCtx = await browser.newContext();
    const outsiderCtx = await browser.newContext();

    const ownerPage = await ownerCtx.newPage();
    const memberPage = await memberCtx.newPage();
    const outsiderPage = await outsiderCtx.newPage();

    // Register all three users
    for (const [pg, name, email] of [
      [ownerPage, "Owner RBAC", ownerEmail],
      [memberPage, "Member RBAC", memberEmail],
      [outsiderPage, "Outsider RBAC", outsiderEmail],
    ] as const) {
      await pg.goto("/register");
      await pg.getByPlaceholder("Sunil Kumar").fill(name);
      await pg.getByPlaceholder("name@company.com").fill(email);
      await pg.getByPlaceholder("Minimum 8 characters").fill(password);
      await pg.getByRole("button", { name: /create account/i }).click();
      await expect(pg).toHaveURL(/\/app/);
    }

    const [owner, member, outsider] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } }),
      prisma.user.findUniqueOrThrow({ where: { email: memberEmail } }),
      prisma.user.findUniqueOrThrow({ where: { email: outsiderEmail } }),
    ]);

    const wsA = await prisma.workspace.create({
      data: {
        name: `RBAC Workspace A ${rand}`,
        slug: `rbac-ws-a-${timestamp}-${rand}`,
        createdById: owner.id,
        members: {
          create: [
            { userId: owner.id, role: "OWNER" },
            { userId: member.id, role: "EDITOR" },
          ],
        },
      },
    });
    createdWorkspaceIds.push(wsA.id);

    const secretToken = `topsecret_falcon_${timestamp}`;

    const sharedDoc = await ArtifactService.createArtifact(owner.id, {
      workspaceId: wsA.id,
      type: "DOCUMENT",
      title: `Shared Engineering Spec ${secretToken}`,
    });

    const restrictedDoc = await ArtifactService.createArtifact(owner.id, {
      workspaceId: wsA.id,
      type: "DOCUMENT",
      title: `Restricted Board Deck ${secretToken}`,
      description: `Confidential merger notes ${secretToken}`,
    });

    await prisma.artifactPermission.create({
      data: {
        artifactId: restrictedDoc.id,
        userId: member.id,
        role: "NONE",
      },
    });

    // Member opens Command Palette and searches for secretToken -> sees ONLY sharedDoc, never restrictedDoc
    await memberPage.goto("/app");
    await expect(
      memberPage.getByRole("heading", { name: wsA.name })
    ).toBeVisible({ timeout: 15000 });
    await memberPage.getByTestId("header-search-trigger").click();
    const memberInput = memberPage.getByTestId("command-palette-input");
    await expect(memberInput).toBeVisible();
    await memberInput.fill(secretToken);

    const memberResults = memberPage.getByTestId("command-palette-result-item");
    await expect(memberResults).toHaveCount(1, { timeout: 10000 });
    await expect(memberResults.first()).toContainText(sharedDoc.title);
    await expect(memberPage.getByTestId("command-palette-dialog")).not.toContainText(
      "Restricted Board Deck"
    );

    // Outsider searches for secretToken via Command Palette -> sees empty state (0 results)
    await outsiderPage.goto("/app");
    await expect(outsiderPage.getByTestId("header-search-trigger")).toBeVisible({
      timeout: 15000,
    });
    await outsiderPage.getByTestId("header-search-trigger").click();
    const outsiderInput = outsiderPage.getByTestId("command-palette-input");
    await expect(outsiderInput).toBeVisible();
    await outsiderInput.fill(secretToken);

    await expect(outsiderPage.getByTestId("command-palette-empty")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      outsiderPage.getByTestId("command-palette-result-item")
    ).toHaveCount(0);

    // Direct API call by outsider with workspaceId=wsA.id returns 404
    const crossTenantRes = await outsiderPage.request.get(
      `/api/search?q=${encodeURIComponent(secretToken)}&workspaceId=${wsA.id}`
    );
    expect(crossTenantRes.status()).toBe(404);

    await ownerCtx.close();
    await memberCtx.close();
    await outsiderCtx.close();
  });
});
