import { prisma } from "@/lib/prisma";
import {
  AuthorizationService,
  AuthorizationError,
  NotFoundError,
} from "./authorization.service";

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
    email: string;
    image: string | null;
    color: string;
  };
  reactions: CommentReactionSummary[];
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
    email: string;
    image: string | null;
    color: string;
  };
  resolvedBy: {
    id: string;
    name: string;
    email: string;
  } | null;
  comments: FormattedComment[];
  commentCount: number;
}

export class CommentService {
  /**
   * Helper to format raw comment with aggregated reaction summaries for the actor.
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
        email: string;
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
   * List comment threads for an artifact, including replies and reaction summaries.
   */
  static async listThreads(
    actorUserId: string,
    artifactId: string,
    options?: { status?: "all" | "open" | "resolved" }
  ): Promise<FormattedThread[]> {
    // 1. Authorize: user must have at least VIEWER access to the artifact
    await AuthorizationService.requireArtifactAccess(
      actorUserId,
      artifactId,
      "VIEW"
    );

    const statusFilter =
      options?.status === "open"
        ? { isResolved: false }
        : options?.status === "resolved"
        ? { isResolved: true }
        : {};

    const threads = await prisma.commentThread.findMany({
      where: {
        artifactId,
        ...statusFilter,
      },
      orderBy: { createdAt: "desc" },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            color: true,
          },
        },
        resolvedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        comments: {
          orderBy: { createdAt: "asc" },
          include: {
            author: {
              select: {
                id: true,
                name: true,
                email: true,
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

    return threads.map((thread) => ({
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
      comments: thread.comments.map((c) => this.formatComment(c, actorUserId)),
      commentCount: thread.comments.length,
    }));
  }

  /**
   * Create a new comment thread on an artifact.
   */
  static async createThread(params: {
    actorUserId: string;
    artifactId: string;
    content: string;
    anchorType?: string | null;
    anchorData?: unknown | null;
  }): Promise<FormattedThread> {
    const { actorUserId, artifactId, content, anchorType, anchorData } = params;

    const trimmed = typeof content === "string" ? content.trim() : "";
    if (!trimmed) {
      throw new AuthorizationError("Comment content cannot be empty.", 400);
    }
    if (trimmed.length > 5000) {
      throw new AuthorizationError(
        "Comment content exceeds maximum length of 5000 characters.",
        400
      );
    }

    // 1. Authorize: user must have at least VIEWER access to the artifact
    const { artifact } = await AuthorizationService.requireArtifactAccess(
      actorUserId,
      artifactId,
      "VIEW"
    );

    // 2. Create thread and root comment in an atomic transaction
    const thread = await prisma.$transaction(async (tx) => {
      const createdThread = await tx.commentThread.create({
        data: {
          workspaceId: artifact.workspaceId,
          artifactId,
          createdById: actorUserId,
          anchorType: anchorType || "GENERAL",
          anchorData: anchorData as object | undefined,
        },
      });

      await tx.comment.create({
        data: {
          threadId: createdThread.id,
          authorId: actorUserId,
          content: trimmed,
        },
      });

      return tx.commentThread.findUniqueOrThrow({
        where: { id: createdThread.id },
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              color: true,
            },
          },
          resolvedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          comments: {
            orderBy: { createdAt: "asc" },
            include: {
              author: {
                select: {
                  id: true,
                  name: true,
                  email: true,
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
    });

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
      comments: thread.comments.map((c) => this.formatComment(c, actorUserId)),
      commentCount: thread.comments.length,
    };
  }

  /**
   * Add a reply to an existing comment thread.
   */
  static async createReply(params: {
    actorUserId: string;
    threadId: string;
    content: string;
  }): Promise<FormattedComment> {
    const { actorUserId, threadId, content } = params;

    const trimmed = typeof content === "string" ? content.trim() : "";
    if (!trimmed) {
      throw new AuthorizationError("Reply content cannot be empty.", 400);
    }
    if (trimmed.length > 5000) {
      throw new AuthorizationError(
        "Reply content exceeds maximum length of 5000 characters.",
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
          content: trimmed,
        },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              email: true,
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
   * Edit a comment's content (restricted to the original author).
   */
  static async updateComment(params: {
    actorUserId: string;
    commentId: string;
    content: string;
  }): Promise<FormattedComment> {
    const { actorUserId, commentId, content } = params;

    const trimmed = typeof content === "string" ? content.trim() : "";
    if (!trimmed) {
      throw new AuthorizationError("Comment content cannot be empty.", 400);
    }
    if (trimmed.length > 5000) {
      throw new AuthorizationError(
        "Comment content exceeds maximum length of 5000 characters.",
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
        content: trimmed,
        isEdited: true,
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
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
   * Delete a comment (author can delete their comment; workspace ADMIN/OWNER can moderate).
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
            comments: {
              select: { id: true },
              orderBy: { createdAt: "asc" },
            },
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

    const threadComments = comment.thread.comments;
    const isRootComment = threadComments[0]?.id === commentId;
    const isOnlyComment = threadComments.length <= 1;

    // If it's the root comment or the only comment in thread, delete the whole thread
    if (isRootComment || isOnlyComment) {
      await prisma.commentThread.delete({
        where: { id: comment.threadId },
      });
      return {
        success: true,
        deletedCommentId: commentId,
        deletedThreadId: comment.threadId,
      };
    }

    // Otherwise delete the single reply
    await prisma.comment.delete({
      where: { id: commentId },
    });

    return {
      success: true,
      deletedCommentId: commentId,
    };
  }

  /**
   * Resolve a comment thread.
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

    const updated = await prisma.commentThread.update({
      where: { id: threadId },
      data: {
        isResolved: true,
        resolvedById: actorUserId,
        resolvedAt: new Date(),
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            color: true,
          },
        },
        resolvedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        comments: {
          orderBy: { createdAt: "asc" },
          include: {
            author: {
              select: {
                id: true,
                name: true,
                email: true,
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
      comments: updated.comments.map((c) => this.formatComment(c, actorUserId)),
      commentCount: updated.comments.length,
    };
  }

  /**
   * Reopen a resolved comment thread.
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

    const updated = await prisma.commentThread.update({
      where: { id: threadId },
      data: {
        isResolved: false,
        resolvedById: null,
        resolvedAt: null,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            color: true,
          },
        },
        resolvedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        comments: {
          orderBy: { createdAt: "asc" },
          include: {
            author: {
              select: {
                id: true,
                name: true,
                email: true,
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
      comments: updated.comments.map((c) => this.formatComment(c, actorUserId)),
      commentCount: updated.comments.length,
    };
  }

  /**
   * Toggle reaction on a comment (add if not present, remove if present).
   */
  static async toggleReaction(params: {
    actorUserId: string;
    commentId: string;
    emoji: string;
  }): Promise<{ action: "added" | "removed"; emoji: string }> {
    const { actorUserId, commentId, emoji } = params;

    const trimmedEmoji = typeof emoji === "string" ? emoji.trim() : "";
    if (!trimmedEmoji || trimmedEmoji.length > 8) {
      throw new AuthorizationError("Valid emoji string is required.", 400);
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

    await AuthorizationService.requireArtifactAccess(
      actorUserId,
      comment.thread.artifactId,
      "VIEW"
    );

    const existing = await prisma.commentReaction.findUnique({
      where: {
        commentId_userId_emoji: {
          commentId,
          userId: actorUserId,
          emoji: trimmedEmoji,
        },
      },
    });

    if (existing) {
      await prisma.commentReaction.delete({
        where: { id: existing.id },
      });
      return { action: "removed", emoji: trimmedEmoji };
    }

    await prisma.commentReaction.create({
      data: {
        commentId,
        userId: actorUserId,
        emoji: trimmedEmoji,
      },
    });

    return { action: "added", emoji: trimmedEmoji };
  }
}
