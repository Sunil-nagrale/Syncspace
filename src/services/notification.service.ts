import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  AuthorizationService,
  NotFoundError,
} from "./authorization.service";

export interface MentionSuggestionUser {
  id: string;
  name: string;
  image: string | null;
  color: string;
}

export interface FormattedNotification {
  id: string;
  recipientId: string;
  actorId: string;
  workspaceId: string;
  artifactId: string | null;
  threadId: string | null;
  commentId: string | null;
  type: string;
  readAt: string | null;
  createdAt: string;
  metadata: {
    snippet?: string;
    artifactTitle?: string;
    artifactType?: string;
    threadId?: string;
  } | null;
  actor: {
    id: string;
    name: string;
    image: string | null;
    color: string;
  };
  artifact?: {
    id: string;
    title: string;
    type: string;
    isArchived: boolean;
  } | null;
}

export interface PaginatedNotificationsResult {
  notifications: FormattedNotification[];
  nextCursor: string | null;
  hasMore: boolean;
  unreadCount: number;
}

export class NotificationService {
  /**
   * Parse mentioned user IDs from comment content using canonical syntax @[Display Name](userId)
   */
  static extractMentionedUserIds(content: string): string[] {
    const userIds = new Set<string>();
    const regex = /@\[([^\]]+)\]\(([a-zA-Z0-9_-]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      if (match[2]) {
        userIds.add(match[2]);
      }
    }
    return Array.from(userIds);
  }

