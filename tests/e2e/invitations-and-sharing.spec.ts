import "dotenv/config";
import { test, expect } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";

test.describe("Phase 7A — Workspace Invitations and Artifact Sharing E2E", () => {
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

  test("Complete invitation flow: generate link, unauth prompt, register matching account, accept, and verify multi-user membership", async ({
    browser,
  }) => {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);

    const ownerEmail = `owner.${timestamp}.${rand}@syncspace.dev`;
    const ownerName = `Workspace Owner ${rand}`;
    const inviteeEmail = `invitee.${timestamp}.${rand}@syncspace.dev`;
    const inviteeName = `Invited Member ${rand}`;
    const password = "ValidPassword123!";

    createdUserEmails.push(ownerEmail, inviteeEmail);

    // 1. Owner registers and sets up workspace
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();

    await ownerPage.goto("/register");
    await ownerPage.getByPlaceholder("Sunil Kumar").fill(ownerName);
    await ownerPage.getByPlaceholder("name@company.com").fill(ownerEmail);
    await ownerPage.getByPlaceholder("Minimum 8 characters").fill(password);
    await ownerPage.getByRole("button", { name: /create account/i }).click();

    await expect(ownerPage).toHaveURL(/\/app/);

    // Owner creates a workspace
    const createWsRes = await ownerPage.request.post("/api/workspaces", {
      data: {
        name: `Acme Space ${rand}`,
        createDefaultProject: true,
      },
    });
    expect(createWsRes.status()).toBe(201);
    const wsJson = await createWsRes.json();
    const workspaceId = wsJson.data.id;

    // Navigate to members page
    await ownerPage.goto(`/app/members?workspace=${workspaceId}`);
    await expect(ownerPage.locator("h1")).toContainText("Members");

    // Open Invite Member dialog
    const inviteBtn = ownerPage.locator('[data-testid="invite-member-button"]');
    await expect(inviteBtn).toBeVisible({ timeout: 15000 });
    await inviteBtn.click();
    await expect(ownerPage.getByText("Invite Team Member")).toBeVisible();

    // Fill invitee email and select role
    await ownerPage.locator('[data-testid="invite-email-input"]').fill(inviteeEmail);
    await ownerPage.locator('[data-testid="invite-role-select"]').selectOption("EDITOR");

    // Click Generate Invitation Link
    await ownerPage.locator('[data-testid="generate-invite-button"]').click();

    // Verify invitation link is generated and copyable
    const inviteUrlInput = ownerPage.locator('[data-testid="generated-invite-url"]');
    await expect(inviteUrlInput).toBeVisible({ timeout: 10000 });
    const inviteUrl = await inviteUrlInput.inputValue();
    expect(inviteUrl).toContain("/app/invitations/");

    // Extract raw token from inviteUrl
    const rawToken = inviteUrl.split("/app/invitations/")[1];
    expect(rawToken).toBeTruthy();

    // Close modal
    await ownerPage.getByRole("button", { name: "Done" }).click();

    // 2. Invitee opens invitation in a separate clean browser context
    const inviteeContext = await browser.newContext();
    const inviteePage = await inviteeContext.newPage();

    await inviteePage.goto(`/app/invitations/${rawToken}`);

    // Verify unauthenticated banner and workspace info
    await expect(
      inviteePage.getByText(new RegExp(`Join Acme Space ${rand}`, "i"))
    ).toBeVisible({ timeout: 15000 });
    await expect(inviteePage.getByText(/You must sign in with/i)).toBeVisible();
    await expect(inviteePage.getByText(inviteeEmail).first()).toBeVisible();

    // Invitee creates their account

    await inviteePage.getByRole("link", { name: /create account/i }).click();
    await expect(inviteePage).toHaveURL(/\/register/);

    await inviteePage.getByPlaceholder("Sunil Kumar").fill(inviteeName);
    await inviteePage.getByPlaceholder("name@company.com").fill(inviteeEmail);
    await inviteePage.getByPlaceholder("Minimum 8 characters").fill(password);
    await inviteePage.getByRole("button", { name: /create account/i }).click();
    await expect(inviteePage).toHaveURL(/\/app/, { timeout: 15000 });

    // Navigate back to the invitation page with authenticated session
    await inviteePage.goto(`/app/invitations/${rawToken}`);

    // Verify authenticated state shows matching email and Accept button
    await expect(inviteePage.getByText("Verified Match")).toBeVisible({ timeout: 15000 });
    const acceptBtn = inviteePage.locator('[data-testid="accept-invitation-button"]');
    await expect(acceptBtn).toBeVisible();

    // Click Accept & Join
    await acceptBtn.click();
    await expect(inviteePage.getByText("Invitation accepted!")).toBeVisible();

    // Invitee arrives at workspace
    await expect(inviteePage).toHaveURL(/\/app/, { timeout: 15000 });

    // 3. Verify membership persisted in PostgreSQL
    const dbInvitee = await prisma.user.findUnique({
      where: { email: inviteeEmail },
    });
    expect(dbInvitee).not.toBeNull();

    const membership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: dbInvitee!.id,
        },
      },
    });
    expect(membership).not.toBeNull();
    expect(membership?.role).toBe("EDITOR");

    // 4. Invitee visits /app/members and sees both active members
    await inviteePage.goto(`/app/members?workspace=${workspaceId}`);
    await expect(
      inviteePage.getByRole("table").getByText(ownerName)
    ).toBeVisible({ timeout: 15000 });
    await expect(
      inviteePage.getByRole("table").getByText(inviteeName)
    ).toBeVisible({ timeout: 15000 });

    // Invitee (EDITOR) cannot invite other members

    await expect(
      inviteePage.locator('[data-testid="invite-member-button"]')
    ).toHaveCount(0);

    await ownerContext.close();
    await inviteeContext.close();
  });

  test("Artifact permission overrides: explicit VIEWER override enforces read-only banner and restricts mutation", async ({
    browser,
  }) => {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);

    const ownerEmail = `owner.doc.${timestamp}.${rand}@syncspace.dev`;
    const editorEmail = `editor.doc.${timestamp}.${rand}@syncspace.dev`;
    const password = "ValidPassword123!";

    createdUserEmails.push(ownerEmail, editorEmail);

    // 1. Create editor user via UI registration first (ensures proper Better Auth account)
    const editorContext = await browser.newContext();
    const editorPage = await editorContext.newPage();

    await editorPage.goto("/register");
    await editorPage.getByPlaceholder("Sunil Kumar").fill(`Editor ${rand}`);
    await editorPage.getByPlaceholder("name@company.com").fill(editorEmail);
    await editorPage.getByPlaceholder("Minimum 8 characters").fill(password);
    await editorPage.getByRole("button", { name: /create account/i }).click();
    await expect(editorPage).toHaveURL(/\/app/);

    const dbEditorUser = await prisma.user.findUnique({
      where: { email: editorEmail },
    });
    expect(dbEditorUser).not.toBeNull();

    // 2. Create owner user and workspace in PostgreSQL
    const owner = await prisma.user.create({
      data: {
        name: `Owner ${rand}`,
        email: ownerEmail,
        color: "#6366F1",
      },
    });

    const workspace = await prisma.workspace.create({
      data: {
        name: `Sharing Test Space ${rand}`,
        slug: `sharing-space-${rand}`,
        createdById: owner.id,
        members: {
          create: [
            { userId: owner.id, role: "OWNER" },
            { userId: dbEditorUser!.id, role: "EDITOR" },
          ],
        },
      },
    });

    // Create a document artifact
    const artifact = await prisma.artifact.create({
      data: {
        workspaceId: workspace.id,
        type: "DOCUMENT",
        title: `Collaborative Spec ${rand}`,
        liveblocksRoomId: `art_doc_${timestamp}_${rand}`,
        createdById: owner.id,
      },
    });

    // 3. Owner applies VIEWER override to the artifact via API
    await prisma.artifactPermission.create({
      data: {
        artifactId: artifact.id,
        userId: dbEditorUser!.id,
        role: "VIEWER",
      },
    });

    // Editor navigates to the document
    await editorPage.goto(`/app/documents/${artifact.id}`);

    // Editor sees read-only banner
    await expect(
      editorPage.locator('[data-testid="viewer-readonly-banner"]')
    ).toBeVisible({ timeout: 15000 });
    await expect(
      editorPage.locator('[data-testid="viewer-readonly-banner"]')
    ).toContainText(/read-only access/i);


    // Editor attempts direct mutation via API -> rejected with 403
    const directUpdateRes = await editorPage.request.patch(
      `/api/artifacts/${artifact.id}`,
      {
        data: { title: "Hacked Title" },
      }
    );
    expect(directUpdateRes.status()).toBe(403);


    // 3. Owner applies explicit NONE override (revocation)
    await prisma.artifactPermission.update({
      where: {
        artifactId_userId: {
          artifactId: artifact.id,
          userId: dbEditorUser!.id,
        },
      },
      data: {
        role: "NONE",
      },
    });


    // Editor reloads page -> access denied
    await editorPage.reload();
    await expect(editorPage.getByText(/access.*revoked|not found/i)).toBeVisible();

    await editorContext.close();
  });
});
