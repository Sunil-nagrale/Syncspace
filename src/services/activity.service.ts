import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  AuthorizationError,
  AuthorizationService,
} from "@/services/authorization.service";
import {
  ActivityCategoryFilter,
  ActivityValidationError,
  WorkspaceActivityItem,
  WorkspaceActivityResponse,
  activityFeedQuerySchema,
  classifyActivityCategory,
  decodeActivityCursor,
  encodeActivityCursor,
  formatActivitySummary,
  sanitizeActivityMetadata,
  sanitizeTextValue,
} from "@/lib/validations/activity";

interface RawActivityRow {
  id: string;
  workspaceId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: Date;
  actorId: string;
  actorName: string;
  actorImage: string | null;
  actorColor: string;
  artifactId: string | null;
  artifactTitle: string | null;
  artifactType: "DOCUMENT" | "WHITEBOARD" | null;
  artifactIsArchived: boolean | null;
  projectId: string | null;
  projectName: string | null;
  projectIsArchived: boolean | null;
  workspaceName: string | null;
}

function buildCategorySqlFilter(category: ActivityCategoryFilter): Prisma.Sql {
  switch (category) {
    case "ARTIFACT":
      return Prisma.sql`AND LOWER(ae."action") IN (
        'artifact.created.document',
        'artifact.created.whiteboard',
        'artifact.updated',
        'artifact.archived',
        'artifact.permission_updated'
      )`;
    case "PROJECT":
      return Prisma.sql`AND (
        LOWER(ae."action") LIKE 'project.%'
        OR LOWER(ae."entityType") = 'project'
      )`;
    case "COMMENT":
      return Prisma.sql`AND (
        LOWER(ae."action") LIKE 'comment.%'
        OR LOWER(ae."entityType") IN ('comment', 'comment_thread')
      )`;
    case "VERSION":
      return Prisma.sql`AND (
        LOWER(ae."action") LIKE 'artifact.version.%'
        OR LOWER(ae."entityType") = 'artifact_version'
      )`;
    case "ATTACHMENT":
      return Prisma.sql`AND (
        LOWER(ae."action") LIKE '%attachment%'
        OR LOWER(ae."entityType") = 'attachment'
      )`;
    case "MEMBER":
      return Prisma.sql`AND (
        LOWER(ae."action") LIKE 'invitation.%'
        OR LOWER(ae."action") LIKE 'member.%'
        OR LOWER(ae."action") LIKE 'workspace.%'
        OR LOWER(ae."entityType") IN ('invitation', 'workspace_member', 'workspace')
      )`;
    case "ALL":
    default:
      return Prisma.empty;
  }
}

