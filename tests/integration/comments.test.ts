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
});
