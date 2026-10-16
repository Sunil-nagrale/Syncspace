import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  AuthorizationService,
  AuthorizationError,
  NotFoundError,
} from "./authorization.service";
import {
  createThreadSchema,
  createReplySchema,
  updateCommentSchema,
  toggleReactionSchema,
  validateAnchorData,
  CommentAnchorType,
} from "@/lib/validations/comment";

export interface CommentReactionSummary {
  emoji: string;
  count: number;
  hasReacted: boolean;
  users: Array<{ id: string; name: string }>;
}

export interface FormattedComment {
  id: string;
  threadId: string;
  content: string;
  isEdited: boolean;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    name: string;
    image: string | null;
    color: string;
  };
  reactions: CommentReactionSummary[];
}

export interface FormattedThreadEvent {
  id: string;
  threadId: string;
  type: "RESOLVED" | "REOPENED";
  createdAt: string;
  user: {
    id: string;
    name: string;
  };
}

export interface FormattedThread {
  id: string;
  workspaceId: string;
  artifactId: string;
  isResolved: boolean;
  resolvedAt: string | null;
  anchorType: string | null;
  anchorData: unknown | null;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    id: string;
    name: string;
    image: string | null;
    color: string;
  };
  resolvedBy: {
    id: string;
    name: string;
  } | null;
  rootComment: FormattedComment | null;
  comments: FormattedComment[];
  replyCount: number;
  commentCount: number;
  hasMoreReplies: boolean;
  nextReplyCursor: string | null;
  events?: FormattedThreadEvent[];
}

export type PaginatedThreadsResult = FormattedThread[] & {
  threads: FormattedThread[];
  nextCursor: string | null;
  hasMore: boolean;
  openCount: number;
  resolvedCount: number;
  totalCount: number;
};

export interface PaginatedRepliesResult {
  replies: FormattedComment[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
}

export class CommentService {
  /**
   * Helper to format raw comment with aggregated reaction summaries for the actor.
   * Excludes sensitive fields (e.g. email) to preserve privacy and prevent leakage.
   */
  private static formatComment(
    comment: {
      id: string;
      threadId: string;
      content: string;
      isEdited: boolean;
      createdAt: Date;
      updatedAt: Date;
      author: {
        id: string;
        name: string;
        image: string | null;
        color: string;
      };
      reactions: Array<{
        id: string;
        emoji: string;
        userId: string;
        user: { id: string; name: string };
      }>;
    },
    actorUserId: string
  ): FormattedComment {
    const reactionMap = new Map<
      string,
      { count: number; hasReacted: boolean; users: Array<{ id: string; name: string }> }
    >();

    for (const r of comment.reactions) {
      const existing = reactionMap.get(r.emoji) ?? {
        count: 0,
        hasReacted: false,
        users: [],
      };
      existing.count += 1;
      if (r.userId === actorUserId) {
        existing.hasReacted = true;
      }
      existing.users.push({ id: r.user.id, name: r.user.name });
      reactionMap.set(r.emoji, existing);
    }

    const reactions: CommentReactionSummary[] = Array.from(
      reactionMap.entries()
    ).map(([emoji, data]) => ({
      emoji,
      count: data.count,
      hasReacted: data.hasReacted,
      users: data.users,
    }));

    return {
      id: comment.id,
      threadId: comment.threadId,
      content: comment.content,
      isEdited: comment.isEdited,
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
      author: comment.author,
      reactions,
    };
  }

