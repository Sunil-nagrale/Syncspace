import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { ArtifactService } from "@/services/artifact.service";
import { VersionService } from "@/services/version.service";
import {
  AuthorizationService,
  AuthorizationError,
  NotFoundError,
  ConflictError,
} from "@/services/authorization.service";

describe("Artifact Version History & Restore PostgreSQL Integration Tests", () => {
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
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  async function createTestUser(role: string = "EDITOR", suffix: string = "") {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);
    const email = `vh.user.${timestamp}.${rand}.${suffix}@syncspace.dev`;

    const user = await prisma.user.create({
      data: {
        name: `User ${suffix || rand}`,
        email,
        emailVerified: true,
        color: "#6366F1",
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function createTestWorkspaceWithUsers() {
    const owner = await createTestUser("OWNER", "owner");
    const editor = await createTestUser("EDITOR", "editor");
    const viewer = await createTestUser("VIEWER", "viewer");
    const outsider = await createTestUser("VIEWER", "outsider");

    const slug = `vh-ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const workspace = await prisma.workspace.create({
      data: {
        name: `Version History Workspace ${slug}`,
        slug,
        createdById: owner.id,
        members: {
          create: [
            { userId: owner.id, role: "OWNER" },
            { userId: editor.id, role: "EDITOR" },
            { userId: viewer.id, role: "VIEWER" },
          ],
        },
      },
    });
    createdWorkspaceIds.push(workspace.id);

    return { owner, editor, viewer, outsider, workspace };
  }

  it("1. Automatically creates baseline version 1 on initial snapshot, and updates currentSnapshot without overwriting version 1 on autosave", async () => {
    const { editor, workspace } = await createTestWorkspaceWithUsers();

    // Create a document
    const doc = await ArtifactService.createArtifact(editor.id, {
      workspaceId: workspace.id,
      type: "DOCUMENT",
      title: "Consensus Architecture RFC",
    });

    const initialDocJson = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Draft v1 content" }] }],
    };

    // First save: establishes baseline version 1 and currentSnapshot
    const updated1 = await ArtifactService.updateArtifact(editor.id, doc.id, {
      contentSnapshot: initialDocJson,
    });

    expect(updated1.currentRevision).toBeGreaterThanOrEqual(1);

    const docAfterFirstSave = await prisma.artifact.findUnique({
      where: { id: doc.id },
      include: { versions: true },
    });

    expect(docAfterFirstSave?.currentSnapshot).toEqual(initialDocJson);
    expect(docAfterFirstSave?.versions.length).toBe(1);
    expect(docAfterFirstSave?.versions[0].versionNumber).toBe(1);
    expect(docAfterFirstSave?.versions[0].source).toBe("AUTOMATIC");

    // Routine subsequent autosave: updates currentSnapshot and increments revision, does NOT overwrite or bloat historical versions
    const secondDocJson = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Draft v1.1 minor typing" }] }],
    };

    const updated2 = await ArtifactService.updateArtifact(editor.id, doc.id, {
      contentSnapshot: secondDocJson,
    });

    expect(updated2.currentRevision).toBeGreaterThan(updated1.currentRevision);

    const docAfterSecondSave = await prisma.artifact.findUnique({
      where: { id: doc.id },
      include: { versions: true },
    });

    // Current durable snapshot matches newest edit
    expect(docAfterSecondSave?.currentSnapshot).toEqual(secondDocJson);
    // Historical version 1 was NOT overwritten with secondDocJson
    expect(docAfterSecondSave?.versions.length).toBe(1);
    expect(docAfterSecondSave?.versions[0].snapshotData).toEqual(initialDocJson);
  });

  it("2. Creates manual checkpoints with monotonically increasing version numbers and distinct metadata", async () => {
    const { editor, workspace } = await createTestWorkspaceWithUsers();

    const doc = await ArtifactService.createArtifact(editor.id, {
      workspaceId: workspace.id,
      type: "DOCUMENT",
      title: "State Replication Spec",
    });

    const v1Content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Alpha initial design" }] }],
    };
    await ArtifactService.updateArtifact(editor.id, doc.id, { contentSnapshot: v1Content });

    // Create manual checkpoint 1
    const v2Content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Beta state machine" }] }],
    };
    const checkpoint1 = await VersionService.createCheckpoint(editor.id, doc.id, {
      title: "Beta Milestone",
      changeSummary: "Added distributed state machine definitions",
      snapshotData: v2Content,
      source: "MANUAL",
    });

    expect(checkpoint1.versionNumber).toBe(2);
    expect(checkpoint1.title).toBe("Beta Milestone");
    expect(checkpoint1.changeSummary).toBe("Added distributed state machine definitions");
    expect(checkpoint1.source).toBe("MANUAL");

    // Create manual checkpoint 2
    const v3Content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "RC1 consensus verification" }] }],
    };
    const checkpoint2 = await VersionService.createCheckpoint(editor.id, doc.id, {
      title: "Release Candidate 1",
      changeSummary: "Completed consensus protocol specifications",
      snapshotData: v3Content,
      source: "MANUAL",
    });

    expect(checkpoint2.versionNumber).toBe(3);
    expect(checkpoint2.source).toBe("MANUAL");

    // Verify all 3 versions exist in database with monotonic order
    const allVersions = await prisma.artifactVersion.findMany({
      where: { artifactId: doc.id },
      orderBy: { versionNumber: "asc" },
    });

    expect(allVersions.length).toBe(3);
    expect(allVersions.map((v) => v.versionNumber)).toEqual([1, 2, 3]);
  });

  it("3. Enforces cursor-based pagination and stable ordering", async () => {
    const { editor, workspace } = await createTestWorkspaceWithUsers();

    const doc = await ArtifactService.createArtifact(editor.id, {
      workspaceId: workspace.id,
      type: "DOCUMENT",
      title: "Pagination Test Doc",
    });

    // Create 5 versions
    for (let i = 1; i <= 5; i++) {
      await VersionService.createCheckpoint(editor.id, doc.id, {
        title: `Version Milestone ${i}`,
        snapshotData: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: `Iteration ${i}` }] }],
        },
        source: "MANUAL",
      });
    }

    // Page 1: limit 2
    const page1 = await VersionService.listVersions(editor.id, doc.id, { limit: 2 });
    expect(page1.items.length).toBe(2);
    expect(page1.items[0].versionNumber).toBe(5);
    expect(page1.items[1].versionNumber).toBe(4);
    expect(page1.nextCursor).toBeDefined();
    expect(page1.totalCount).toBe(5);

    // Page 2: limit 2 using cursor
    const page2 = await VersionService.listVersions(editor.id, doc.id, {
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.items.length).toBe(2);
    expect(page2.items[0].versionNumber).toBe(3);
    expect(page2.items[1].versionNumber).toBe(2);
    expect(page2.nextCursor).toBeDefined();

    // Page 3: limit 2 using second cursor
    const page3 = await VersionService.listVersions(editor.id, doc.id, {
      limit: 2,
      cursor: page2.nextCursor!,
    });
    expect(page3.items.length).toBe(1);
    expect(page3.items[0].versionNumber).toBe(1);
    expect(page3.nextCursor).toBeNull();
  });

  it("4. Enforces strict authorization, IDOR protection, and VIEWER restrictions", async () => {
    const { editor, viewer, outsider, workspace } = await createTestWorkspaceWithUsers();

    const doc = await ArtifactService.createArtifact(editor.id, {
      workspaceId: workspace.id,
      type: "DOCUMENT",
      title: "Security Clearance RFC",
    });

    const v1 = await VersionService.createCheckpoint(editor.id, doc.id, {
      title: "Top Secret v1",
      snapshotData: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Confidential cipher" }] }],
      },
      source: "MANUAL",
    });

    // 1. Outsider cannot list or get version (NotFoundError or 404 to avoid leaking existence)
    await expect(
      VersionService.listVersions(outsider.id, doc.id)
    ).rejects.toThrow(NotFoundError);

    await expect(
      VersionService.getVersion(outsider.id, doc.id, v1.id)
    ).rejects.toThrow(NotFoundError);

    await expect(
      VersionService.createCheckpoint(outsider.id, doc.id, {
        title: "Hacked",
        snapshotData: { type: "doc", content: [] },
      })
    ).rejects.toThrow(NotFoundError);

    await expect(
      VersionService.restoreVersion(outsider.id, doc.id, v1.id)
    ).rejects.toThrow(NotFoundError);

    // 2. Viewer CAN list and preview version
    const viewerList = await VersionService.listVersions(viewer.id, doc.id);
    expect(viewerList.items.length).toBe(1);
    expect(viewerList.items[0].id).toBe(v1.id);

    const viewerDetail = await VersionService.getVersion(viewer.id, doc.id, v1.id);
    expect(viewerDetail.id).toBe(v1.id);
    expect(viewerDetail.snapshotData).toBeDefined();

    // 3. Viewer CANNOT create checkpoint or restore version
    await expect(
      VersionService.createCheckpoint(viewer.id, doc.id, {
        title: "Viewer Checkpoint Attempt",
        snapshotData: { type: "doc", content: [] },
      })
    ).rejects.toThrow(AuthorizationError);

    await expect(
      VersionService.restoreVersion(viewer.id, doc.id, v1.id)
    ).rejects.toThrow(AuthorizationError);

    // 4. Explicit NONE override blocks access even for workspace editor
    await prisma.artifactPermission.create({
      data: {
        artifactId: doc.id,
        userId: editor.id,
        role: "NONE",
      },
    });

    await expect(
      VersionService.listVersions(editor.id, doc.id)
    ).rejects.toThrow(AuthorizationError);

    await expect(
      VersionService.restoreVersion(editor.id, doc.id, v1.id)
    ).rejects.toThrow(AuthorizationError);
  });

  it("5. Restores previous version safely: preserves displaced changes in RESTORE_RECOVERY checkpoint and writes RESTORED entry", async () => {
    const { editor, workspace } = await createTestWorkspaceWithUsers();

    const doc = await ArtifactService.createArtifact(editor.id, {
      workspaceId: workspace.id,
      type: "DOCUMENT",
      title: "Recovery Safety Test",
    });

    // Version 1
    const v1Content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Original Clean Architecture" }] }],
    };
    const v1 = await VersionService.createCheckpoint(editor.id, doc.id, {
      title: "Clean Baseline",
      snapshotData: v1Content,
      source: "MANUAL",
    });

    // Version 2 (destructive changes)
    const v2Content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Accidental Messy Deletions" }] }],
    };
    await VersionService.createCheckpoint(editor.id, doc.id, {
      title: "Messy Edits",
      snapshotData: v2Content,
      source: "MANUAL",
    });

    // Additional uncommitted autosave changes
    const uncommittedContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Important work in progress" }] }],
    };
    await ArtifactService.updateArtifact(editor.id, doc.id, {
      contentSnapshot: uncommittedContent,
    });

    const refreshedDoc = await prisma.artifact.findUnique({ where: { id: doc.id } });
    const currentRevision = refreshedDoc!.currentRevision;

    // Restore back to Version 1
    const restoreResult = await VersionService.restoreVersion(editor.id, doc.id, v1.id, {
      expectedRevision: currentRevision,
    });

    expect(restoreResult.success).toBe(true);
    expect(restoreResult.snapshotData).toEqual(v1Content);

    // Verify database state:
    const allVersions = await prisma.artifactVersion.findMany({
      where: { artifactId: doc.id },
      orderBy: { versionNumber: "asc" },
    });

    // We expect:
    // 1: Clean Baseline (MANUAL)
    // 2: Messy Edits (MANUAL)
    // 3: Displaced state (RESTORE_RECOVERY)
    // 4: Restored to version 1 (RESTORED)
    expect(allVersions.length).toBe(4);

    const recoveryVer = allVersions.find((v) => v.source === "RESTORE_RECOVERY");
    expect(recoveryVer).toBeDefined();
    expect(recoveryVer?.snapshotData).toEqual(uncommittedContent);

    const restoredVer = allVersions.find((v) => v.source === "RESTORED");
    expect(restoredVer).toBeDefined();
    expect(restoredVer?.restoredFromVersion).toBe(1);
    expect(restoredVer?.snapshotData).toEqual(v1Content);

    // Current snapshot on artifact now matches v1
    const finalDoc = await prisma.artifact.findUnique({ where: { id: doc.id } });
    expect(finalDoc?.currentSnapshot).toEqual(v1Content);
  });

  it("6. Rejects stale restore with 409 ConflictError when expectedRevision does not match current state", async () => {
    const { editor, workspace } = await createTestWorkspaceWithUsers();

    const doc = await ArtifactService.createArtifact(editor.id, {
      workspaceId: workspace.id,
      type: "DOCUMENT",
      title: "Concurrency Conflict Test",
    });

    const v1 = await VersionService.createCheckpoint(editor.id, doc.id, {
      title: "Base Version",
      snapshotData: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "V1 content" }] }],
      },
      source: "MANUAL",
    });

    const docBefore = await prisma.artifact.findUnique({ where: { id: doc.id } });
    const staleRevision = docBefore!.currentRevision;

    // Simulate another collaborator modifying the document while user was previewing
    await ArtifactService.updateArtifact(editor.id, doc.id, {
      contentSnapshot: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Concurrent collaborator edit" }] }],
      },
    });

    // Attempting restore with staleRevision fails with ConflictError (409)
    await expect(
      VersionService.restoreVersion(editor.id, doc.id, v1.id, {
        expectedRevision: staleRevision,
      })
    ).rejects.toThrow(ConflictError);
  });

  it("7. Supports Whiteboard snapshot validation and restoration", async () => {
    const { editor, workspace } = await createTestWorkspaceWithUsers();

    const board = await ArtifactService.createArtifact(editor.id, {
      workspaceId: workspace.id,
      type: "WHITEBOARD",
      title: "Topology Whiteboard",
    });

    const boardV1 = {
      elements: [
        { id: "node-1", type: "rectangle", x: 50, y: 50, width: 100, height: 100, version: 1, isDeleted: false },
      ],
    };

    const v1 = await VersionService.createCheckpoint(editor.id, board.id, {
      title: "Initial Topology",
      snapshotData: boardV1,
      source: "MANUAL",
    });

    const boardV2 = {
      elements: [
        { id: "node-1", type: "rectangle", x: 50, y: 50, width: 100, height: 100, version: 1, isDeleted: false },
        { id: "node-2", type: "ellipse", x: 200, y: 50, width: 100, height: 100, version: 1, isDeleted: false },
      ],
    };

    await VersionService.createCheckpoint(editor.id, board.id, {
      title: "Added Node 2",
      snapshotData: boardV2,
      source: "MANUAL",
    });

    // Restore back to v1
    const restoreRes = await VersionService.restoreVersion(editor.id, board.id, v1.id);
    expect(restoreRes.success).toBe(true);
    expect(restoreRes.snapshotData).toEqual(boardV1);

    const refreshedBoard = await prisma.artifact.findUnique({ where: { id: board.id } });
    expect(refreshedBoard?.currentSnapshot).toEqual(boardV1);
  });
});