  /**
   * Search eligible workspace members for mention suggestions on a specific artifact.
   * Excludes members with an explicit NONE permission override on the artifact.
   * Strips sensitive information (e.g. emails) to avoid data leakage.
   */
  static async getMentionSuggestions(params: {
    actorUserId: string;
    artifactId: string;
    query?: string;
  }): Promise<MentionSuggestionUser[]> {
    const { actorUserId, artifactId, query } = params;

    // 1. Authorize: actor must have at least VIEW access to the artifact
    const { artifact } = await AuthorizationService.requireArtifactAccess(
      actorUserId,
      artifactId,
      "VIEW"
    );

    const queryTerm = query?.trim().toLowerCase();

    // 2. Fetch workspace members matching the search query
    const members = await prisma.workspaceMember.findMany({
      where: {
        workspaceId: artifact.workspaceId,
        ...(queryTerm
          ? {
              user: {
                name: {
                  contains: queryTerm,
                  mode: "insensitive",
                },
              },
            }
          : {}),
      },
      take: 25,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            color: true,
          },
        },
      },
    });

    if (members.length === 0) {
      return [];
    }

    // 3. Query explicit NONE permission overrides on this artifact to exclude unauthorized users
    const memberUserIds = members.map((m) => m.userId);
    const noneOverrides = await prisma.artifactPermission.findMany({
      where: {
        artifactId,
        userId: { in: memberUserIds },
        role: "NONE",
      },
      select: { userId: true },
    });

    const noneUserSet = new Set(noneOverrides.map((o) => o.userId));

    // 4. Filter out NONE overrides and return max 10 suggestions without emails
    return members
      .filter((m) => !noneUserSet.has(m.userId))
      .slice(0, 10)
      .map((m) => m.user);
  }

  /**
   * Atomically create mention notifications for recipients within an ongoing transaction.
   * Enforces self-mention exclusion, active workspace membership, and artifact eligibility.
   * When isEdit is true, only newly added mentions receive notifications.
   */
  static async createMentionNotifications(params: {
    tx: Prisma.TransactionClient;
    commentId: string;
    threadId: string;
    artifactId: string;
    workspaceId: string;
    actorUserId: string;
    content: string;
    artifactTitle: string;
    artifactType: string;
    isEdit?: boolean;
  }): Promise<void> {
    const {
      tx,
      commentId,
      threadId,
      artifactId,
      workspaceId,
      actorUserId,
      content,
      artifactTitle,
      artifactType,
      isEdit,
    } = params;

    const mentionedIds = this.extractMentionedUserIds(content);
    if (mentionedIds.length === 0) return;

    // 1. Exclude self-mentions
    const candidateRecipientIds = new Set(
      mentionedIds.filter((id) => id !== actorUserId)
    );
    if (candidateRecipientIds.size === 0) return;

    // 2. If editing, exclude users who already received a notification for this comment
    if (isEdit) {
      const existing = await tx.notification.findMany({
        where: {
          commentId,
          type: "COMMENT_MENTION",
        },
        select: { recipientId: true },
      });
      existing.forEach((n) => candidateRecipientIds.delete(n.recipientId));
      if (candidateRecipientIds.size === 0) return;
    }

    // 3. Ensure recipients are active members of the workspace
    const validMembers = await tx.workspaceMember.findMany({
      where: {
        workspaceId,
        userId: { in: Array.from(candidateRecipientIds) },
      },
      select: { userId: true },
    });
    const validRecipientIds = new Set(validMembers.map((m) => m.userId));
    if (validRecipientIds.size === 0) return;

    // 4. Ensure recipients have not had artifact access explicitly revoked (role NONE)
    const nonePermissions = await tx.artifactPermission.findMany({
      where: {
        artifactId,
        userId: { in: Array.from(validRecipientIds) },
        role: "NONE",
      },
      select: { userId: true },
    });
    nonePermissions.forEach((p) => validRecipientIds.delete(p.userId));
    if (validRecipientIds.size === 0) return;

    // 5. Generate snippet preview (bounded to 120 chars)
    const snippet =
      content.length > 120 ? `${content.slice(0, 117)}...` : content;

    // 6. Bulk insert notifications, deduplicating via unique constraint
    await tx.notification.createMany({
      data: Array.from(validRecipientIds).map((recipientId) => ({
        recipientId,
        actorId: actorUserId,
        workspaceId,
        artifactId,
        threadId,
        commentId,
        type: "COMMENT_MENTION",
        metadata: {
          snippet,
          artifactTitle,
          artifactType,
          threadId,
        },
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Constructs the database filter enforcing active authorization when querying notifications:
   * 1. Recipient must match the authenticated user.
   * 2. Recipient must have active workspace membership.
   * 3. Associated artifact must exist and not be archived.
   * 4. Recipient must NOT have an explicit NONE permission override on the artifact.
   * 5. Associated discussion thread must exist.
   * 6. Associated comment must exist.
   */
  static getAccessibleWhere(actorUserId: string): Prisma.NotificationWhereInput {
    return {
      recipientId: actorUserId,
      workspace: {
        members: {
          some: {
            userId: actorUserId,
          },
        },
      },
      artifact: {
        isNot: null,
        is: {
          isArchived: false,
          permissions: {
            none: {
              userId: actorUserId,
              role: "NONE",
            },
          },
        },
      },
      thread: {
        isNot: null,
      },
      comment: {
        isNot: null,
      },
    };
  }

  /**
   * Get unread notification count for an authenticated user, enforcing current authorization.
   */
  static async getUnreadCount(actorUserId: string): Promise<number> {
    return prisma.notification.count({
      where: {
        ...this.getAccessibleWhere(actorUserId),
        readAt: null,
      },
    });
  }

  /**
   * List paginated notifications for the authenticated user, enforcing current authorization.
   */
  static async listNotifications(params: {
    actorUserId: string;
    limit?: number;
    cursor?: string;
    filter?: "all" | "unread";
  }): Promise<PaginatedNotificationsResult> {
    const { actorUserId, cursor, filter = "all" } = params;
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);

    const whereClause: Prisma.NotificationWhereInput = {
      ...this.getAccessibleWhere(actorUserId),
      ...(filter === "unread" ? { readAt: null } : {}),
    };

    const [rawNotifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: whereClause,
        take: limit + 1,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
          actor: {
            select: {
              id: true,
              name: true,
              image: true,
              color: true,
            },
          },
          artifact: {
            select: {
              id: true,
              title: true,
              type: true,
              isArchived: true,
            },
          },
        },
      }),
      this.getUnreadCount(actorUserId),
    ]);

    const hasMore = rawNotifications.length > limit;
    const pageNotifications = hasMore
      ? rawNotifications.slice(0, limit)
      : rawNotifications;
    const nextCursor =
      hasMore && pageNotifications.length > 0
        ? pageNotifications[pageNotifications.length - 1].id
        : null;

    const formatted: FormattedNotification[] = pageNotifications.map((n) => ({
      id: n.id,
      recipientId: n.recipientId,
      actorId: n.actorId,
      workspaceId: n.workspaceId,
      artifactId: n.artifactId,
      threadId: n.threadId,
      commentId: n.commentId,
      type: n.type,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
      metadata: (n.metadata as FormattedNotification["metadata"]) ?? null,
      actor: n.actor,
      artifact: n.artifact,
    }));

    return {
      notifications: formatted,
      nextCursor,
      hasMore,
      unreadCount,
    };
  }

  /**
   * Mark a single notification as read, enforcing strict IDOR isolation and active authorization.
   */
  static async markAsRead(params: {
    actorUserId: string;
    notificationId: string;
  }): Promise<FormattedNotification> {
    const { actorUserId, notificationId } = params;

    const existing = await prisma.notification.findFirst({
      where: {
        id: notificationId,
        ...this.getAccessibleWhere(actorUserId),
      },
      include: {
        actor: {
          select: {
            id: true,
            name: true,
            image: true,
            color: true,
          },
        },
        artifact: {
          select: {
            id: true,
            title: true,
            type: true,
            isArchived: true,
          },
        },
      },
    });

    if (!existing) {
      throw new NotFoundError("Notification not found.");
    }

    if (existing.readAt) {
      return {
        id: existing.id,
        recipientId: existing.recipientId,
        actorId: existing.actorId,
        workspaceId: existing.workspaceId,
        artifactId: existing.artifactId,
        threadId: existing.threadId,
        commentId: existing.commentId,
        type: existing.type,
        readAt: existing.readAt.toISOString(),
        createdAt: existing.createdAt.toISOString(),
        metadata: (existing.metadata as FormattedNotification["metadata"]) ?? null,
        actor: existing.actor,
        artifact: existing.artifact,
      };
    }

    const updated = await prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
      include: {
        actor: {
          select: {
            id: true,
            name: true,
            image: true,
            color: true,
          },
        },
        artifact: {
          select: {
            id: true,
            title: true,
            type: true,
            isArchived: true,
          },
        },
      },
    });

    return {
      id: updated.id,
      recipientId: updated.recipientId,
      actorId: updated.actorId,
      workspaceId: updated.workspaceId,
      artifactId: updated.artifactId,
      threadId: updated.threadId,
      commentId: updated.commentId,
      type: updated.type,
      readAt: updated.readAt ? updated.readAt.toISOString() : null,
      createdAt: updated.createdAt.toISOString(),
      metadata: (updated.metadata as FormattedNotification["metadata"]) ?? null,
      actor: updated.actor,
      artifact: updated.artifact,
    };
  }

  /**
   * Mark all accessible unread notifications for a user as read.
   */
  static async markAllAsRead(actorUserId: string): Promise<{ count: number }> {
    const accessibleUnread = await prisma.notification.findMany({
      where: {
        ...this.getAccessibleWhere(actorUserId),
        readAt: null,
      },
      select: { id: true },
    });

    if (accessibleUnread.length === 0) {
      return { count: 0 };
    }

    const result = await prisma.notification.updateMany({
      where: {
        id: { in: accessibleUnread.map((n) => n.id) },
      },
      data: {
        readAt: new Date(),
      },
    });

    return { count: result.count };
  }
}