  /**
   * List comment threads for an artifact with bounded, cursor-based pagination.
   * Returns threads deterministically ordered by createdAt DESC, id DESC.
   */
  static async listThreads(
    actorUserId: string,
    artifactId: string,
    options?: {
      status?: "all" | "open" | "resolved";
      limit?: number;
      cursor?: string;
      replyLimit?: number;
    }
  ): Promise<PaginatedThreadsResult> {
    // 1. Authorize: user must have at least VIEWER access to the artifact
    await AuthorizationService.requireArtifactAccess(
      actorUserId,
      artifactId,
      "VIEW"
    );

    const limit = Math.min(Math.max(options?.limit ?? 20, 1), 50);
    const replyLimit = Math.min(Math.max(options?.replyLimit ?? 10, 1), 50);
    const cursor = options?.cursor?.trim();

    const statusFilter =
      options?.status === "open"
        ? { isResolved: false }
        : options?.status === "resolved"
        ? { isResolved: true }
        : {};

    // 2. Fetch threads with cursor-based pagination
    const rawThreads = await prisma.commentThread.findMany({
      where: {
        artifactId,
        ...statusFilter,
      },
      take: limit + 1,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            image: true,
            color: true,
          },
        },
        resolvedBy: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: { comments: true },
        },
        comments: {
          // Bounded initial fetch: root comment + initial replies
          take: replyLimit + 1,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          include: {
            author: {
              select: {
                id: true,
                name: true,
                image: true,
                color: true,
              },
            },
            reactions: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const hasMore = rawThreads.length > limit;
    const pageThreads = hasMore ? rawThreads.slice(0, limit) : rawThreads;
    const nextCursor = hasMore ? pageThreads[pageThreads.length - 1].id : null;

    // 3. Compute open and resolved counts efficiently
    const [openCount, resolvedCount] = await Promise.all([
      prisma.commentThread.count({
        where: { artifactId, isResolved: false },
      }),
      prisma.commentThread.count({
        where: { artifactId, isResolved: true },
      }),
    ]);
    const totalCount = openCount + resolvedCount;

    // 4. Map threads into formatted presentation DTOs
    const formattedThreads: FormattedThread[] = pageThreads.map((thread) => {
      const allFetchedComments = thread.comments.map((c) =>
        this.formatComment(c, actorUserId)
      );
      const rootComment = allFetchedComments[0] ?? null;
      const totalCommentsCount = thread._count.comments;
      const replyCount = Math.max(0, totalCommentsCount - 1);

      // Thread comments array has root comment at index 0 followed by initial replies
      const hasMoreReplies = allFetchedComments.length < totalCommentsCount;
      const nextReplyCursor =
        hasMoreReplies && allFetchedComments.length > 0
          ? allFetchedComments[allFetchedComments.length - 1].id
          : null;

      return {
        id: thread.id,
        workspaceId: thread.workspaceId,
        artifactId: thread.artifactId,
        isResolved: thread.isResolved,
        resolvedAt: thread.resolvedAt ? thread.resolvedAt.toISOString() : null,
        anchorType: thread.anchorType,
        anchorData: thread.anchorData,
        createdAt: thread.createdAt.toISOString(),
        updatedAt: thread.updatedAt.toISOString(),
        createdBy: thread.createdBy,
        resolvedBy: thread.resolvedBy,
        rootComment,
        comments: allFetchedComments,
        replyCount,
        commentCount: totalCommentsCount,
        hasMoreReplies,
        nextReplyCursor,
      };
    });

    // Provide dual compatibility: array for existing iteration, plus pagination properties
    return Object.assign(formattedThreads, {
      threads: formattedThreads,
      nextCursor,
      hasMore,
      openCount,
      resolvedCount,
      totalCount,
    });
  }

  /**
   * Paginate replies for a specific thread separately from the root comment.
   */
  static async listReplies(params: {
    actorUserId: string;
    threadId: string;
    limit?: number;
    cursor?: string;
  }): Promise<PaginatedRepliesResult> {
    const { actorUserId, threadId } = params;

    const thread = await prisma.commentThread.findUnique({
      where: { id: threadId },
      include: { artifact: true },
    });

    if (!thread || thread.artifact.isArchived) {
      throw new NotFoundError("Comment thread not found.");
    }

    await AuthorizationService.requireArtifactAccess(
      actorUserId,
      thread.artifactId,
      "VIEW"
    );

    const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
    const cursor = params.cursor?.trim();

    // 1. Identify root comment (earliest comment in the thread)
    const rootComment = await prisma.comment.findFirst({
      where: { threadId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });

    // 2. Fetch replies (all comments after the root comment)
    const rawReplies = await prisma.comment.findMany({
      where: {
        threadId,
        ...(rootComment ? { id: { not: rootComment.id } } : {}),
      },
      take: limit + 1,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        author: {
          select: {
            id: true,
            name: true,
            image: true,
            color: true,
          },
        },
        reactions: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    const hasMore = rawReplies.length > limit;
    const pageReplies = hasMore ? rawReplies.slice(0, limit) : rawReplies;
    const nextCursor = hasMore ? pageReplies[pageReplies.length - 1].id : null;

    const totalRepliesCount = await prisma.comment.count({
      where: {
        threadId,
        ...(rootComment ? { id: { not: rootComment.id } } : {}),
      },
    });

    const replies = pageReplies.map((c) => this.formatComment(c, actorUserId));

    return {
      replies,
      nextCursor,
      hasMore,
      totalCount: totalRepliesCount,
    };
  }

  /**
   * Create a new top-level comment thread on an artifact.
   */
  static async createThread(params: {
    actorUserId: string;
    artifactId: string;
    content: string;
    anchorType?: string;
    anchorData?: unknown;
  }): Promise<FormattedThread> {
    const { actorUserId, artifactId, content } = params;

    // Validate input via Zod schema
    const parseResult = createThreadSchema.safeParse({
      content,
      anchorType: params.anchorType ?? "GENERAL",
      anchorData: params.anchorData,
    });

    if (!parseResult.success) {
      throw new AuthorizationError(
        parseResult.error.issues[0]?.message || "Invalid thread input.",
        400
      );
    }

    const validated = parseResult.data;

    // Validate anchorData according to anchorType
    const anchorCheck = validateAnchorData(
      validated.anchorType as CommentAnchorType,
      validated.anchorData
    );
    if (!anchorCheck.valid) {
      throw new AuthorizationError(anchorCheck.error || "Invalid anchorData.", 400);
    }

    // Authorize: user must have at least VIEWER access to the artifact
    const { artifact } = await AuthorizationService.requireArtifactAccess(
      actorUserId,
      artifactId,
      "VIEW"
    );

    const thread = await prisma.$transaction(async (tx) => {
      const newThread = await tx.commentThread.create({
        data: {
          workspaceId: artifact.workspaceId,
          artifactId,
          createdById: actorUserId,
          anchorType: validated.anchorType,
          anchorData:
            anchorCheck.data === undefined || anchorCheck.data === null
              ? Prisma.JsonNull
              : (anchorCheck.data as Prisma.InputJsonValue),
        },
      });

      const rootComment = await tx.comment.create({
        data: {
          threadId: newThread.id,
          authorId: actorUserId,
          content: validated.content,
        },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              image: true,
              color: true,
            },
          },
          reactions: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      const createdBy = await tx.user.findUniqueOrThrow({
        where: { id: actorUserId },
        select: {
          id: true,
          name: true,
          image: true,
          color: true,
        },
      });

      return {
        ...newThread,
        createdBy,
        resolvedBy: null,
        comments: [rootComment],
      };
    });

    const formattedComment = this.formatComment(thread.comments[0], actorUserId);

    return {
      id: thread.id,
      workspaceId: thread.workspaceId,
      artifactId: thread.artifactId,
      isResolved: thread.isResolved,
      resolvedAt: null,
      anchorType: thread.anchorType,
      anchorData: thread.anchorData,
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
      createdBy: thread.createdBy,
      resolvedBy: null,
      rootComment: formattedComment,
      comments: [formattedComment],
      replyCount: 0,
      commentCount: 1,
      hasMoreReplies: false,
      nextReplyCursor: null,
    };
  }

  /**
   * Add a threaded reply to an existing discussion thread.
   */
  static async createReply(params: {
    actorUserId: string;
    threadId: string;
    content: string;
  }): Promise<FormattedComment> {
    const { actorUserId, threadId, content } = params;

    const parseResult = createReplySchema.safeParse({ content });
    if (!parseResult.success) {
      throw new AuthorizationError(
        parseResult.error.issues[0]?.message || "Invalid reply input.",
        400
      );
    }

    const thread = await prisma.commentThread.findUnique({
      where: { id: threadId },
      include: { artifact: true },
    });

    if (!thread || thread.artifact.isArchived) {
      throw new NotFoundError("Comment thread not found.");
    }

    // Authorize: user must have at least VIEWER access to the artifact
    await AuthorizationService.requireArtifactAccess(
      actorUserId,
      thread.artifactId,
      "VIEW"
    );

    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: {
          threadId,
          authorId: actorUserId,
          content: parseResult.data.content,
        },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              image: true,
              color: true,
            },
          },
          reactions: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      // Update parent thread's updatedAt
      await tx.commentThread.update({
        where: { id: threadId },
        data: { updatedAt: new Date() },
      });

      return created;
    });

    return this.formatComment(comment, actorUserId);
  }

