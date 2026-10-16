import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { WorkspaceService } from "@/services/workspace.service";
import { ArtifactService } from "@/services/artifact.service";
import { CommentService } from "@/services/comment.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";

beforeAll(async () => {
  // Ensure live PostgreSQL connection
  await prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Phase 8A — Artifact Comments and Discussion Threads Integration Tests", () => {
  async function createTestUser(roleSuffix: string) {
    const email = `test.comment.${roleSuffix}.${Date.now()}.${Math.random()
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
    const owner = await createTestUser("owner");
    const editor = await createTestUser("editor");
    const viewer = await createTestUser("viewer");
    const outsider = await createTestUser("outsider");

    const workspace = await WorkspaceService.createWorkspace(owner.id, {
      name: "Discussion Test Space",
      createDefaultProject: true,
    });

    const project = await prisma.project.findFirstOrThrow({
      where: { workspaceId: workspace.id },
    });

    // Add editor and viewer to workspace
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId: workspace.id, userId: editor.id, role: "EDITOR" },
        { workspaceId: workspace.id, userId: viewer.id, role: "VIEWER" },
      ],
    });

    // Create a test document artifact
    const artifact = await ArtifactService.createArtifact(owner.id, {
      workspaceId: workspace.id,
      projectId: project.id,
      title: "Architecture Decisions",
      type: "DOCUMENT",
    });

    return { owner, editor, viewer, outsider, workspace, project, artifact };
  }

  it("creates comment threads and replies, persisting authors and timestamps", async () => {
    const { owner, editor, artifact } = await setupTestEnvironment();

    // 1. Owner creates a new discussion thread
    const thread = await CommentService.createThread({
      actorUserId: owner.id,
      artifactId: artifact.id,
      content: "Should we use PostgreSQL or Redis for session store?",
      anchorType: "GENERAL",
    });

    expect(thread.id).toBeDefined();
    expect(thread.artifactId).toBe(artifact.id);
    expect(thread.isResolved).toBe(false);
    expect(thread.comments.length).toBe(1);
    expect(thread.comments[0].content).toBe(
      "Should we use PostgreSQL or Redis for session store?"
    );
    expect(thread.comments[0].author.id).toBe(owner.id);
    expect(thread.comments[0].isEdited).toBe(false);

    // 2. Editor adds a reply to the thread
    const reply = await CommentService.createReply({
      actorUserId: editor.id,
      threadId: thread.id,
      content: "PostgreSQL with connection pooling is more than enough for current scale.",
    });

    expect(reply.id).toBeDefined();
    expect(reply.threadId).toBe(thread.id);
    expect(reply.content).toContain("PostgreSQL with connection pooling");
    expect(reply.author.id).toBe(editor.id);

    // 3. List threads and verify full hierarchy
    const list = await CommentService.listThreads(editor.id, artifact.id);
    expect(list.length).toBe(1);
    expect(list[0].comments.length).toBe(2);
    expect(list[0].comments[0].author.name).toBe(owner.name);
    expect(list[0].comments[1].author.name).toBe(editor.name);
  });

  it("enforces editing permissions strictly (author only)", async () => {
    const { owner, editor, artifact } = await setupTestEnvironment();

    const thread = await CommentService.createThread({
      actorUserId: owner.id,
      artifactId: artifact.id,
      content: "Original root note",
    });

    const reply = await CommentService.createReply({
      actorUserId: editor.id,
      threadId: thread.id,
      content: "Editor's initial opinion",
    });

    // Editor edits their own reply -> succeeds
    const updated = await CommentService.updateComment({
      actorUserId: editor.id,
      commentId: reply.id,
      content: "Editor's refined opinion (v2)",
    });

    expect(updated.content).toBe("Editor's refined opinion (v2)");
    expect(updated.isEdited).toBe(true);

    // Owner tries to edit editor's reply -> rejected with 403 Forbidden
    await expect(
      CommentService.updateComment({
        actorUserId: owner.id,
        commentId: reply.id,
        content: "Malicious override by owner",
      })
    ).rejects.toThrowError(AuthorizationError);

    // Editor tries to edit owner's root comment -> rejected with 403 Forbidden
    await expect(
      CommentService.updateComment({
        actorUserId: editor.id,
        commentId: thread.comments[0].id,
        content: "Malicious override of root comment",
      })
    ).rejects.toThrowError(AuthorizationError);
  });

  it("handles comment and thread deletion with moderator support", async () => {
    const { owner, editor, viewer, artifact } = await setupTestEnvironment();

    const thread = await CommentService.createThread({
      actorUserId: editor.id,
      artifactId: artifact.id,
      content: "Thread to test deletion",
    });

    const reply1 = await CommentService.createReply({
      actorUserId: viewer.id,
      threadId: thread.id,
      content: "Viewer comment reply",
    });

    const reply2 = await CommentService.createReply({
      actorUserId: editor.id,
      threadId: thread.id,
      content: "Editor comment reply",
    });

    // 1. Unauthorized user cannot delete someone else's reply
    await expect(
      CommentService.deleteComment({
        actorUserId: viewer.id,
        commentId: reply2.id,
      })
    ).rejects.toThrowError(AuthorizationError);

    // 2. Author can delete their own reply
    const deleteReplyRes = await CommentService.deleteComment({
      actorUserId: viewer.id,
      commentId: reply1.id,
    });
    expect(deleteReplyRes.success).toBe(true);
    expect(deleteReplyRes.deletedCommentId).toBe(reply1.id);

    // 3. Workspace Owner can delete someone else's comment (moderation)
    const modDeleteRes = await CommentService.deleteComment({
      actorUserId: owner.id,
      commentId: reply2.id,
    });
    expect(modDeleteRes.success).toBe(true);

    // 4. Deleting the root comment deletes the entire thread
    const deleteThreadRes = await CommentService.deleteComment({
      actorUserId: editor.id,
      commentId: thread.comments[0].id,
    });
    expect(deleteThreadRes.success).toBe(true);
    expect(deleteThreadRes.deletedThreadId).toBe(thread.id);

    // Thread is gone from list
    const remaining = await CommentService.listThreads(owner.id, artifact.id);
    expect(remaining.length).toBe(0);
  });

  it("toggles reactions and strictly prevents duplicates", async () => {
    const { owner, editor, artifact } = await setupTestEnvironment();

    const thread = await CommentService.createThread({
      actorUserId: owner.id,
      artifactId: artifact.id,
      content: "Do we like this architectural decision?",
    });

    const commentId = thread.comments[0].id;

    // 1. Editor adds a reaction "👍"
    const addRes = await CommentService.toggleReaction({
      actorUserId: editor.id,
      commentId,
      emoji: "👍",
    });
    expect(addRes.action).toBe("added");
    expect(addRes.emoji).toBe("👍");

    // Check reaction is present
    let threads = await CommentService.listThreads(editor.id, artifact.id);
    let reactions = threads[0].comments[0].reactions;
    expect(reactions.length).toBe(1);
    expect(reactions[0].emoji).toBe("👍");
    expect(reactions[0].count).toBe(1);
    expect(reactions[0].hasReacted).toBe(true);

    // 2. Owner also adds "👍"
    await CommentService.toggleReaction({
      actorUserId: owner.id,
      commentId,
      emoji: "👍",
    });

    threads = await CommentService.listThreads(editor.id, artifact.id);
    reactions = threads[0].comments[0].reactions;
    expect(reactions[0].count).toBe(2);

    // 3. Editor toggles "👍" again -> it gets removed
    const removeRes = await CommentService.toggleReaction({
      actorUserId: editor.id,
      commentId,
      emoji: "👍",
    });
    expect(removeRes.action).toBe("removed");

    threads = await CommentService.listThreads(editor.id, artifact.id);
    reactions = threads[0].comments[0].reactions;
    expect(reactions[0].count).toBe(1);
    expect(reactions[0].hasReacted).toBe(false);

    // 4. Database-level unique constraint directly prevents duplicate entries
    await expect(
      prisma.commentReaction.create({
        data: {
          commentId,
          userId: owner.id,
          emoji: "👍", // Owner already has 👍
        },
      })
    ).rejects.toThrow();
  });

  it("resolves and reopens threads with user and timestamp recorded", async () => {
    const { owner, editor, viewer, artifact } = await setupTestEnvironment();

    const thread = await CommentService.createThread({
      actorUserId: viewer.id,
      artifactId: artifact.id,
      content: "A question from a viewer",
    });

    expect(thread.isResolved).toBe(false);

    // Viewer author can resolve their own thread
    const resolved = await CommentService.resolveThread(viewer.id, thread.id);
    expect(resolved.isResolved).toBe(true);
    expect(resolved.resolvedBy?.id).toBe(viewer.id);
    expect(resolved.resolvedAt).toBeDefined();

    // Verify filter returns resolved thread under status=resolved
    const resolvedList = await CommentService.listThreads(
      owner.id,
      artifact.id,
      { status: "resolved" }
    );
    expect(resolvedList.length).toBe(1);

    const openList = await CommentService.listThreads(owner.id, artifact.id, {
      status: "open",
    });
    expect(openList.length).toBe(0);

    // Editor can reopen the thread
    const reopened = await CommentService.reopenThread(editor.id, thread.id);
    expect(reopened.isResolved).toBe(false);
    expect(reopened.resolvedBy).toBeNull();
    expect(reopened.resolvedAt).toBeNull();
  });

  it("validates request payloads and catches invalid IDs", async () => {
    const { owner, artifact } = await setupTestEnvironment();

    // Empty content rejected
    await expect(
      CommentService.createThread({
        actorUserId: owner.id,
        artifactId: artifact.id,
        content: "   ",
      })
    ).rejects.toThrowError(AuthorizationError);

    // Content over 5000 chars rejected
    await expect(
      CommentService.createThread({
        actorUserId: owner.id,
        artifactId: artifact.id,
        content: "a".repeat(5001),
      })
    ).rejects.toThrowError(AuthorizationError);

    // Nonexistent artifact throws NotFoundError
    await expect(
      CommentService.createThread({
        actorUserId: owner.id,
        artifactId: "nonexistent-art-id",
        content: "Valid content",
      })
    ).rejects.toThrowError(NotFoundError);

    // Nonexistent thread throws NotFoundError
    await expect(
      CommentService.createReply({
        actorUserId: owner.id,
        threadId: "nonexistent-thread-id",
        content: "Valid reply",
      })
    ).rejects.toThrowError(NotFoundError);
  });

  it("enforces IDOR defense against cross-workspace outsiders and revoked overrides", async () => {
    const { outsider, viewer, artifact } = await setupTestEnvironment();

    // Outsider (not in workspace) receives 404 NotFoundError (IDOR prevention)
    await expect(
      CommentService.listThreads(outsider.id, artifact.id)
    ).rejects.toThrowError(NotFoundError);

    await expect(
      CommentService.createThread({
        actorUserId: outsider.id,
        artifactId: artifact.id,
        content: "Intruder comment",
      })
    ).rejects.toThrowError(NotFoundError);

    // Explicit ArtifactPermission override = NONE rejects with 403 Forbidden
    await prisma.artifactPermission.create({
      data: {
        artifactId: artifact.id,
        userId: viewer.id,
        role: "NONE",
      },
    });

    await expect(
      CommentService.listThreads(viewer.id, artifact.id)
    ).rejects.toThrowError(AuthorizationError);

    await expect(
      CommentService.createThread({
        actorUserId: viewer.id,
        artifactId: artifact.id,
        content: "Viewer with NONE permission",
      })
    ).rejects.toThrowError(AuthorizationError);
  });

  it("supports bounded cursor-based pagination for threads and computes accurate counts", async () => {
    const { owner, artifact } = await setupTestEnvironment();

    // Create 25 distinct threads
    const createdThreadIds: string[] = [];
    for (let i = 1; i <= 25; i++) {
      const thread = await CommentService.createThread({
        actorUserId: owner.id,
        artifactId: artifact.id,
        content: `Discussion thread #${i.toString().padStart(2, "0")}`,
      });
      createdThreadIds.push(thread.id);
    }

    // Page 1: limit 20
    const page1 = await CommentService.listThreads(owner.id, artifact.id, {
      limit: 20,
    });
    expect(page1.length).toBe(20);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBe(page1[19].id);
    expect(page1.openCount).toBe(25);
    expect(page1.resolvedCount).toBe(0);
    expect(page1.totalCount).toBe(25);

    // Page 2: limit 20 with cursor from page 1
    const page2 = await CommentService.listThreads(owner.id, artifact.id, {
      limit: 20,
      cursor: page1.nextCursor!,
    });
    expect(page2.length).toBe(5);
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).toBeNull();
    expect(page2.openCount).toBe(25);

    // Verify union of IDs is exactly 25 unique items
    const combinedIds = [...page1.map((t) => t.id), ...page2.map((t) => t.id)];
    expect(new Set(combinedIds).size).toBe(25);
    expect(combinedIds).toEqual(createdThreadIds.slice().reverse());
  });

  it("supports bounded cursor-based pagination for replies excluding root comment", async () => {
    const { owner, editor, artifact } = await setupTestEnvironment();

    const thread = await CommentService.createThread({
      actorUserId: owner.id,
      artifactId: artifact.id,
      content: "Main discussion topic",
    });

    const rootCommentId = thread.comments[0].id;

    // Create 25 replies
    const createdReplyIds: string[] = [];
    for (let i = 1; i <= 25; i++) {
      const reply = await CommentService.createReply({
        actorUserId: editor.id,
        threadId: thread.id,
        content: `Thread reply #${i.toString().padStart(2, "0")}`,
      });
      createdReplyIds.push(reply.id);
    }

    // Page 1: limit 10
    const page1 = await CommentService.listReplies({
      actorUserId: owner.id,
      threadId: thread.id,
      limit: 10,
    });
    expect(page1.replies.length).toBe(10);
    expect(page1.hasMore).toBe(true);
    expect(page1.totalCount).toBe(25);
    expect(page1.replies.some((r) => r.id === rootCommentId)).toBe(false);
    expect(page1.nextCursor).toBe(page1.replies[9].id);

    // Page 2: limit 10 with cursor from page 1
    const page2 = await CommentService.listReplies({
      actorUserId: owner.id,
      threadId: thread.id,
      limit: 10,
      cursor: page1.nextCursor!,
    });
    expect(page2.replies.length).toBe(10);
    expect(page2.hasMore).toBe(true);
    expect(page2.nextCursor).toBe(page2.replies[9].id);

    // Page 3: limit 10 with cursor from page 2
    const page3 = await CommentService.listReplies({
      actorUserId: owner.id,
      threadId: thread.id,
      limit: 10,
      cursor: page2.nextCursor!,
    });
    expect(page3.replies.length).toBe(5);
    expect(page3.hasMore).toBe(false);
    expect(page3.nextCursor).toBeNull();

    // Verify all 25 replies were retrieved without duplicates and in chronological order
    const allRetrievedIds = [
      ...page1.replies.map((r) => r.id),
      ...page2.replies.map((r) => r.id),
      ...page3.replies.map((r) => r.id),
    ];
    expect(allRetrievedIds).toEqual(createdReplyIds);
  });

  it("records immutable resolution and reopening events, preserving history across transitions", async () => {
    const { owner, editor, artifact } = await setupTestEnvironment();

    const thread = await CommentService.createThread({
      actorUserId: owner.id,
      artifactId: artifact.id,
      content: "Thread for audit history testing",
    });

    // Initially no events
    const initialEvents = await CommentService.getThreadEvents(owner.id, thread.id);
    expect(initialEvents.length).toBe(0);

    // 1. Editor resolves the thread
    await CommentService.resolveThread(editor.id, thread.id);
    let events = await CommentService.getThreadEvents(owner.id, thread.id);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("RESOLVED");
    expect(events[0].user.id).toBe(editor.id);

    // 2. Calling resolve again when already resolved is idempotent (does not duplicate event)
    await CommentService.resolveThread(owner.id, thread.id);
    events = await CommentService.getThreadEvents(owner.id, thread.id);
    expect(events.length).toBe(1);

    // 3. Owner reopens the thread
    await CommentService.reopenThread(owner.id, thread.id);
    events = await CommentService.getThreadEvents(owner.id, thread.id);
    expect(events.length).toBe(2);
    expect(events[0].type).toBe("RESOLVED");
    expect(events[1].type).toBe("REOPENED");
    expect(events[1].user.id).toBe(owner.id);

    // 4. Calling reopen again when already open is idempotent
    await CommentService.reopenThread(editor.id, thread.id);
    events = await CommentService.getThreadEvents(owner.id, thread.id);
    expect(events.length).toBe(2);

    // 5. Editor resolves again
    await CommentService.resolveThread(editor.id, thread.id);
    events = await CommentService.getThreadEvents(owner.id, thread.id);
    expect(events.length).toBe(3);
    expect(events[2].type).toBe("RESOLVED");
    expect(events[2].user.id).toBe(editor.id);
  });

  it("handles concurrent reaction operations safely without unhandled 500s or constraint failures", async () => {
    const { owner, editor, viewer, artifact } = await setupTestEnvironment();

    const thread = await CommentService.createThread({
      actorUserId: owner.id,
      artifactId: artifact.id,
      content: "Concurrent reaction testing comment",
    });
    const commentId = thread.comments[0].id;

    // Concurrent adds from multiple distinct users
    const results = await Promise.all([
      CommentService.toggleReaction({ actorUserId: owner.id, commentId, emoji: "🚀", intent: "add" }),
      CommentService.toggleReaction({ actorUserId: editor.id, commentId, emoji: "🚀", intent: "add" }),
      CommentService.toggleReaction({ actorUserId: viewer.id, commentId, emoji: "🚀", intent: "add" }),
    ]);

    expect(results.every((r) => r.action === "added")).toBe(true);

    // Verify comment reactions aggregate
    let threads = await CommentService.listThreads(owner.id, artifact.id);
    let rocketReaction = threads[0].comments[0].reactions.find((r) => r.emoji === "🚀");
    expect(rocketReaction?.count).toBe(3);

    // Rapid concurrent toggles by the same user do not throw unhandled exceptions
    const togglePromises = Array.from({ length: 6 }).map(() =>
      CommentService.toggleReaction({ actorUserId: editor.id, commentId, emoji: "🔥" })
    );

    const toggleResults = await Promise.allSettled(togglePromises);
    expect(toggleResults.every((r) => r.status === "fulfilled")).toBe(true);
  });

  it("validates anchors strictly and prevents malformed anchor data", async () => {
    const { owner, artifact } = await setupTestEnvironment();

    // 1. Valid TEXT_SELECTION anchor
    const textThread = await CommentService.createThread({
      actorUserId: owner.id,
      artifactId: artifact.id,
      content: "Discussion on paragraph 2",
      anchorType: "TEXT_SELECTION",
      anchorData: { from: 10, to: 42, quote: "selected text" },
    });
    expect(textThread.anchorType).toBe("TEXT_SELECTION");
    expect(textThread.anchorData).toEqual({ from: 10, to: 42, quote: "selected text" });

    // 2. Valid CANVAS_ELEMENT anchor
    const canvasElThread = await CommentService.createThread({
      actorUserId: owner.id,
      artifactId: artifact.id,
      content: "Discussion on canvas rectangle",
      anchorType: "CANVAS_ELEMENT",
      anchorData: { elementId: "rect_123" },
    });
    expect(canvasElThread.anchorType).toBe("CANVAS_ELEMENT");

    // 3. Valid CANVAS_COORDINATE anchor
    const canvasCoordThread = await CommentService.createThread({
      actorUserId: owner.id,
      artifactId: artifact.id,
      content: "Pin at coordinate (150, 300)",
      anchorType: "CANVAS_COORDINATE",
      anchorData: { x: 150, y: 300 },
    });
    expect(canvasCoordThread.anchorType).toBe("CANVAS_COORDINATE");

    // 4. Invalid TEXT_SELECTION: 'to' < 'from'
    await expect(
      CommentService.createThread({
        actorUserId: owner.id,
        artifactId: artifact.id,
        content: "Invalid text range",
        anchorType: "TEXT_SELECTION",
        anchorData: { from: 50, to: 10 },
      })
    ).rejects.toThrowError(AuthorizationError);

    // 5. Invalid CANVAS_COORDINATE: non-finite coordinate
    await expect(
      CommentService.createThread({
        actorUserId: owner.id,
        artifactId: artifact.id,
        content: "Invalid coordinate",
        anchorType: "CANVAS_COORDINATE",
        anchorData: { x: "invalid", y: 300 },
      })
    ).rejects.toThrowError(AuthorizationError);
  });
});
