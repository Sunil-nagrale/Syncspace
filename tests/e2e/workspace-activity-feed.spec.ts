import "dotenv/config";
import { test, expect } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { ArtifactService } from "../../src/services/artifact.service";
import { CommentService } from "../../src/services/comment.service";
import { VersionService } from "../../src/services/version.service";
import { AttachmentService } from "../../src/services/attachment.service";

const SAMPLE_PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex"
);

test.describe("SyncSpace Phase 10B — Secure Workspace Activity Feed E2E", () => {
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

  test("1. Displays real workspace activity events in reverse chronological order, filters by category, and navigates safely to authorized targets", async ({
    browser,
  }) => {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);
    const ownerEmail = `activity.e2e.owner.${timestamp}.${rand}@syncspace.dev`;
    const password = "ActivityPassword123!";
    createdUserEmails.push(ownerEmail);

    const context = await browser.newContext();
    const page = await context.newPage();

    // 1. Register user
    await page.goto("/register");
    await page.getByPlaceholder("Sunil Kumar").fill("Elena ActivityLead");
    await page.getByPlaceholder("name@company.com").fill(ownerEmail);
    await page.getByPlaceholder("Minimum 8 characters").fill(password);
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page).toHaveURL(/\/app/);

    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: ownerEmail },
    });

    // Ensure workspace exists for owner
    let membership = await prisma.workspaceMember.findFirst({
      where: { userId: owner.id },
      include: { workspace: true },
    });

    if (!membership) {
      const ws = await prisma.workspace.create({
        data: {
          name: `Activity E2E Workspace ${rand}`,
          slug: `activity-e2e-ws-${timestamp}-${rand}`,
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
    const docTitle = ` Distributed Consensus Spec ${rand}`;

    // 2. Perform real workspace actions (create document, comment thread, manual version checkpoint, attachment upload)
    const doc = await ArtifactService.createArtifact(owner.id, {
      workspaceId,
      title: docTitle.trim(),
      type: "DOCUMENT",
    });

    await CommentService.createThread({
      actorUserId: owner.id,
      artifactId: doc.id,
      content: "Please review section 2 before sign-off.",
      anchorType: "GENERAL",
    });

    await VersionService.createCheckpoint(owner.id, doc.id, {
      source: "MANUAL",
      title: `Consensus Milestone ${rand}`,
      snapshotData: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Milestone v2 consensus draft" }],
          },
        ],
      },
    });

    const attachmentFileName = `consensus-diagram-${rand}.png`;
    await AttachmentService.uploadAttachment(owner.id, doc.id, {
      fileName: attachmentFileName,
      fileType: "image/png",
      bytes: new Uint8Array(SAMPLE_PNG_BYTES),
    });

    // 3. Load the workspace dashboard and verify WorkspaceActivityFeed renders all events in reverse chronological order
    await page.goto(`/app?workspaceId=${workspaceId}`);

    const feedCard = page.getByTestId("workspace-activity-feed");
    await expect(feedCard).toBeVisible();

    const feedItems = feedCard.getByTestId("activity-feed-item");
    await expect(feedItems.first()).toBeVisible();

    // Most recent event is the attachment upload, followed by manual version checkpoint, comment thread, and document creation
    await expect(feedItems.nth(0)).toContainText(attachmentFileName);
    await expect(feedItems.nth(1)).toContainText("saved version");
    await expect(feedItems.nth(2)).toContainText("started a discussion thread");
    await expect(feedItems.nth(3)).toContainText(docTitle.trim());

    // 4. Filter by Comments category
    await feedCard.getByTestId("activity-filter-comment").click();
    await expect(feedItems).toHaveCount(1);
    await expect(feedItems.first()).toContainText("started a discussion thread");

    // 5. Filter by Versions category
    await feedCard.getByTestId("activity-filter-version").click();
    await expect(feedItems).toHaveCount(1);
    await expect(feedItems.first()).toContainText("saved version");

    // 6. Filter by Attachments category
    await feedCard.getByTestId("activity-filter-attachment").click();
    await expect(feedItems).toHaveCount(1);
    await expect(feedItems.first()).toContainText(attachmentFileName);

    // 7. Click safe target link to navigate directly to the authorized document
    const targetLink = feedItems.first().getByTestId("activity-target-link");
    await expect(targetLink).toHaveAttribute("href", `/app/documents/${doc.id}`);
    await targetLink.click();
    await expect(page).toHaveURL(new RegExp(`/app/documents/${doc.id}`));

    await context.close();
  });

  test("2. Prevents unauthorized users (NONE artifact override and non-workspace outsiders) from seeing restricted activity events in UI or API", async ({
    browser,
  }) => {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);
    const ownerEmail = `activity.rbac.owner.${timestamp}.${rand}@syncspace.dev`;
    const memberEmail = `activity.rbac.member.${timestamp}.${rand}@syncspace.dev`;
    const outsiderEmail = `activity.rbac.outsider.${timestamp}.${rand}@syncspace.dev`;
    const password = "ActivityPassword123!";
    createdUserEmails.push(ownerEmail, memberEmail, outsiderEmail);

    const registerUserInContext = async (name: string, email: string) => {
      const ctx = await browser.newContext();
      const pg = await ctx.newPage();
      await pg.goto("/register");
      await pg.getByPlaceholder("Sunil Kumar").fill(name);
      await pg.getByPlaceholder("name@company.com").fill(email);
      await pg.getByPlaceholder("Minimum 8 characters").fill(password);
      await pg.getByRole("button", { name: /create account/i }).click();
      await expect(pg).toHaveURL(/\/app/);
      return { ctx, pg };
    };

    const ownerSession = await registerUserInContext("Owner RBAC", ownerEmail);
    const memberSession = await registerUserInContext("Restricted Member", memberEmail);
    const outsiderSession = await registerUserInContext("Outsider User", outsiderEmail);

    const [owner, member] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } }),
      prisma.user.findUniqueOrThrow({ where: { email: memberEmail } }),
    ]);

    const workspace = await prisma.workspace.create({
      data: {
        name: `RBAC Activity E2E ${rand}`,
        slug: `rbac-activity-e2e-${timestamp}-${rand}`,
        createdById: owner.id,
        members: {
          create: [
            { userId: owner.id, role: "OWNER" },
            { userId: member.id, role: "EDITOR" },
          ],
        },
      },
    });
    createdWorkspaceIds.push(workspace.id);

    const visibleTitle = `Shared Engineering Roadmap ${rand}`;
    const secretTitle = `Confidential Board Acquisition ${rand}`;
    const secretAttachmentName = `confidential-merger-${rand}.png`;

    await ArtifactService.createArtifact(owner.id, {
      workspaceId: workspace.id,
      title: visibleTitle,
      type: "DOCUMENT",
    });

    const secretDoc = await ArtifactService.createArtifact(owner.id, {
      workspaceId: workspace.id,
      title: secretTitle,
      type: "DOCUMENT",
    });

    await CommentService.createThread({
      actorUserId: owner.id,
      artifactId: secretDoc.id,
      content: "Top secret acquisition note",
    });

    await AttachmentService.uploadAttachment(owner.id, secretDoc.id, {
      fileName: secretAttachmentName,
      fileType: "image/png",
      bytes: new Uint8Array(SAMPLE_PNG_BYTES),
    });

    // Apply explicit NONE override for member on secretDoc
    await ArtifactService.setArtifactPermission(
      owner.id,
      secretDoc.id,
      member.id,
      "NONE"
    );

    // 1. Restricted member visits /app?workspaceId=... -> sees visibleTitle activity, never sees secretTitle or secretAttachmentName
    await memberSession.pg.goto(`/app?workspaceId=${workspace.id}`);
    const feedCard = memberSession.pg.getByTestId("workspace-activity-feed");
    await expect(feedCard).toBeVisible();
    await expect(feedCard).toContainText(visibleTitle);
    await expect(feedCard).not.toContainText(secretTitle);
    await expect(feedCard).not.toContainText(secretAttachmentName);

    // Direct API query by restricted member must also exclude all secretDoc events
    const memberApiRes = await memberSession.pg.request.get(
      `/api/workspaces/${workspace.id}/activity?limit=50`
    );
    expect(memberApiRes.status()).toBe(200);
    const memberApiBody = await memberApiRes.text();
    expect(memberApiBody).toContain(visibleTitle);
    expect(memberApiBody).not.toContain(secretTitle);
    expect(memberApiBody).not.toContain(secretAttachmentName);
    expect(memberApiBody).not.toContain(secretDoc.id);

    // 2. Outsider receives 404 on GET /api/workspaces/[workspaceId]/activity
    const outsiderApiRes = await outsiderSession.pg.request.get(
      `/api/workspaces/${workspace.id}/activity`
    );
    expect(outsiderApiRes.status()).toBe(404);

    await ownerSession.ctx.close();
    await memberSession.ctx.close();
    await outsiderSession.ctx.close();
  });
});