export class ActivityService {
  /**
   * Lists workspace activity events in deterministic reverse chronological order (`createdAt DESC, id DESC`)
   * with keyset cursor pagination, category filtering, and strict workspace + artifact-level RBAC enforcement.
   */
  static async listWorkspaceActivity(
    userId: string,
    workspaceId: string,
    rawParams: {
      limit?: unknown;
      cursor?: unknown;
      category?: unknown;
    } = {}
  ): Promise<WorkspaceActivityResponse> {
    if (!userId) {
      throw new AuthorizationError("Authentication required.", 401);
    }

    if (!workspaceId || typeof workspaceId !== "string" || !workspaceId.trim()) {
      throw new ActivityValidationError("Workspace ID is required.", 400);
    }

    // 1. Enforce active workspace membership (throws 404 NotFoundError for non-members/revoked members)
    await AuthorizationService.requireWorkspaceAccess(
      userId,
      workspaceId,
      "VIEWER"
    );

    // 2. Validate query parameters
    const parsed = activityFeedQuerySchema.safeParse({
      limit: rawParams.limit !== undefined ? rawParams.limit : undefined,
      cursor:
        typeof rawParams.cursor === "string" && rawParams.cursor.trim().length > 0
          ? rawParams.cursor
          : undefined,
      category:
        typeof rawParams.category === "string" && rawParams.category.trim().length > 0
          ? rawParams.category.trim().toUpperCase()
          : undefined,
    });

    if (!parsed.success) {
      throw new ActivityValidationError(
        parsed.error.issues[0]?.message || "Invalid activity feed query parameters.",
        400
      );
    }

    const { limit, cursor, category } = parsed.data;
    const decodedCursor = cursor ? decodeActivityCursor(cursor) : null;

    const cursorCondition = decodedCursor
      ? Prisma.sql`AND (
          ae."createdAt" < ${decodedCursor.createdAt}
          OR (ae."createdAt" = ${decodedCursor.createdAt} AND ae."id" < ${decodedCursor.id})
        )`
      : Prisma.empty;

    const categoryCondition = buildCategorySqlFilter(category);
    const takePlusOne = limit + 1;

    // 3. Query activity_event with artifact and project joins and strict NONE permission exclusion.
    // Any artifact-scoped event (artifact, comment, version, attachment, permission) is linked to its
    // parent artifact via COALESCE(ae."artifactId", ...). If the parent artifact does not exist in this
    // workspace OR the requester has an explicit ArtifactPermission with role = 'NONE', the event is excluded.
    const rows = await prisma.$queryRaw<RawActivityRow[]>(Prisma.sql`
      SELECT
        ae."id",
        ae."workspaceId",
        ae."userId",
        ae."action",
        ae."entityType",
        ae."entityId",
        ae."metadata",
        ae."createdAt",
        u."id" AS "actorId",
        u."name" AS "actorName",
        u."image" AS "actorImage",
        u."color" AS "actorColor",
        a."id" AS "artifactId",
        a."title" AS "artifactTitle",
        a."type" AS "artifactType",
        a."isArchived" AS "artifactIsArchived",
        p."id" AS "projectId",
        p."name" AS "projectName",
        p."isArchived" AS "projectIsArchived",
        w."name" AS "workspaceName"
      FROM "activity_event" ae
      INNER JOIN "user" u
        ON u."id" = ae."userId"
      INNER JOIN "workspace" w
        ON w."id" = ae."workspaceId"
      LEFT JOIN "artifact" a
        ON a."workspaceId" = ae."workspaceId"
        AND a."id" = COALESCE(
          ae."artifactId",
          CASE
            WHEN LOWER(ae."entityType") = 'artifact' THEN ae."entityId"
            ELSE ae."metadata"->>'artifactId'
          END
        )
      LEFT JOIN "artifact_permission" ap
        ON ap."artifactId" = a."id"
        AND ap."userId" = ${userId}
      LEFT JOIN "project" p
        ON p."workspaceId" = ae."workspaceId"
        AND LOWER(ae."entityType") = 'project'
        AND p."id" = ae."entityId"
      WHERE ae."workspaceId" = ${workspaceId}
        AND (
          -- Non-artifact events (workspace, project, member, invitation)
          (
            ae."artifactId" IS NULL
            AND LOWER(ae."entityType") NOT IN (
              'artifact',
              'artifact_permission',
              'artifact_version',
              'attachment',
              'comment',
              'comment_thread'
            )
            AND LOWER(ae."action") NOT LIKE 'artifact.%'
            AND LOWER(ae."action") NOT LIKE 'comment.%'
            AND LOWER(ae."action") NOT LIKE '%attachment%'
          )
          OR (
            -- Artifact-scoped events require an existing artifact in the workspace and effective access != NONE
            a."id" IS NOT NULL
            AND (ap."role" IS NULL OR ap."role"::text <> 'NONE')
          )
        )
        ${categoryCondition}
        ${cursorCondition}
      ORDER BY ae."createdAt" DESC, ae."id" DESC
      LIMIT ${takePlusOne}
    `);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const items: WorkspaceActivityItem[] = pageRows.map((row) => {
      const itemCategory = classifyActivityCategory(row.action, row.entityType);
      const rawSanitizedMeta = sanitizeActivityMetadata(row.metadata);

      const isArtifactScoped =
        row.artifactId !== null ||
        itemCategory === "ARTIFACT" ||
        itemCategory === "COMMENT" ||
        itemCategory === "VERSION" ||
        itemCategory === "ATTACHMENT";

      const isProjectScoped = itemCategory === "PROJECT";

      let isTargetArchivedOrDeleted = false;
      let targetTitle: string | null = null;
      let targetUrl: string | null = null;
      let safeEntityId: string | null = row.entityId;
      const safeMetadata = { ...rawSanitizedMeta };

      if (isArtifactScoped) {
        if (!row.artifactId || row.artifactIsArchived === true) {
          isTargetArchivedOrDeleted = true;
          targetTitle = null;
          targetUrl = null;
          safeEntityId = null;
          delete safeMetadata.title;
          delete safeMetadata.fileName;
          delete safeMetadata.artifactId;
        } else {
          targetTitle = row.artifactTitle
            ? sanitizeTextValue(row.artifactTitle)
            : null;
          targetUrl =
            row.artifactType === "WHITEBOARD"
              ? `/app/whiteboards/${row.artifactId}`
              : `/app/documents/${row.artifactId}`;
        }
      } else if (isProjectScoped) {
        if (!row.projectId || row.projectIsArchived === true) {
          isTargetArchivedOrDeleted = true;
          targetTitle = null;
          targetUrl = null;
          safeEntityId = null;
          delete safeMetadata.name;
          delete safeMetadata.title;
          delete safeMetadata.projectId;
        } else {
          targetTitle = row.projectName
            ? sanitizeTextValue(row.projectName)
            : null;
          targetUrl = `/app/projects/${row.projectId}`;
        }
      } else if (
        row.entityType.toLowerCase() === "workspace" &&
        row.workspaceName
      ) {
        targetTitle = sanitizeTextValue(row.workspaceName);
        targetUrl = "/app";
      }

      const summary = formatActivitySummary({
        action: row.action,
        entityType: row.entityType,
        targetTitle,
        isTargetArchivedOrDeleted,
        metadata: safeMetadata,
      });

      const createdAtIso =
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : new Date(row.createdAt).toISOString();

      return {
        id: row.id,
        workspaceId: row.workspaceId,
        action: row.action,
        category: itemCategory,
        entityType: row.entityType,
        entityId: safeEntityId,
        targetTitle,
        targetUrl,
        summary,
        actor: {
          id: row.actorId,
          name: row.actorName,
          image: row.actorImage,
          color: row.actorColor || "#6366F1",
        },
        metadata: safeMetadata,
        createdAt: createdAtIso,
      };
    });

    const lastItem = items[items.length - 1];
    const nextCursor =
      hasMore && lastItem
        ? encodeActivityCursor(lastItem.createdAt, lastItem.id)
        : null;

    return {
      workspaceId,
      items,
      nextCursor,
      hasMore,
    };
  }
}
