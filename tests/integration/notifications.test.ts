import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { WorkspaceService } from "@/services/workspace.service";
import { ArtifactService } from "@/services/artifact.service";
import { CommentService } from "@/services/comment.service";
import { NotificationService } from "@/services/notification.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";

beforeAll(async () => {
  // Verify database connection
  await prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Phase 8B — @Mentions and In-App Notifications Integration Tests", () => {
  async function createTestUser(roleSuffix: string) {
    const email = `test.notif.${roleSuffix}.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2, 7)}@syncspace.dev`;
    return prisma.user.create({
      data: {
        name: `Test ${roleSuffix}`,
        email,
        emailVerified: true,
        color: "#6366F1",
      },
    });
  }

  async function setupTestEnvironment() {
    const author = await createTestUser("author");
    const recipient = await createTestUser("recipient");
    const recipient2 = await createTestUser("recipient2");
    const revokedUser = await createTestUser("revoked");
    const outsider = await createTestUser("outsider");

    const workspace = await WorkspaceService.createWorkspace(author.id, {
      name: "Notification Space",
      createDefaultProject: true,
    });

    const project = await prisma.project.findFirstOrThrow({
      where: { workspaceId: workspace.id },
    });

    // Add recipient, recipient2, and revokedUser to workspace
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId: workspace.id, userId: recipient.id, role: "EDITOR" },
        { workspaceId: workspace.id, userId: recipient2.id, role: "VIEWER" },
        { workspaceId: workspace.id, userId: revokedUser.id, role: "VIEWER" },
      ],
    });

    // Create test document artifact
    const artifact = await ArtifactService.createArtifact(author.id, {
      workspaceId: workspace.id,
      projectId: project.id,
      title: "Notification Spec Doc",
      type: "DOCUMENT",
    });

    // Explicitly revoke revokedUser access on this artifact
    await prisma.artifactPermission.create({
      data: {
        artifactId: artifact.id,
        userId: revokedUser.id,
        role: "NONE",
      },
    });

    return {
      author,
      recipient,
      recipient2,
      revokedUser,
      outsider,
      workspace,
      project,
      artifact,
    };
  }

  it("provides mention suggestions without leaking emails and respects NONE permissions", async () => {
    const { author, recipient, recipient2, revokedUser, outsider, artifact } =
      await setupTestEnvironment();

    // 1. Author queries mention suggestions
    const suggestions = await NotificationService.getMentionSuggestions({
      actorUserId: author.id,
      artifactId: artifact.id,
      query: "recipient",
    });

    // Should include recipient and recipient2
    expect(suggestions.length).toBeGreaterThanOrEqual(2);
    const names = suggestions.map((s) => s.name);
    expect(names).toContain(recipient.name);
    expect(names).toContain(recipient2.name);

    // PRIVACY: Must NOT contain email property
    suggestions.forEach((s) => {
      expect((s as { email?: string }).email).toBeUndefined();
      expect(s.id).toBeDefined();
      expect(s.name).toBeDefined();
      expect(s.color).toBeDefined();
    });

    // 2. Revoked user with role NONE must NOT appear in suggestions
    const revokedCheck = await NotificationService.getMentionSuggestions({
      actorUserId: author.id,
      artifactId: artifact.id,
      query: "revoked",
    });
    expect(revokedCheck.find((s) => s.id === revokedUser.id)).toBeUndefined();

    // 3. Outsider cannot query suggestions (unauthorized)
    await expect(
      NotificationService.getMentionSuggestions({
        actorUserId: outsider.id,
        artifactId: artifact.id,
        query: "test",
      })
    ).rejects.toThrow(NotFoundError);
  });

  it("persists notification when a user is mentioned in thread creation", async () => {
    const { author, recipient, artifact } = await setupTestEnvironment();

    const content = `Hello @[${recipient.name}](${recipient.id}), please review this section.`;

    const thread = await CommentService.createThread({
      actorUserId: author.id,
      artifactId: artifact.id,
      content,
      anchorType: "GENERAL",
    });

    expect(thread.id).toBeDefined();

    // Verify notification was created for recipient
    const notifications = await prisma.notification.findMany({
      where: {
        recipientId: recipient.id,
        artifactId: artifact.id,
        type: "COMMENT_MENTION",
      },
    });

    expect(notifications.length).toBe(1);
    const notif = notifications[0];
    expect(notif.actorId).toBe(author.id);
    expect(notif.threadId).toBe(thread.id);
    expect(notif.commentId).toBe(thread.rootComment?.id);
    expect(notif.readAt).toBeNull();

    const metadata = notif.metadata as {
      snippet?: string;
      artifactTitle?: string;
      threadId?: string;
    };
    expect(metadata.snippet).toContain("please review this section");
    expect(metadata.artifactTitle).toBe("Notification Spec Doc");
  });

  it("excludes self-mentions and deduplicates multiple mentions in a single comment", async () => {
    const { author, recipient, artifact } = await setupTestEnvironment();

    // Author mentions recipient twice and themselves once
    const content = `Self mention: @[${author.name}](${author.id}) and @[${recipient.name}](${recipient.id}) duplicate @[${recipient.name}](${recipient.id})`;

    const thread = await CommentService.createThread({
      actorUserId: author.id,
      artifactId: artifact.id,
      content,
    });

    // Author should NOT have received any notification
    const authorNotifs = await prisma.notification.findMany({
      where: {
        recipientId: author.id,
        commentId: thread.rootComment?.id,
      },
    });
    expect(authorNotifs.length).toBe(0);

    // Recipient should receive exactly ONE notification (deduplicated)
    const recipientNotifs = await prisma.notification.findMany({
      where: {
        recipientId: recipient.id,
        commentId: thread.rootComment?.id,
      },
    });
    expect(recipientNotifs.length).toBe(1);
  });

  it("does not create notifications for revoked users or non-members", async () => {
    const { author, revokedUser, outsider, artifact } =
      await setupTestEnvironment();

    const content = `Mentioning revoked @[${revokedUser.name}](${revokedUser.id}) and outsider @[${outsider.name}](${outsider.id})`;

    const thread = await CommentService.createThread({
      actorUserId: author.id,
      artifactId: artifact.id,
      content,
    });

    const notifs = await prisma.notification.findMany({
      where: {
        commentId: thread.rootComment?.id,
      },
    });
    expect(notifs.length).toBe(0);
  });

  it("creates notifications on thread reply", async () => {
    const { author, recipient, artifact } = await setupTestEnvironment();

    const thread = await CommentService.createThread({
      actorUserId: author.id,
      artifactId: artifact.id,
      content: "Initial discussion thread without mentions.",
    });

    const reply = await CommentService.createReply({
      actorUserId: author.id,
      threadId: thread.id,
      content: `Paging @[${recipient.name}](${recipient.id}) in the reply!`,
    });

    const notifs = await prisma.notification.findMany({
      where: {
        recipientId: recipient.id,
        commentId: reply.id,
      },
    });

    expect(notifs.length).toBe(1);
    expect(notifs[0].threadId).toBe(thread.id);
  });

  it("only notifies newly added users when editing a comment", async () => {
    const { author, recipient, recipient2, artifact } =
      await setupTestEnvironment();

    // 1. Initial comment mentions recipient only
    const thread = await CommentService.createThread({
      actorUserId: author.id,
      artifactId: artifact.id,
      content: `Hello @[${recipient.name}](${recipient.id})!`,
    });

    const rootCommentId = thread.rootComment!.id;

    const initialNotifs = await prisma.notification.findMany({
      where: { commentId: rootCommentId },
    });
    expect(initialNotifs.length).toBe(1);
    expect(initialNotifs[0].recipientId).toBe(recipient.id);

    // 2. Edit comment to keep recipient and add recipient2
    await CommentService.updateComment({
      actorUserId: author.id,
      commentId: rootCommentId,
      content: `Hello @[${recipient.name}](${recipient.id}) and @[${recipient2.name}](${recipient2.id})!`,
    });

    const afterEditNotifs = await prisma.notification.findMany({
      where: { commentId: rootCommentId },
    });

    // Should have 2 total: recipient was NOT duplicated, recipient2 was newly created
    expect(afterEditNotifs.length).toBe(2);
    const recipientNotifCount = afterEditNotifs.filter(
      (n) => n.recipientId === recipient.id
    ).length;
    const recipient2NotifCount = afterEditNotifs.filter(
      (n) => n.recipientId === recipient2.id
    ).length;
    expect(recipientNotifCount).toBe(1);
    expect(recipient2NotifCount).toBe(1);
  });

  it("supports unread count, cursor-based pagination, mark as read, and IDOR isolation", async () => {
    const { author, recipient, outsider, artifact } =
      await setupTestEnvironment();

    // 1. Initially unread count is 0
    let unreadCount = await NotificationService.getUnreadCount(recipient.id);
    expect(unreadCount).toBe(0);

    // 2. Author creates 3 separate threads mentioning recipient
    for (let i = 1; i <= 3; i++) {
      await CommentService.createThread({
        actorUserId: author.id,
        artifactId: artifact.id,
        content: `Notification item #${i}: @[${recipient.name}](${recipient.id})`,
      });
    }

    unreadCount = await NotificationService.getUnreadCount(recipient.id);
    expect(unreadCount).toBe(3);

    // 3. List notifications with pagination limit = 2
    const page1 = await NotificationService.listNotifications({
      actorUserId: recipient.id,
      limit: 2,
      filter: "all",
    });

    expect(page1.notifications.length).toBe(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeDefined();
    expect(page1.unreadCount).toBe(3);

    // Page 2
    const page2 = await NotificationService.listNotifications({
      actorUserId: recipient.id,
      limit: 2,
      cursor: page1.nextCursor!,
      filter: "all",
    });

    expect(page2.notifications.length).toBe(1);
    expect(page2.hasMore).toBe(false);

    // 4. Mark one notification as read
    const targetNotif = page1.notifications[0];
    const marked = await NotificationService.markAsRead({
      actorUserId: recipient.id,
      notificationId: targetNotif.id,
    });
    expect(marked.readAt).not.toBeNull();

    // Check unread count is now 2
    unreadCount = await NotificationService.getUnreadCount(recipient.id);
    expect(unreadCount).toBe(2);

    // 5. IDOR Isolation check: outsider cannot mark recipient's notification as read
    await expect(
      NotificationService.markAsRead({
        actorUserId: outsider.id,
        notificationId: targetNotif.id,
      })
    ).rejects.toThrow(NotFoundError);

    // 6. Filter by unread
    const unreadOnly = await NotificationService.listNotifications({
      actorUserId: recipient.id,
      filter: "unread",
    });
    expect(unreadOnly.notifications.length).toBe(2);
    unreadOnly.notifications.forEach((n) => expect(n.readAt).toBeNull());

    // 7. Mark all as read
    const markAllResult = await NotificationService.markAllAsRead(recipient.id);
    expect(markAllResult.count).toBe(2);

    const finalUnread = await NotificationService.getUnreadCount(recipient.id);
    expect(finalUnread).toBe(0);
  });

  it("enforces immediate filtering and unread-count reduction when recipient loses workspace membership, and restores access without duplicate notifications", async () => {
    const { author, recipient, workspace, artifact } =
      await setupTestEnvironment();

    // 1. Author creates a thread mentioning recipient
    const thread = await CommentService.createThread({
      actorUserId: author.id,
      artifactId: artifact.id,
      content: `Crucial update for @[${recipient.name}](${recipient.id}) regarding architecture`,
    });

    // 2. Recipient receives notification and sees it in inbox and unread count
    let unreadCount = await NotificationService.getUnreadCount(recipient.id);
    expect(unreadCount).toBe(1);

    let inbox = await NotificationService.listNotifications({
      actorUserId: recipient.id,
    });
    expect(inbox.notifications.length).toBe(1);
    const originalNotificationId = inbox.notifications[0].id;
    expect(inbox.notifications[0].metadata?.snippet).toContain("Crucial update");
    expect(inbox.notifications[0].actor.name).toBe(author.name);

    // 3. Recipient loses workspace membership
    await prisma.workspaceMember.delete({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId: recipient.id,
        },
      },
    });

    // 4. Recipient can no longer retrieve protected notification content and unread count drops to 0
    unreadCount = await NotificationService.getUnreadCount(recipient.id);
    expect(unreadCount).toBe(0);

    inbox = await NotificationService.listNotifications({
      actorUserId: recipient.id,
    });
    expect(inbox.notifications.length).toBe(0);

    // Attempting to mark as read throws NotFoundError
    await expect(
      NotificationService.markAsRead({
        actorUserId: recipient.id,
        notificationId: originalNotificationId,
      })
    ).rejects.toThrow(NotFoundError);

    // markAllAsRead updates 0 records
    const markAllWhileRevoked = await NotificationService.markAllAsRead(recipient.id);
    expect(markAllWhileRevoked.count).toBe(0);

    // 5. Restore workspace membership for recipient
    await prisma.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: recipient.id,
        role: "EDITOR",
      },
    });

    // 6. Access is restored: unread count is 1, inbox has original notification, no duplicate rows created
    unreadCount = await NotificationService.getUnreadCount(recipient.id);
    expect(unreadCount).toBe(1);

    inbox = await NotificationService.listNotifications({
      actorUserId: recipient.id,
    });
    expect(inbox.notifications.length).toBe(1);
    expect(inbox.notifications[0].id).toBe(originalNotificationId);

    // Verify row count in database has not duplicated
    const dbNotifCount = await prisma.notification.count({
      where: {
        recipientId: recipient.id,
        commentId: thread.rootComment!.id,
      },
    });
    expect(dbNotifCount).toBe(1);
  });

  it("enforces immediate filtering and unread-count reduction when explicit artifact NONE override is applied, and restores access on override removal", async () => {
    const { author, recipient, artifact } = await setupTestEnvironment();

    // 1. Author mentions recipient
    await CommentService.createThread({
      actorUserId: author.id,
      artifactId: artifact.id,
      content: `Confidential spec review: @[${recipient.name}](${recipient.id})`,
    });

    // Recipient sees notification
    let unreadCount = await NotificationService.getUnreadCount(recipient.id);
    expect(unreadCount).toBe(1);

    let inbox = await NotificationService.listNotifications({
      actorUserId: recipient.id,
    });
    expect(inbox.notifications.length).toBe(1);
    const notifId = inbox.notifications[0].id;

    // 2. Apply explicit NONE permission override on artifact for recipient
    await prisma.artifactPermission.create({
      data: {
        artifactId: artifact.id,
        userId: recipient.id,
        role: "NONE",
      },
    });

    // 3. Immediately filtered: unread count 0, inbox empty, markAsRead rejected
    unreadCount = await NotificationService.getUnreadCount(recipient.id);
    expect(unreadCount).toBe(0);

    inbox = await NotificationService.listNotifications({
      actorUserId: recipient.id,
    });
    expect(inbox.notifications.length).toBe(0);

    await expect(
      NotificationService.markAsRead({
        actorUserId: recipient.id,
        notificationId: notifId,
      })
    ).rejects.toThrow(NotFoundError);

    // 4. Remove explicit NONE override (restoring workspace-level access)
    await prisma.artifactPermission.delete({
      where: {
        artifactId_userId: {
          artifactId: artifact.id,
          userId: recipient.id,
        },
      },
    });

    // 5. Access restored cleanly
    unreadCount = await NotificationService.getUnreadCount(recipient.id);
    expect(unreadCount).toBe(1);

    inbox = await NotificationService.listNotifications({
      actorUserId: recipient.id,
    });
    expect(inbox.notifications.length).toBe(1);
    expect(inbox.notifications[0].id).toBe(notifId);
  });

  it("filters notifications for archived artifacts and deleted resources without broken navigation or data leakage", async () => {
    const { author, recipient, artifact } = await setupTestEnvironment();

    // 1. Create two separate threads with mentions
    const thread1 = await CommentService.createThread({
      actorUserId: author.id,
      artifactId: artifact.id,
      content: `Thread 1: @[${recipient.name}](${recipient.id})`,
    });

    const thread2 = await CommentService.createThread({
      actorUserId: author.id,
      artifactId: artifact.id,
      content: `Thread 2: @[${recipient.name}](${recipient.id})`,
    });

    let unreadCount = await NotificationService.getUnreadCount(recipient.id);
    expect(unreadCount).toBe(2);

    // 2. Archive the artifact
    await prisma.artifact.update({
      where: { id: artifact.id },
      data: { isArchived: true },
    });

    // Both notifications filtered while artifact is archived
    unreadCount = await NotificationService.getUnreadCount(recipient.id);
    expect(unreadCount).toBe(0);

    let inbox = await NotificationService.listNotifications({
      actorUserId: recipient.id,
    });
    expect(inbox.notifications.length).toBe(0);

    // Unarchive artifact
    await prisma.artifact.update({
      where: { id: artifact.id },
      data: { isArchived: false },
    });

    unreadCount = await NotificationService.getUnreadCount(recipient.id);
    expect(unreadCount).toBe(2);

    // 3. Delete thread2 (root comment deletion cascades thread deletion)
    await CommentService.deleteComment({
      actorUserId: author.id,
      commentId: thread2.rootComment!.id,
    });

    // Unread count and inbox now reflect only thread 1
    unreadCount = await NotificationService.getUnreadCount(recipient.id);
    expect(unreadCount).toBe(1);

    inbox = await NotificationService.listNotifications({
      actorUserId: recipient.id,
    });
    expect(inbox.notifications.length).toBe(1);
    expect(inbox.notifications[0].threadId).toBe(thread1.id);
  });
});
