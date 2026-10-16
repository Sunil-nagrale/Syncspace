import "dotenv/config";
import { test, expect } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";

test.describe("SyncSpace Phase 8B — @Mentions and In-App Notifications E2E", () => {
  const createdUserEmails: string[] = [];

  test.afterAll(async () => {
    if (createdUserEmails.length > 0) {
      const users = await prisma.user.findMany({
        where: { email: { in: createdUserEmails } },
        select: { id: true },
      });
      const userIds = users.map((u) => u.id);

      if (userIds.length > 0) {
        // Clean up notifications, comments, threads, members, workspaces, users
        await prisma.notification.deleteMany({
          where: {
            OR: [
              { recipientId: { in: userIds } },
              { actorId: { in: userIds } },
            ],
          },
        });
        await prisma.commentThreadEvent.deleteMany({
          where: { userId: { in: userIds } },
        });
        await prisma.commentReaction.deleteMany({
          where: { userId: { in: userIds } },
        });
        await prisma.comment.deleteMany({
          where: { authorId: { in: userIds } },
        });
        await prisma.commentThread.deleteMany({
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

  test("Core Acceptance Scenario: User A mentions User B -> User B receives notification, sees unread badge, clicks notification in popover, and reaches discussion thread", async ({
    browser,
  }) => {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);

    const userAEmail = `notif.alice.${timestamp}.${rand}@syncspace.dev`;
    const userBEmail = `notif.bob.${timestamp}.${rand}@syncspace.dev`;
    const password = "MentionPassword123!";

    createdUserEmails.push(userAEmail, userBEmail);

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // 1. Register User A (Alice Architect)
    await pageA.goto("/register");
    await pageA.getByPlaceholder("Sunil Kumar").fill("Alice Architect");
    await pageA.getByPlaceholder("name@company.com").fill(userAEmail);
    await pageA.getByPlaceholder("Minimum 8 characters").fill(password);
    await pageA.getByRole("button", { name: /create account/i }).click();
    await expect(pageA).toHaveURL(/\/app/, { timeout: 15000 });

    // 2. Register User B (Bob Builder)
    await pageB.goto("/register");
    await pageB.getByPlaceholder("Sunil Kumar").fill("Bob Builder");
    await pageB.getByPlaceholder("name@company.com").fill(userBEmail);
    await pageB.getByPlaceholder("Minimum 8 characters").fill(password);
    await pageB.getByRole("button", { name: /create account/i }).click();
    await expect(pageB).toHaveURL(/\/app/, { timeout: 15000 });

    // 3. User A creates Workspace
    const workspaceName = `Mention Collaboration Space ${rand}`;
    const createWsRes = await pageA.request.post("/api/workspaces", {
      data: {
        name: workspaceName,
        createDefaultProject: true,
      },
    });
    expect(createWsRes.status()).toBe(201);
    const wsJson = await createWsRes.json();
    const workspaceId = wsJson.data.id;

    // 4. Add User B to Workspace as EDITOR via database
    const userBRecord = await prisma.user.findUniqueOrThrow({
      where: { email: userBEmail },
    });

    await prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: userBRecord.id,
        role: "EDITOR",
      },
    });

    // 5. User A creates a Document Artifact
    await pageA.goto(`/app/documents?workspace=${workspaceId}`);
    await expect(pageA.locator("h1")).toContainText("Documents");

    const docTitle = `Microservices Notification Architecture ${rand}`;
    await pageA.getByTestId("create-document-btn").click();
    await pageA.getByTestId("new-document-title-input").fill(docTitle);
    await pageA.getByTestId("confirm-create-document-btn").click();

    await expect(pageA).toHaveURL(/\/app\/documents\/.+/);
    await expect(pageA.getByTestId("document-title-heading")).toHaveText(docTitle);

    const docUrl = pageA.url();
    const documentId = docUrl.split("/app/documents/")[1].split("?")[0];
    expect(documentId).toBeTruthy();

    // 6. Open Discussion Panel on Document
    const toggleCommentsBtn = pageA.getByTestId("toggle-comments-button");
    await expect(toggleCommentsBtn).toBeVisible();
    await toggleCommentsBtn.click();

    const commentsPanel = pageA.getByTestId("comments-panel");
    await expect(commentsPanel).toBeVisible();

    // 7. User A triggers mention autocomplete by typing @
    const threadTextarea = pageA.getByTestId("new-thread-textarea");
    await expect(threadTextarea).toBeVisible();

    await threadTextarea.fill("Review request: @");

    // Suggestion dropdown should pop up
    const autocompleteDropdown = pageA.getByTestId("mention-autocomplete-dropdown");
    await expect(autocompleteDropdown).toBeVisible({ timeout: 10000 });

    // Bob Builder suggestion should be listed
    const bobSuggestion = pageA.getByTestId(`mention-suggestion-${userBRecord.id}`);
    await expect(bobSuggestion).toBeVisible();
    await expect(bobSuggestion).toContainText("Bob Builder");

    // Click Bob Builder suggestion
    await bobSuggestion.click();

    // Verify textarea was updated with structured mention syntax
    const textareaVal = await threadTextarea.inputValue();
    expect(textareaVal).toContain(`@[Bob Builder](${userBRecord.id})`);

    // Complete the message and submit thread
    await threadTextarea.fill(
      `Hey @[Bob Builder](${userBRecord.id}), please review the security boundaries in this spec!`
    );
    const postBtn = pageA.getByTestId("new-thread-submit-button");
    await postBtn.click();

    // Verify thread is rendered with styled mention badge
    await expect(pageA.getByTestId("thread-list")).toContainText("@Bob Builder");
    await expect(pageA.getByTestId("thread-list")).toContainText(
      "please review the security boundaries in this spec!"
    );

    // 8. User B switches to their session and sees the unread badge
    await pageB.goto("/app");
    await pageB.waitForLoadState("domcontentloaded");

    const unreadBadge = pageB.getByTestId("notifications-unread-badge");
    await expect(unreadBadge).toBeVisible({ timeout: 10000 });
    await expect(unreadBadge).toHaveText("1");

    // 9. User B opens the notification popover
    const bellBtn = pageB.getByTestId("notifications-bell");
    await bellBtn.click();

    const notifPopover = pageB.getByTestId("notifications-popover");
    await expect(notifPopover).toBeVisible({ timeout: 5000 });

    // Verify notification content
    await expect(notifPopover).toContainText("Alice Architect");
    await expect(notifPopover).toContainText(docTitle);
    await expect(notifPopover).toContainText("please review the security boundaries");

    // 10. User B clicks the notification item
    const notifItem = notifPopover.locator('button[data-testid^="notification-item-"]').first();
    await notifItem.click();

    // 11. User B lands directly on the document with the discussion thread open
    await expect(pageB).toHaveURL(new RegExp(`/app/documents/${documentId}\\?thread=`));

    const userBCommentsPanel = pageB.getByTestId("comments-panel");
    await expect(userBCommentsPanel).toBeVisible({ timeout: 15000 });
    await expect(userBCommentsPanel).toContainText("@Bob Builder");
    await expect(userBCommentsPanel).toContainText("please review the security boundaries");

    // 12. Verify notification is marked as read
    await pageB.waitForTimeout(500);
    const unreadCountRes = await pageB.request.get("/api/notifications/unread-count");
    const unreadJson = await unreadCountRes.json();
    expect(unreadJson.data.unreadCount).toBe(0);

    // Cleanup contexts
    await contextA.close();
    await contextB.close();
  });
});