  /**
   * Edit a comment's content (strictly restricted to original author).
   */
  static async updateComment(params: {
    actorUserId: string;
    commentId: string;
    content: string;
  }): Promise<FormattedComment> {
    const { actorUserId, commentId, content } = params;

    const parseResult = updateCommentSchema.safeParse({ content });
    if (!parseResult.success) {
      throw new AuthorizationError(
        parseResult.error.issues[0]?.message || "Invalid comment content.",
        400
      );
    }

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        thread: {
          include: { artifact: true },
        },
      },
    });

    if (!comment || comment.thread.artifact.isArchived) {
      throw new NotFoundError("Comment not found.");
    }

    // Authorize: user must belong to workspace and have access
    await AuthorizationService.requireArtifactAccess(
      actorUserId,
      comment.thread.artifactId,
      "VIEW"
    );

    // Only the original author can edit their comment
    if (comment.authorId !== actorUserId) {
      throw new AuthorizationError(
        "You can only edit your own comments.",
        403
      );
    }

    const updated = await prisma.comment.update({
      where: { id: commentId },
      data: {
        content: parseResult.data.content,
        isEdited: true,
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            image: true,
            color: true,
          },
        },
        reactions: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    return this.formatComment(updated, actorUserId);
  }

  /**
   * Delete a comment:
   * - Author can delete their own comment.
   * - Workspace OWNER or ADMIN can moderate and delete any comment.
   * - If the deleted comment is the root comment, the entire CommentThread is deleted with cascade.
   */
  static async deleteComment(params: {
    actorUserId: string;
    commentId: string;
  }): Promise<{ success: boolean; deletedCommentId: string; deletedThreadId?: string }> {
    const { actorUserId, commentId } = params;

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        thread: {
          include: {
            artifact: true,
            workspace: true,
          },
        },
      },
    });

    if (!comment || comment.thread.artifact.isArchived) {
      throw new NotFoundError("Comment not found.");
    }

    const { membership } = await AuthorizationService.requireArtifactAccess(
      actorUserId,
      comment.thread.artifactId,
      "VIEW"
    );

    const isAuthor = comment.authorId === actorUserId;
    const isModerator =
      membership.role === "OWNER" || membership.role === "ADMIN";

    if (!isAuthor && !isModerator) {
      throw new AuthorizationError(
        "You do not have permission to delete this comment.",
        403
      );
    }

    // Check if this comment is the root comment of the thread
    const firstComment = await prisma.comment.findFirst({
      where: { threadId: comment.threadId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });

    const isRootComment = firstComment?.id === commentId;

    if (isRootComment) {
      // Deleting root comment deletes the entire thread and cascades to all comments/reactions/events
      await prisma.commentThread.delete({
        where: { id: comment.threadId },
      });
      return {
        success: true,
        deletedCommentId: commentId,
        deletedThreadId: comment.threadId,
      };
    } else {
      // Deleting a reply deletes only this comment
      await prisma.comment.delete({
        where: { id: commentId },
      });
      return {
        success: true,
        deletedCommentId: commentId,
      };
    }
  }

  /**
   * Resolve a discussion thread and record an atomic CommentThreadEvent.
   * Duplicate resolve calls are idempotent and do not create duplicate events.
   */
  static async resolveThread(
    actorUserId: string,
    threadId: string
  ): Promise<FormattedThread> {
    const thread = await prisma.commentThread.findUnique({
      where: { id: threadId },
      include: { artifact: true },
    });

    if (!thread || thread.artifact.isArchived) {
      throw new NotFoundError("Comment thread not found.");
    }

    const { membership, effectiveRole } =
      await AuthorizationService.requireArtifactAccess(
        actorUserId,
        thread.artifactId,
        "VIEW"
      );

    const isThreadCreator = thread.createdById === actorUserId;
    const canManage =
      effectiveRole !== "VIEWER" ||
      membership.role === "OWNER" ||
      membership.role === "ADMIN";

    if (!isThreadCreator && !canManage) {
      throw new AuthorizationError(
        "Only thread authors, editors, or admins can resolve threads.",
        403
      );
    }

    // Atomic update + event recording inside transaction
    const updated = await prisma.$transaction(async (tx) => {
      // If already resolved, avoid creating a duplicate RESOLVED event
      if (!thread.isResolved) {
        await tx.commentThreadEvent.create({
          data: {
            threadId,
            workspaceId: thread.workspaceId,
            artifactId: thread.artifactId,
            userId: actorUserId,
            type: "RESOLVED",
          },
        });
      }

      return tx.commentThread.update({
        where: { id: threadId },
        data: {
          isResolved: true,
          resolvedById: actorUserId,
          resolvedAt: new Date(),
        },
        include: {
          createdBy: {
            select: { id: true, name: true, image: true, color: true },
          },
          resolvedBy: {
            select: { id: true, name: true },
          },
          _count: {
            select: { comments: true },
          },
          comments: {
            take: 20,
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            include: {
              author: {
                select: { id: true, name: true, image: true, color: true },
              },
              reactions: {
                include: { user: { select: { id: true, name: true } } },
              },
            },
          },
        },
      });
    });

    const allComments = updated.comments.map((c) =>
      this.formatComment(c, actorUserId)
    );
    const rootComment = allComments[0] ?? null;

    return {
      id: updated.id,
      workspaceId: updated.workspaceId,
      artifactId: updated.artifactId,
      isResolved: updated.isResolved,
      resolvedAt: updated.resolvedAt ? updated.resolvedAt.toISOString() : null,
      anchorType: updated.anchorType,
      anchorData: updated.anchorData,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      createdBy: updated.createdBy,
      resolvedBy: updated.resolvedBy,
      rootComment,
      comments: allComments,
      replyCount: Math.max(0, updated._count.comments - 1),
      commentCount: updated._count.comments,
      hasMoreReplies: allComments.length < updated._count.comments,
      nextReplyCursor:
        allComments.length < updated._count.comments && allComments.length > 0
          ? allComments[allComments.length - 1].id
          : null,
    };
  }

  /**
   * Reopen a discussion thread and record an atomic CommentThreadEvent.
   * Duplicate reopen calls are idempotent and do not create duplicate events.
   */
  static async reopenThread(
    actorUserId: string,
    threadId: string
  ): Promise<FormattedThread> {
    const thread = await prisma.commentThread.findUnique({
      where: { id: threadId },
      include: { artifact: true },
    });

    if (!thread || thread.artifact.isArchived) {
      throw new NotFoundError("Comment thread not found.");
    }

    const { membership, effectiveRole } =
      await AuthorizationService.requireArtifactAccess(
        actorUserId,
        thread.artifactId,
        "VIEW"
      );

    const isThreadCreator = thread.createdById === actorUserId;
    const canManage =
      effectiveRole !== "VIEWER" ||
      membership.role === "OWNER" ||
      membership.role === "ADMIN";

    if (!isThreadCreator && !canManage) {
      throw new AuthorizationError(
        "Only thread authors, editors, or admins can reopen threads.",
        403
      );
    }

    // Atomic update + event recording inside transaction
    const updated = await prisma.$transaction(async (tx) => {
      // If already open, avoid creating duplicate REOPENED event
      if (thread.isResolved) {
        await tx.commentThreadEvent.create({
          data: {
            threadId,
            workspaceId: thread.workspaceId,
            artifactId: thread.artifactId,
            userId: actorUserId,
            type: "REOPENED",
          },
        });
      }

      return tx.commentThread.update({
        where: { id: threadId },
        data: {
          isResolved: false,
          resolvedById: null,
          resolvedAt: null,
        },
        include: {
          createdBy: {
            select: { id: true, name: true, image: true, color: true },
          },
          resolvedBy: {
            select: { id: true, name: true },
          },
          _count: {
            select: { comments: true },
          },
          comments: {
            take: 20,
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            include: {
              author: {
                select: { id: true, name: true, image: true, color: true },
              },
              reactions: {
                include: { user: { select: { id: true, name: true } } },
              },
            },
          },
        },
      });
    });

    const allComments = updated.comments.map((c) =>
      this.formatComment(c, actorUserId)
    );
    const rootComment = allComments[0] ?? null;

    return {
      id: updated.id,
      workspaceId: updated.workspaceId,
      artifactId: updated.artifactId,
      isResolved: updated.isResolved,
      resolvedAt: null,
      anchorType: updated.anchorType,
      anchorData: updated.anchorData,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      createdBy: updated.createdBy,
      resolvedBy: null,
      rootComment,
      comments: allComments,
      replyCount: Math.max(0, updated._count.comments - 1),
      commentCount: updated._count.comments,
      hasMoreReplies: allComments.length < updated._count.comments,
      nextReplyCursor:
        allComments.length < updated._count.comments && allComments.length > 0
          ? allComments[allComments.length - 1].id
          : null,
    };
  }

  /**
   * Fetch transition audit history for a thread (RESOLVED and REOPENED events).
   */
  static async getThreadEvents(
    actorUserId: string,
    threadId: string
  ): Promise<FormattedThreadEvent[]> {
    const thread = await prisma.commentThread.findUnique({
      where: { id: threadId },
      include: { artifact: true },
    });

    if (!thread || thread.artifact.isArchived) {
      throw new NotFoundError("Comment thread not found.");
    }

    await AuthorizationService.requireArtifactAccess(
      actorUserId,
      thread.artifactId,
      "VIEW"
    );

    const events = await prisma.commentThreadEvent.findMany({
      where: { threadId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return events.map((e) => ({
      id: e.id,
      threadId: e.threadId,
      type: e.type as "RESOLVED" | "REOPENED",
      createdAt: e.createdAt.toISOString(),
      user: e.user,
    }));
  }

  /**
   * Concurrency-safe toggle reaction on a comment.
   * Uses atomic deleteMany and create with unique-constraint error recovery
   * to guarantee that competing concurrent requests never produce unhandled 500s.
   */
  static async toggleReaction(params: {
    actorUserId: string;
    commentId: string;
    emoji: string;
    intent?: "toggle" | "add" | "remove";
  }): Promise<{ action: "added" | "removed"; emoji: string }> {
    const { actorUserId, commentId, emoji } = params;

    const parseResult = toggleReactionSchema.safeParse({
      emoji,
      intent: params.intent ?? "toggle",
    });

    if (!parseResult.success) {
      throw new AuthorizationError(
        parseResult.error.issues[0]?.message || "Valid emoji string is required.",
        400
      );
    }

    const { emoji: validEmoji, intent } = parseResult.data;

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        thread: {
          include: { artifact: true },
        },
      },
    });

    if (!comment || comment.thread.artifact.isArchived) {
      throw new NotFoundError("Comment not found.");
    }

    await AuthorizationService.requireArtifactAccess(
      actorUserId,
      comment.thread.artifactId,
      "VIEW"
    );

    // Intent: Explicit Add (Idempotent)
    if (intent === "add") {
      try {
        await prisma.commentReaction.create({
          data: {
            commentId,
            userId: actorUserId,
            emoji: validEmoji,
          },
        });
        return { action: "added", emoji: validEmoji };
      } catch (err: unknown) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          // Already added concurrently
          return { action: "added", emoji: validEmoji };
        }
        throw err;
      }
    }

    // Intent: Explicit Remove (Idempotent)
    if (intent === "remove") {
      await prisma.commentReaction.deleteMany({
        where: {
          commentId,
          userId: actorUserId,
          emoji: validEmoji,
        },
      });
      return { action: "removed", emoji: validEmoji };
    }

    // Intent: Toggle (Concurrency-safe)
    // 1. Attempt to remove existing reaction
    const deleteResult = await prisma.commentReaction.deleteMany({
      where: {
        commentId,
        userId: actorUserId,
        emoji: validEmoji,
      },
    });

    if (deleteResult.count > 0) {
      // Successfully removed
      return { action: "removed", emoji: validEmoji };
    }

    // 2. Reaction was not present, attempt to insert
    try {
      await prisma.commentReaction.create({
        data: {
          commentId,
          userId: actorUserId,
          emoji: validEmoji,
        },
      });
      return { action: "added", emoji: validEmoji };
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        // Competing concurrent request created the reaction simultaneously.
        // It now exists in the database.
        return { action: "added", emoji: validEmoji };
      }
      throw err;
    }
  }
}
