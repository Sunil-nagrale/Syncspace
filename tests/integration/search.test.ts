import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { ArtifactService } from "@/services/artifact.service";
import { VersionService } from "@/services/version.service";
import { SearchService } from "@/services/search.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";
import { SearchValidationError } from "@/lib/validations/search";

describe("Full-Text Search PostgreSQL Integration Tests", () => {
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  afterAll(async () => {
    if (createdWorkspaceIds.length > 0) {
      for (const wid of createdWorkspaceIds) {
        await prisma.workspace.delete({ where: { id: wid } }).catch(() => {});
      }
    }
    if (createdUserIds.length > 0) {
      await prisma.user
        .deleteMany({
          where: { id: { in: createdUserIds } },
        })
        .catch(() => {});
    }
    await prisma.$disconnect();
  });

  async function createTestUser(suffix: string) {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);
    const email = `search.user.${timestamp}.${rand}.${suffix}@syncspace.dev`;

    const user = await prisma.user.create({
      data: {
        name: `Search User ${suffix}`,
        email,
        emailVerified: true,
        color: "#6366F1",
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function createWorkspaceFixture(ownerId: string, label: string) {
    const slug = `search-ws-${label}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    const workspace = await prisma.workspace.create({
      data: {
        name: `Workspace ${label}`,
        slug,
        members: {
          create: {
            userId: ownerId,
            role: "OWNER",
          },
        },
      },
    });
    createdWorkspaceIds.push(workspace.id);
    return workspace;
  }

  it("searches across Document titles/body, Whiteboard titles/text elements (excluding deleted elements), and Project titles/descriptions", async () => {
    const owner = await createTestUser("owner-all-types");
    const workspace = await createWorkspaceFixture(owner.id, "alpha");
    const uniqueToken = `quasar_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const deletedElementToken = `obsolete_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;

    const project = await prisma.project.create({
      data: {
        workspaceId: workspace.id,
        createdById: owner.id,
        name: `Hyperion ${uniqueToken} Initiative`,
        description:
          "Next-generation distributed storage orchestration and telemetry.",
      },
    });

    const doc = await ArtifactService.createArtifact(owner.id, {
      workspaceId: workspace.id,
      projectId: project.id,
      type: "DOCUMENT",
      title: "Consensus Protocol RFC",
      description: "Technical specification for multi-region quorum",
    });

    await ArtifactService.updateArtifact(owner.id, doc.id, {
      contentSnapshot: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Executive Summary" }],
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: `The ${uniqueToken} replication engine guarantees linearizable reads across zones.`,
              },
            ],
          },
        ],
      },
    });

    const board = await ArtifactService.createArtifact(owner.id, {
      workspaceId: workspace.id,
      projectId: project.id,
      type: "WHITEBOARD",
      title: "Cluster Topology Canvas",
      description: "Visual architecture diagram",
    });

    await ArtifactService.updateArtifact(owner.id, board.id, {
      contentSnapshot: {
        elements: [
          {
            id: "node-active-1",
            type: "text",
            text: `Ingress Router ${uniqueToken} Mesh`,
            originalText: `Ingress Router ${uniqueToken} Mesh`,
            isDeleted: false,
          },
          {
            id: "node-deleted-2",
            type: "text",
            text: `Deleted Node ${deletedElementToken}`,
            originalText: `Deleted Node ${deletedElementToken}`,
            isDeleted: true,
          },
        ],
      },
    });

    // 1. Search by shared token across all entity types
    const allResults = await SearchService.search(owner.id, {
      q: uniqueToken,
      workspaceId: workspace.id,
    });

    expect(allResults.items).toHaveLength(3);
    const entityTypes = allResults.items.map((item) => item.entityType).sort();
    expect(entityTypes).toEqual(["DOCUMENT", "PROJECT", "WHITEBOARD"]);

    // Verify canonical URLs and excerpts
    const docResult = allResults.items.find((i) => i.id === doc.id)!;
    expect(docResult.url).toBe(`/app/documents/${doc.id}`);
    expect(docResult.excerpt).toContain(uniqueToken);
    expect(docResult.matchField).toBe("content");

    const boardResult = allResults.items.find((i) => i.id === board.id)!;
    expect(boardResult.url).toBe(`/app/whiteboards/${board.id}`);
    expect(boardResult.excerpt).toContain(uniqueToken);
    expect(boardResult.matchField).toBe("content");

    const projResult = allResults.items.find((i) => i.id === project.id)!;
    expect(projResult.url).toBe(`/app/projects/${project.id}`);
    expect(projResult.matchField).toBe("title");

    // 2. Deleted Excalidraw elements must NEVER match
    const deletedSearch = await SearchService.search(owner.id, {
      q: deletedElementToken,
      workspaceId: workspace.id,
    });
    expect(deletedSearch.items).toHaveLength(0);

    // 3. Entity type filtering works accurately
    const onlyWhiteboards = await SearchService.search(owner.id, {
      q: uniqueToken,
      workspaceId: workspace.id,
      type: "WHITEBOARD",
    });
    expect(onlyWhiteboards.items).toHaveLength(1);
    expect(onlyWhiteboards.items[0].id).toBe(board.id);

    const onlyProjects = await SearchService.search(owner.id, {
      q: "orchestration telemetry",
      workspaceId: workspace.id,
      type: "PROJECT",
    });
    expect(onlyProjects.items).toHaveLength(1);
    expect(onlyProjects.items[0].id).toBe(project.id);
  });

  it("keeps searchText synchronized when checkpoints are created and historical versions are restored", async () => {
    const owner = await createTestUser("owner-version-sync");
    const workspace = await createWorkspaceFixture(owner.id, "version-sync");
    const v1Token = `milestone_v1_${Date.now()}`;
    const v2Token = `milestone_v2_${Date.now()}`;

    const doc = await ArtifactService.createArtifact(owner.id, {
      workspaceId: workspace.id,
      type: "DOCUMENT",
      title: "Versioned Search Spec",
    });

    const v1 = await VersionService.createCheckpoint(owner.id, doc.id, {
      snapshotData: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: `Initial content ${v1Token}` }],
          },
        ],
      },
      changeSummary: "Milestone 1",
    });

    // v1 token is searchable
    const searchAtV1 = await SearchService.search(owner.id, {
      q: v1Token,
      workspaceId: workspace.id,
    });
    expect(searchAtV1.items.map((i) => i.id)).toContain(doc.id);

    // Advance to v2 replacing v1Token with v2Token
    await VersionService.createCheckpoint(owner.id, doc.id, {
      snapshotData: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: `Updated content ${v2Token}` }],
          },
        ],
      },
      changeSummary: "Milestone 2",
    });

    const searchV1DuringV2 = await SearchService.search(owner.id, {
      q: v1Token,
      workspaceId: workspace.id,
    });
    expect(searchV1DuringV2.items).toHaveLength(0);

    const searchV2DuringV2 = await SearchService.search(owner.id, {
      q: v2Token,
      workspaceId: workspace.id,
    });
    expect(searchV2DuringV2.items.map((i) => i.id)).toContain(doc.id);

    // Restore v1 -> v1Token becomes searchable again and v2Token is no longer in currentSnapshot
    const latestDoc = await prisma.artifact.findUniqueOrThrow({
      where: { id: doc.id },
      select: { currentRevision: true },
    });
    await VersionService.restoreVersion(owner.id, doc.id, v1.id, {
      expectedRevision: latestDoc.currentRevision,
    });

    const searchV1AfterRestore = await SearchService.search(owner.id, {
      q: v1Token,
      workspaceId: workspace.id,
    });
    expect(searchV1AfterRestore.items.map((i) => i.id)).toContain(doc.id);

    const searchV2AfterRestore = await SearchService.search(owner.id, {
      q: v2Token,
      workspaceId: workspace.id,
    });
    expect(searchV2AfterRestore.items).toHaveLength(0);
  });

  it("enforces strict workspace isolation, NONE artifact permission overrides, and archived exclusions without leaking private snippets", async () => {
    const ownerA = await createTestUser("owner-a");
    const memberA = await createTestUser("member-a");
    const outsiderB = await createTestUser("outsider-b");

    const workspaceA = await createWorkspaceFixture(ownerA.id, "tenant-a");
    const workspaceB = await createWorkspaceFixture(outsiderB.id, "tenant-b");

    await prisma.workspaceMember.create({
      data: {
        workspaceId: workspaceA.id,
        userId: memberA.id,
        role: "EDITOR",
      },
    });

    const confidentialToken = `classified_omega_${Date.now()}`;

    // Create two documents in Workspace A containing the confidential token
    const sharedDoc = await ArtifactService.createArtifact(ownerA.id, {
      workspaceId: workspaceA.id,
      type: "DOCUMENT",
      title: `Team Runbook ${confidentialToken}`,
      description: "Accessible to workspace members",
    });

    const restrictedDoc = await ArtifactService.createArtifact(ownerA.id, {
      workspaceId: workspaceA.id,
      type: "DOCUMENT",
      title: `Executive Compensation ${confidentialToken}`,
      description: `Top secret payload ${confidentialToken}`,
    });

    // Restrict memberA from restrictedDoc using ArtifactPermission role = 'NONE'
    await prisma.artifactPermission.create({
      data: {
        artifactId: restrictedDoc.id,
        userId: memberA.id,
        role: "NONE",
      },
    });

    // Create an archived document with the same token
    const archivedDoc = await ArtifactService.createArtifact(ownerA.id, {
      workspaceId: workspaceA.id,
      type: "DOCUMENT",
      title: `Archived Draft ${confidentialToken}`,
    });
    await prisma.artifact.update({
      where: { id: archivedDoc.id },
      data: { isArchived: true },
    });

    // 1. ownerA sees both active documents, but NOT the archived document
    const ownerResults = await SearchService.search(ownerA.id, {
      q: confidentialToken,
      workspaceId: workspaceA.id,
    });
    expect(ownerResults.items.map((i) => i.id).sort()).toEqual(
      [sharedDoc.id, restrictedDoc.id].sort()
    );

    // 2. memberA (with NONE override on restrictedDoc) only sees sharedDoc — zero leakage of restrictedDoc
    const memberResults = await SearchService.search(memberA.id, {
      q: confidentialToken,
      workspaceId: workspaceA.id,
    });
    expect(memberResults.items).toHaveLength(1);
    expect(memberResults.items[0].id).toBe(sharedDoc.id);
    expect(JSON.stringify(memberResults)).not.toContain(restrictedDoc.id);
    expect(JSON.stringify(memberResults)).not.toContain(
      "Executive Compensation"
    );

    // Also verify includeRecent excludes restrictedDoc for memberA
    const memberRecent = await SearchService.search(memberA.id, {
      q: "",
      workspaceId: workspaceA.id,
      includeRecent: true,
    });
    expect(memberRecent.items.map((i) => i.id)).toContain(sharedDoc.id);
    expect(memberRecent.items.map((i) => i.id)).not.toContain(restrictedDoc.id);

    // 3. outsiderB (in Workspace B) sees 0 results when searching globally for confidentialToken
    const outsiderGlobal = await SearchService.search(outsiderB.id, {
      q: confidentialToken,
    });
    expect(outsiderGlobal.items).toHaveLength(0);

    // 4. outsiderB attempting to filter by Workspace A receives 404 NotFoundError
    await expect(
      SearchService.search(outsiderB.id, {
        q: confidentialToken,
        workspaceId: workspaceA.id,
      })
    ).rejects.toThrow(NotFoundError);
  });

  it("supports bounded pagination, empty queries, and rejects malformed or unauthenticated requests", async () => {
    const user = await createTestUser("pagination-user");
    const workspace = await createWorkspaceFixture(user.id, "pagination");
    const batchToken = `batch_item_${Date.now()}`;

    for (let i = 1; i <= 5; i++) {
      await ArtifactService.createArtifact(user.id, {
        workspaceId: workspace.id,
        type: "DOCUMENT",
        title: `Paginated Spec ${i} ${batchToken}`,
      });
    }

    // Empty query without includeRecent returns empty items
    const emptyRes = await SearchService.search(user.id, {
      q: "   ",
      workspaceId: workspace.id,
    });
    expect(emptyRes.items).toHaveLength(0);
    expect(emptyRes.hasMore).toBe(false);
    expect(emptyRes.nextCursor).toBeNull();

    // Page 1 (limit 2)
    const page1 = await SearchService.search(user.id, {
      q: batchToken,
      workspaceId: workspace.id,
      limit: 2,
    });
    expect(page1.items).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeTruthy();

    // Page 2 (limit 2)
    const page2 = await SearchService.search(user.id, {
      q: batchToken,
      workspaceId: workspace.id,
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.items).toHaveLength(2);
    expect(page2.hasMore).toBe(true);

    // Page 3 (limit 2 -> 1 remaining item)
    const page3 = await SearchService.search(user.id, {
      q: batchToken,
      workspaceId: workspace.id,
      limit: 2,
      cursor: page2.nextCursor!,
    });
    expect(page3.items).toHaveLength(1);
    expect(page3.hasMore).toBe(false);
    expect(page3.nextCursor).toBeNull();

    // All 5 distinct artifacts returned across the 3 pages
    const combinedIds = new Set([
      ...page1.items.map((i) => i.id),
      ...page2.items.map((i) => i.id),
      ...page3.items.map((i) => i.id),
    ]);
    expect(combinedIds.size).toBe(5);

    // Unauthenticated request rejected with 401 AuthorizationError
    await expect(
      SearchService.search("", { q: batchToken })
    ).rejects.toThrow(AuthorizationError);

    // Malformed cursor rejected with SearchValidationError
    await expect(
      SearchService.search(user.id, {
        q: batchToken,
        cursor: "corrupted-cursor-token",
      })
    ).rejects.toThrow(SearchValidationError);
  });
});
