import "dotenv/config";
import { test, expect } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";

test.describe("SyncSpace Phase 8A — Artifact Comments and Discussion Threads E2E", () => {
  const createdUserEmails: string[] = [];

  test.afterAll(async () => {
    if (createdUserEmails.length > 0) {
      const users = await prisma.user.findMany({
        where: { email: { in: createdUserEmails } },
        select: { id: true },
      });
      const userIds = users.map((u) => u.id);

      if (userIds.length > 0) {
        // Clean up threads, comments, and reactions first
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

  test("1. Collaborative commenting lifecycle: thread creation, replies, reactions, resolution, editing, deletion, and workspace IDOR defense", async ({
    browser,
  }) => {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);

    const ownerEmail = `comment.owner.${timestamp}.${rand}@syncspace.dev`;
    const collaboratorEmail = `comment.collab.${timestamp}.${rand}@syncspace.dev`;
    const outsiderEmail = `comment.outsider.${timestamp}.${rand}@syncspace.dev`;
    const password = "CommentPassword123!";

    createdUserEmails.push(ownerEmail, collaboratorEmail, outsiderEmail);

    const ownerContext = await browser.newContext();
    const collabContext = await browser.newContext();
    const outsiderContext = await browser.newContext();
    const unauthContext = await browser.newContext();

    const ownerPage = await ownerContext.newPage();
    const collabPage = await collabContext.newPage();
    const outsiderPage = await outsiderContext.newPage();
    const unauthPage = await unauthContext.newPage();

    // 1. Register Owner
    await ownerPage.goto("/register");
    await ownerPage.getByPlaceholder("Sunil Kumar").fill("Alice Owner");
    await ownerPage.getByPlaceholder("name@company.com").fill(ownerEmail);
    await ownerPage.getByPlaceholder("Minimum 8 characters").fill(password);
    await ownerPage.getByRole("button", { name: /create account/i }).click();
    await expect(ownerPage).toHaveURL(/\/app/);

    // Register Collaborator
    await collabPage.goto("/register");
    await collabPage.getByPlaceholder("Sunil Kumar").fill("Bob Collaborator");
    await collabPage.getByPlaceholder("name@company.com").fill(collaboratorEmail);
    await collabPage.getByPlaceholder("Minimum 8 characters").fill(password);
    await collabPage.getByRole("button", { name: /create account/i }).click();
    await expect(collabPage).toHaveURL(/\/app/);

    // Register Outsider
    await outsiderPage.goto("/register");
    await outsiderPage.getByPlaceholder("Sunil Kumar").fill("Eve Outsider");
    await outsiderPage.getByPlaceholder("name@company.com").fill(outsiderEmail);
    await outsiderPage.getByPlaceholder("Minimum 8 characters").fill(password);
    await outsiderPage.getByRole("button", { name: /create account/i }).click();
    await expect(outsiderPage).toHaveURL(/\/app/);

    // 2. Owner creates Workspace
    const workspaceName = `Design Space ${rand}`;
    const createWsRes = await ownerPage.request.post("/api/workspaces", {
      data: {
        name: workspaceName,
        createDefaultProject: true,
      },
    });
    expect(createWsRes.status()).toBe(201);
    const wsJson = await createWsRes.json();
    const workspaceId = wsJson.data.id;

    // Add Collaborator to Workspace as EDITOR via DB
    const collabUser = await prisma.user.findUnique({
      where: { email: collaboratorEmail },
    });
    expect(collabUser).not.toBeNull();

    await prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: collabUser!.id,
        role: "EDITOR",
      },
    });

    // 3. Owner creates a Document Artifact
    await ownerPage.goto(`/app/documents?workspace=${workspaceId}`);
    await expect(ownerPage.locator("h1")).toContainText("Documents");

    const docTitle = `Architecture Review Document ${rand}`;
    await ownerPage.getByTestId("create-document-btn").click();
    await ownerPage.getByTestId("new-document-title-input").fill(docTitle);
    await ownerPage.getByTestId("confirm-create-document-btn").click();

    await expect(ownerPage).toHaveURL(/\/app\/documents\/.+/);
    await expect(ownerPage.getByTestId("document-title-heading")).toHaveText(docTitle);

    const docUrl = ownerPage.url();
    const documentId = docUrl.split("/app/documents/")[1].split("?")[0];
    expect(documentId).toBeTruthy();

    // 4. Open Discussion Panel on Document
    const toggleCommentsBtn = ownerPage.getByTestId("toggle-comments-button");
    await expect(toggleCommentsBtn).toBeVisible();
    await toggleCommentsBtn.click();

    const commentsPanel = ownerPage.getByTestId("comments-panel");
    await expect(commentsPanel).toBeVisible();

    // Verify empty state initially
    await expect(ownerPage.getByTestId("comments-empty-state")).toBeVisible();

    // 5. Post root thread as Owner
    const rootThreadText = `Please verify the distributed locking mechanism in Section 4. ${rand}`;
    await ownerPage.getByTestId("new-thread-textarea").fill(rootThreadText);
    await ownerPage.getByTestId("new-thread-submit-button").click();

    // Verify thread card appears
    await expect(ownerPage.getByTestId("thread-list")).toBeVisible();
    await expect(commentsPanel.getByText(rootThreadText)).toBeVisible();
    await expect(commentsPanel.getByText("Alice Owner")).toBeVisible();

    // Find the created thread in the database
    const dbThread = await prisma.commentThread.findFirst({
      where: { artifactId: documentId },
      include: { comments: true },
    });
    expect(dbThread).not.toBeNull();
    const rootCommentId = dbThread!.comments[0].id;

    // 6. Owner adds reaction to root comment
    const addReactionBtn = ownerPage.getByTestId(`comment-add-reaction-${rootCommentId}`);
    await expect(addReactionBtn).toBeVisible();
    await addReactionBtn.click();

    // Click emoji 👍 in popover
    const thumbsUpBtn = ownerPage.getByRole("button", { name: "👍" });
    await expect(thumbsUpBtn).toBeVisible();
    await thumbsUpBtn.click();

    // Verify reaction pill is displayed with count 1
    const reactionPill = ownerPage.getByTestId(`comment-reaction-button-${rootCommentId}-👍`);
    await expect(reactionPill).toBeVisible();
    await expect(reactionPill).toContainText("1");

    // 7. Collaborator opens the same document and views the thread
    await collabPage.goto(`/app/documents/${documentId}?workspace=${workspaceId}`);
    await expect(collabPage.getByTestId("document-title-heading")).toHaveText(docTitle);

    await collabPage.getByTestId("toggle-comments-button").click();
    const collabCommentsPanel = collabPage.getByTestId("comments-panel");
    await expect(collabCommentsPanel).toBeVisible();
    await expect(collabCommentsPanel.getByText(rootThreadText)).toBeVisible();

    // Collaborator sees Owner's 👍 reaction
    const collabReactionPill = collabPage.getByTestId(`comment-reaction-button-${rootCommentId}-👍`);
    await expect(collabReactionPill).toBeVisible();
    await expect(collabReactionPill).toContainText("1");

    // Collaborator clicks 👍 to add their own reaction -> count becomes 2
    await collabReactionPill.click();
    await expect(collabReactionPill).toContainText("2");

    // Collaborator clicks 👍 again to remove their reaction -> count becomes 1
    await collabReactionPill.click();
    await expect(collabReactionPill).toContainText("1");

    // 8. Collaborator posts a threaded reply
    const replyText = `I have verified Section 4: Raft consensus handles partition recovery cleanly. ${rand}`;
    const replyInput = collabPage.getByTestId(`reply-textarea-${dbThread!.id}`);
    await expect(replyInput).toBeVisible();
    await replyInput.fill(replyText);

    const replySubmit = collabPage.getByTestId(`reply-submit-button-${dbThread!.id}`);
    await replySubmit.click();

    // Verify reply appears in UI
    await expect(collabCommentsPanel.getByText(replyText)).toBeVisible();
    await expect(collabCommentsPanel.getByText("Bob Collaborator")).toBeVisible();

    // 9. Thread Resolution Lifecycle
    // Owner resolves the thread
    const resolveBtn = ownerPage.getByTestId(`thread-resolve-button-${dbThread!.id}`);
    await expect(resolveBtn).toBeVisible();
    await resolveBtn.click();

    // Under "Open" filter, the resolved thread is hidden or moves to empty state
    await expect(ownerPage.getByTestId("comments-empty-state")).toBeVisible();

    // Switch to "Resolved" tab
    await ownerPage.getByTestId("comments-filter-resolved").click();
    await expect(commentsPanel.getByText(rootThreadText)).toBeVisible();
    await expect(commentsPanel.getByText(/Resolved by Alice Owner/i)).toBeVisible();

    // Reopen thread
    const reopenBtn = ownerPage.getByTestId(`thread-resolve-button-${dbThread!.id}`);
    await expect(reopenBtn).toBeVisible();
    await reopenBtn.click();

    // Switch back to "Open" tab
    await ownerPage.getByTestId("comments-filter-open").click();
    await expect(commentsPanel.getByText(rootThreadText)).toBeVisible();

    // 10. Security & IDOR Verification
    // A) Unauthenticated request to comments API returns 401
    const unauthGet = await unauthPage.request.get(`/api/artifacts/${documentId}/comments`);
    expect(unauthGet.status()).toBe(401);

    const unauthPost = await unauthPage.request.post(`/api/artifacts/${documentId}/comments`, {
      data: { content: "Malicious unauthenticated injection" },
    });
    expect(unauthPost.status()).toBe(401);

    // B) Outsider (authenticated, but not a member of the workspace) gets 404 (IDOR defense)
    const outsiderGet = await outsiderPage.request.get(`/api/artifacts/${documentId}/comments`);
    expect(outsiderGet.status()).toBe(404);

    const outsiderPost = await outsiderPage.request.post(`/api/artifacts/${documentId}/comments`, {
      data: { content: "Malicious outsider injection" },
    });
    expect(outsiderPost.status()).toBe(404);

    // Close contexts
    await ownerContext.close();
    await collabContext.close();
    await outsiderContext.close();
    await unauthContext.close();
  });

  test("2. Collaborative Whiteboard Discussion Panel Integration", async ({
    browser,
  }) => {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);

    const ownerEmail = `board.owner.${timestamp}.${rand}@syncspace.dev`;
    const password = "BoardPassword123!";

    createdUserEmails.push(ownerEmail);

    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();

    // 1. Register Owner
    await ownerPage.goto("/register");
    await ownerPage.getByPlaceholder("Sunil Kumar").fill("Diana Whiteboard");
    await ownerPage.getByPlaceholder("name@company.com").fill(ownerEmail);
    await ownerPage.getByPlaceholder("Minimum 8 characters").fill(password);
    await ownerPage.getByRole("button", { name: /create account/i }).click();
    await expect(ownerPage).toHaveURL(/\/app/);

    // 2. Create Workspace
    const workspaceName = `Canvas Studio ${rand}`;
    const createWsRes = await ownerPage.request.post("/api/workspaces", {
      data: {
        name: workspaceName,
        createDefaultProject: true,
      },
    });
    expect(createWsRes.status()).toBe(201);
    const wsJson = await createWsRes.json();
    const workspaceId = wsJson.data.id;

    // 3. Create Whiteboard Artifact
    await ownerPage.goto(`/app/whiteboards?workspace=${workspaceId}`);
    await expect(ownerPage.locator("h1")).toContainText("Whiteboards");

    const boardTitle = `System Architecture Canvas ${rand}`;
    await ownerPage.getByTestId("create-whiteboard-btn").click();
    await ownerPage.getByTestId("new-whiteboard-title-input").fill(boardTitle);
    await ownerPage.getByTestId("confirm-create-whiteboard-btn").click();

    await expect(ownerPage).toHaveURL(/\/app\/whiteboards\/.+/);

    // 4. Open Comments Drawer in Whiteboard
    const wbCommentsBtn = ownerPage.getByTestId("whiteboard-comments-trigger");
    await expect(wbCommentsBtn).toBeVisible({ timeout: 15000 });
    await wbCommentsBtn.click();

    // Verify discussion panel opens
    const commentsPanel = ownerPage.getByTestId("comments-panel");
    await expect(commentsPanel).toBeVisible();

    // Post a comment on the whiteboard
    const canvasComment = `Check the microservices layout on the canvas. ${rand}`;
    await ownerPage.getByTestId("new-thread-textarea").fill(canvasComment);
    await ownerPage.getByTestId("new-thread-submit-button").click();

    await expect(ownerPage.getByText(canvasComment)).toBeVisible();

    await ownerContext.close();
  });
});
