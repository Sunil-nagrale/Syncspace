import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  AuthorizationError,
  AuthorizationService,
} from "@/services/authorization.service";
import {
  buildSafePrefixTsQuery,
  buildSafeSearchExcerpt,
  decodeSearchCursor,
  encodeSearchCursor,
  escapeLikePattern,
  searchQuerySchema,
  type SearchEntityType,
  type SearchResponse,
  type SearchResultItem,
} from "@/lib/validations/search";

interface RawSearchRow {
  id: string;
  entity_type: SearchEntityType;
  title: string;
  description: string | null;
  search_text: string | null;
  workspace_id: string;
  workspace_name: string;
  project_id: string | null;
  project_name: string | null;
  updated_at: Date;
  match_field: "title" | "description" | "content";
  score: number;
}

function buildResultUrl(entityType: SearchEntityType, id: string): string {
  switch (entityType) {
    case "DOCUMENT":
      return `/app/documents/${id}`;
    case "WHITEBOARD":
      return `/app/whiteboards/${id}`;
    case "PROJECT":
      return `/app/projects/${id}`;
  }
}

export class SearchService {
  /**
   * Executes a permission-scoped full-text search across accessible Documents,
   * Whiteboards, and Projects in the user's workspaces.
   *
   * Security invariants:
   * 1. Requires an authenticated `userId`.
   * 2. If `workspaceId` is specified, verifies workspace membership via `AuthorizationService.requireWorkspaceAccess`
   *    (throws 404 NotFoundError for non-members to prevent workspace enumeration).
   * 3. Scopes all results strictly to workspaces where the user is a `WorkspaceMember`.
   * 4. Excludes any artifact where the user has an explicit `ArtifactPermission` override with `role = 'NONE'`.
   * 5. Excludes archived artifacts and archived projects.
   * 6. Generates bounded, sanitized excerpts solely from the authorized row's fields.
   */
  static async search(
    userId: string,
    rawParams: Record<string, unknown>
  ): Promise<SearchResponse> {
    if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
      throw new AuthorizationError("Authentication required", 401);
    }

    const parsed = searchQuerySchema.parse(rawParams);
    const { q, workspaceId, projectId, type, limit, cursor, includeRecent } =
      parsed;

    const offset = cursor ? decodeSearchCursor(cursor) : 0;

    if (workspaceId) {
      await AuthorizationService.requireWorkspaceAccess(
        userId,
        workspaceId,
        "VIEWER"
      );
    }

    // Empty query handling
    if (q.length === 0) {
      if (!includeRecent) {
        return {
          query: "",
          items: [],
          nextCursor: null,
          hasMore: false,
        };
      }

      return this.listRecentAccessibleItems({
        userId,
        workspaceId: workspaceId ?? null,
        projectId: projectId ?? null,
        type,
        limit,
        offset,
      });
    }

    const qLower = q.toLowerCase();
    const likePattern = `%${escapeLikePattern(q)}%`;
    const prefixPattern = `${escapeLikePattern(qLower)}%`;
    const prefixTsQuery = buildSafePrefixTsQuery(q) ?? "";
    const workspaceFilter = workspaceId ?? null;
    const projectFilter = projectId ?? null;
    const fetchLimit = limit + 1;

    const rows = await prisma.$queryRaw<RawSearchRow[]>(Prisma.sql`
      WITH params AS (
        SELECT
          ${q}::text AS raw_q,
          ${qLower}::text AS lower_q,
          ${likePattern}::text AS like_q,
          ${prefixPattern}::text AS prefix_like_q,
          websearch_to_tsquery('english', ${q}) AS ts_en,
          websearch_to_tsquery('simple', ${q}) AS ts_simple,
          CASE
            WHEN ${prefixTsQuery}::text <> '' THEN to_tsquery('simple', ${prefixTsQuery})
            ELSE NULL::tsquery
          END AS ts_prefix
      ),
      artifact_matches AS (
        SELECT
          a."id" AS id,
          a."type"::text AS entity_type,
          a."title" AS title,
          a."description" AS description,
          a."searchText" AS search_text,
          a."workspaceId" AS workspace_id,
          w."name" AS workspace_name,
          a."projectId" AS project_id,
          p."name" AS project_name,
          a."updatedAt" AS updated_at,
          CASE
            WHEN a."title" ILIKE params.like_q ESCAPE '\'
              OR (numnode(params.ts_en) > 0 AND to_tsvector('english', coalesce(a."title", '')) @@ params.ts_en)
              OR (numnode(params.ts_simple) > 0 AND to_tsvector('simple', coalesce(a."title", '')) @@ params.ts_simple)
              OR (params.ts_prefix IS NOT NULL AND to_tsvector('simple', coalesce(a."title", '')) @@ params.ts_prefix)
              OR (char_length(params.raw_q) >= 3 AND word_similarity(params.raw_q, a."title") >= 0.6)
            THEN 'title'
            WHEN coalesce(a."description", '') ILIKE params.like_q ESCAPE '\'
              OR (numnode(params.ts_en) > 0 AND to_tsvector('english', coalesce(a."description", '')) @@ params.ts_en)
              OR (numnode(params.ts_simple) > 0 AND to_tsvector('simple', coalesce(a."description", '')) @@ params.ts_simple)
              OR (params.ts_prefix IS NOT NULL AND to_tsvector('simple', coalesce(a."description", '')) @@ params.ts_prefix)
            THEN 'description'
            ELSE 'content'
          END AS match_field,
          (
            CASE WHEN lower(a."title") = params.lower_q THEN 100.0 ELSE 0.0 END +
            CASE WHEN lower(a."title") LIKE params.prefix_like_q ESCAPE '\' THEN 40.0 ELSE 0.0 END +
            CASE WHEN a."title" ILIKE params.like_q ESCAPE '\' THEN 25.0 ELSE 0.0 END +
            CASE WHEN coalesce(a."description", '') ILIKE params.like_q ESCAPE '\' THEN 10.0 ELSE 0.0 END +
            CASE WHEN coalesce(a."searchText", '') ILIKE params.like_q ESCAPE '\' THEN 6.0 ELSE 0.0 END +
            CASE
              WHEN numnode(params.ts_en) > 0 THEN
                ts_rank_cd(
                  setweight(to_tsvector('english', coalesce(a."title", '')), 'A') ||
                  setweight(to_tsvector('english', coalesce(a."description", '')), 'B') ||
                  setweight(to_tsvector('english', coalesce(a."searchText", '')), 'C'),
                  params.ts_en
                ) * 20.0
              ELSE 0.0
            END +
            CASE
              WHEN params.ts_prefix IS NOT NULL THEN
                ts_rank_cd(
                  setweight(to_tsvector('simple', coalesce(a."title", '')), 'A') ||
                  setweight(to_tsvector('simple', coalesce(a."description", '')), 'B') ||
                  setweight(to_tsvector('simple', coalesce(a."searchText", '')), 'C'),
                  params.ts_prefix
                ) * 15.0
              ELSE 0.0
            END +
            CASE
              WHEN char_length(params.raw_q) >= 3 THEN word_similarity(params.raw_q, a."title") * 5.0
              ELSE 0.0
            END
          )::double precision AS score
        FROM "artifact" a
        INNER JOIN "workspace" w ON w."id" = a."workspaceId"
        INNER JOIN "workspace_member" wm ON wm."workspaceId" = a."workspaceId" AND wm."userId" = ${userId}
        LEFT JOIN "project" p ON p."id" = a."projectId"
        LEFT JOIN "artifact_permission" ap ON ap."artifactId" = a."id" AND ap."userId" = ${userId}
        CROSS JOIN params
        WHERE a."isArchived" = false
          AND (p."id" IS NULL OR p."isArchived" = false)
          AND (ap."id" IS NULL OR ap."role" <> 'NONE')
          AND (${workspaceFilter}::text IS NULL OR a."workspaceId" = ${workspaceFilter})
          AND (${projectFilter}::text IS NULL OR a."projectId" = ${projectFilter})
          AND (
            ${type}::text = 'ALL'
            OR (${type}::text IN ('DOCUMENT', 'WHITEBOARD') AND a."type"::text = ${type})
          )
          AND (
            (
              numnode(params.ts_en) > 0 AND (
                setweight(to_tsvector('english', coalesce(a."title", '')), 'A') ||
                setweight(to_tsvector('english', coalesce(a."description", '')), 'B') ||
                setweight(to_tsvector('english', coalesce(a."searchText", '')), 'C')
              ) @@ params.ts_en
            )
            OR (
              numnode(params.ts_simple) > 0 AND (
                setweight(to_tsvector('simple', coalesce(a."title", '')), 'A') ||
                setweight(to_tsvector('simple', coalesce(a."description", '')), 'B') ||
                setweight(to_tsvector('simple', coalesce(a."searchText", '')), 'C')
              ) @@ params.ts_simple
            )
            OR (
              params.ts_prefix IS NOT NULL AND (
                setweight(to_tsvector('simple', coalesce(a."title", '')), 'A') ||
                setweight(to_tsvector('simple', coalesce(a."description", '')), 'B') ||
                setweight(to_tsvector('simple', coalesce(a."searchText", '')), 'C')
              ) @@ params.ts_prefix
            )
            OR a."title" ILIKE params.like_q ESCAPE '\'
            OR coalesce(a."description", '') ILIKE params.like_q ESCAPE '\'
            OR coalesce(a."searchText", '') ILIKE params.like_q ESCAPE '\'
            OR (char_length(params.raw_q) >= 3 AND word_similarity(params.raw_q, a."title") >= 0.6)
          )
      ),
      project_matches AS (
        SELECT
          p."id" AS id,
          'PROJECT'::text AS entity_type,
          p."name" AS title,
          p."description" AS description,
          NULL::text AS search_text,
          p."workspaceId" AS workspace_id,
          w."name" AS workspace_name,
          p."id" AS project_id,
          p."name" AS project_name,
          p."updatedAt" AS updated_at,
          CASE
            WHEN p."name" ILIKE params.like_q ESCAPE '\'
              OR (numnode(params.ts_en) > 0 AND to_tsvector('english', coalesce(p."name", '')) @@ params.ts_en)
              OR (numnode(params.ts_simple) > 0 AND to_tsvector('simple', coalesce(p."name", '')) @@ params.ts_simple)
              OR (params.ts_prefix IS NOT NULL AND to_tsvector('simple', coalesce(p."name", '')) @@ params.ts_prefix)
              OR (char_length(params.raw_q) >= 3 AND word_similarity(params.raw_q, p."name") >= 0.6)
            THEN 'title'
            ELSE 'description'
          END AS match_field,
          (
            CASE WHEN lower(p."name") = params.lower_q THEN 100.0 ELSE 0.0 END +
            CASE WHEN lower(p."name") LIKE params.prefix_like_q ESCAPE '\' THEN 40.0 ELSE 0.0 END +
            CASE WHEN p."name" ILIKE params.like_q ESCAPE '\' THEN 25.0 ELSE 0.0 END +
            CASE WHEN coalesce(p."description", '') ILIKE params.like_q ESCAPE '\' THEN 10.0 ELSE 0.0 END +
            CASE
              WHEN numnode(params.ts_en) > 0 THEN
                ts_rank_cd(
                  setweight(to_tsvector('english', coalesce(p."name", '')), 'A') ||
                  setweight(to_tsvector('english', coalesce(p."description", '')), 'B'),
                  params.ts_en
                ) * 20.0
              ELSE 0.0
            END +
            CASE
              WHEN params.ts_prefix IS NOT NULL THEN
                ts_rank_cd(
                  setweight(to_tsvector('simple', coalesce(p."name", '')), 'A') ||
                  setweight(to_tsvector('simple', coalesce(p."description", '')), 'B'),
                  params.ts_prefix
                ) * 15.0
              ELSE 0.0
            END +
            CASE
              WHEN char_length(params.raw_q) >= 3 THEN word_similarity(params.raw_q, p."name") * 5.0
              ELSE 0.0
            END
          )::double precision AS score
        FROM "project" p
        INNER JOIN "workspace" w ON w."id" = p."workspaceId"
        INNER JOIN "workspace_member" wm ON wm."workspaceId" = p."workspaceId" AND wm."userId" = ${userId}
        CROSS JOIN params
        WHERE p."isArchived" = false
          AND (${workspaceFilter}::text IS NULL OR p."workspaceId" = ${workspaceFilter})
          AND (${projectFilter}::text IS NULL OR p."id" = ${projectFilter})
          AND (${type}::text IN ('ALL', 'PROJECT'))
          AND (
            (
              numnode(params.ts_en) > 0 AND (
                setweight(to_tsvector('english', coalesce(p."name", '')), 'A') ||
                setweight(to_tsvector('english', coalesce(p."description", '')), 'B')
              ) @@ params.ts_en
            )
            OR (
              numnode(params.ts_simple) > 0 AND (
                setweight(to_tsvector('simple', coalesce(p."name", '')), 'A') ||
                setweight(to_tsvector('simple', coalesce(p."description", '')), 'B')
              ) @@ params.ts_simple
            )
            OR (
              params.ts_prefix IS NOT NULL AND (
                setweight(to_tsvector('simple', coalesce(p."name", '')), 'A') ||
                setweight(to_tsvector('simple', coalesce(p."description", '')), 'B')
              ) @@ params.ts_prefix
            )
            OR p."name" ILIKE params.like_q ESCAPE '\'
            OR coalesce(p."description", '') ILIKE params.like_q ESCAPE '\'
            OR (char_length(params.raw_q) >= 3 AND word_similarity(params.raw_q, p."name") >= 0.6)
          )
      ),
      combined AS (
        SELECT * FROM artifact_matches
        UNION ALL
        SELECT * FROM project_matches
      )
      SELECT
        id,
        entity_type,
        title,
        description,
        search_text,
        workspace_id,
        workspace_name,
        project_id,
        project_name,
        updated_at,
        match_field,
        score
      FROM combined
      ORDER BY score DESC, updated_at DESC, id ASC
      LIMIT ${fetchLimit}
      OFFSET ${offset}
    `);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? encodeSearchCursor(offset + limit) : null;

    const items: SearchResultItem[] = pageRows.map((row) => {
      const { excerpt } = buildSafeSearchExcerpt({
        query: q,
        title: row.title,
        description: row.description,
        searchText: row.search_text,
        entityType: row.entity_type,
      });

      return {
        id: row.id,
        entityType: row.entity_type,
        title: row.title,
        excerpt,
        url: buildResultUrl(row.entity_type, row.id),
        workspaceId: row.workspace_id,
        workspaceName: row.workspace_name,
        projectId: row.project_id,
        projectName: row.project_name,
        updatedAt: new Date(row.updated_at).toISOString(),
        matchField: row.match_field,
      };
    });

    return {
      query: q,
      items,
      nextCursor,
      hasMore,
    };
  }

  private static async listRecentAccessibleItems(params: {
    userId: string;
    workspaceId: string | null;
    projectId: string | null;
    type: "ALL" | SearchEntityType;
    limit: number;
    offset: number;
  }): Promise<SearchResponse> {
    const { userId, workspaceId, projectId, type, limit, offset } = params;
    const fetchLimit = limit + 1;

    const rows = await prisma.$queryRaw<RawSearchRow[]>(Prisma.sql`
      WITH recent_artifacts AS (
        SELECT
          a."id" AS id,
          a."type"::text AS entity_type,
          a."title" AS title,
          a."description" AS description,
          a."searchText" AS search_text,
          a."workspaceId" AS workspace_id,
          w."name" AS workspace_name,
          a."projectId" AS project_id,
          p."name" AS project_name,
          a."updatedAt" AS updated_at,
          'title'::text AS match_field,
          1.0::double precision AS score
        FROM "artifact" a
        INNER JOIN "workspace" w ON w."id" = a."workspaceId"
        INNER JOIN "workspace_member" wm ON wm."workspaceId" = a."workspaceId" AND wm."userId" = ${userId}
        LEFT JOIN "project" p ON p."id" = a."projectId"
        LEFT JOIN "artifact_permission" ap ON ap."artifactId" = a."id" AND ap."userId" = ${userId}
        WHERE a."isArchived" = false
          AND (p."id" IS NULL OR p."isArchived" = false)
          AND (ap."id" IS NULL OR ap."role" <> 'NONE')
          AND (${workspaceId}::text IS NULL OR a."workspaceId" = ${workspaceId})
          AND (${projectId}::text IS NULL OR a."projectId" = ${projectId})
          AND (
            ${type}::text = 'ALL'
            OR (${type}::text IN ('DOCUMENT', 'WHITEBOARD') AND a."type"::text = ${type})
          )
      ),
      recent_projects AS (
        SELECT
          p."id" AS id,
          'PROJECT'::text AS entity_type,
          p."name" AS title,
          p."description" AS description,
          NULL::text AS search_text,
          p."workspaceId" AS workspace_id,
          w."name" AS workspace_name,
          p."id" AS project_id,
          p."name" AS project_name,
          p."updatedAt" AS updated_at,
          'title'::text AS match_field,
          1.0::double precision AS score
        FROM "project" p
        INNER JOIN "workspace" w ON w."id" = p."workspaceId"
        INNER JOIN "workspace_member" wm ON wm."workspaceId" = p."workspaceId" AND wm."userId" = ${userId}
        WHERE p."isArchived" = false
          AND (${workspaceId}::text IS NULL OR p."workspaceId" = ${workspaceId})
          AND (${projectId}::text IS NULL OR p."id" = ${projectId})
          AND (${type}::text IN ('ALL', 'PROJECT'))
      ),
      combined AS (
        SELECT * FROM recent_artifacts
        UNION ALL
        SELECT * FROM recent_projects
      )
      SELECT
        id,
        entity_type,
        title,
        description,
        search_text,
        workspace_id,
        workspace_name,
        project_id,
        project_name,
        updated_at,
        match_field,
        score
      FROM combined
      ORDER BY updated_at DESC, id ASC
      LIMIT ${fetchLimit}
      OFFSET ${offset}
    `);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? encodeSearchCursor(offset + limit) : null;

    const items: SearchResultItem[] = pageRows.map((row) => {
      const { excerpt } = buildSafeSearchExcerpt({
        query: "",
        title: row.title,
        description: row.description,
        searchText: row.search_text,
        entityType: row.entity_type,
      });

      return {
        id: row.id,
        entityType: row.entity_type,
        title: row.title,
        excerpt,
        url: buildResultUrl(row.entity_type, row.id),
        workspaceId: row.workspace_id,
        workspaceName: row.workspace_name,
        projectId: row.project_id,
        projectName: row.project_name,
        updatedAt: new Date(row.updated_at).toISOString(),
        matchField: row.match_field,
      };
    });

    return {
      query: "",
      items,
      nextCursor,
      hasMore,
    };
  }
}
