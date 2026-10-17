import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { WorkspaceService } from "@/services/workspace.service";
import { ProjectService } from "@/services/project.service";
import { ArtifactService } from "@/services/artifact.service";
import { CommentService } from "@/services/comment.service";
import { VersionService } from "@/services/version.service";
import { AttachmentService } from "@/services/attachment.service";
import { InvitationService } from "@/services/invitation.service";
import { ActivityService } from "@/services/activity.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";
import { ActivityValidationError } from "@/lib/validations/activity";

const SAMPLE_PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex"
);

describe("Phase 10B Integration Tests — Secure Workspace Activity Feed & RBAC", () => {
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  async function createTestUser(prefix: string) {
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const user = await prisma.user.create({
      data: {
        email: `${prefix}.${unique}@syncspace.dev`,
        name: `${prefix.toUpperCase()} User ${unique.slice(-4)}`,
        emailVerified: true,
        color: "#6366F1",
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  afterAll(async () => {
    if (createdWorkspaceIds.length > 0) {
      await prisma.workspace.deleteMany({
        where: { id: { in: createdWorkspaceIds } },
      });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }
  });

  it("1. Records transactional activity events across artifacts, projects, comments, versions, attachments, invitations, and members without autosave spam or sensitive metadata leaks", async () => {
    const owner = await createTestUser("act_owner");
    const invitee = await createTestUser("act_invitee");

    // 1. Create workspace + update workspace settings
    const workspace = await WorkspaceService.createWorkspace(owner.id, {
      name: "Activity Audit Workspace",
    });
    createdWorkspaceIds.push(workspace.id);

    await WorkspaceService.updateWorkspace(owner.id, workspace.id, {
      name: "Activity Audit Workspace Renamed",
    });

    // 2. Project create + update
    const project = await ProjectService.createProject(owner.id, workspace.id, {
      name: "Core Platform Project",
      description: "Initial description",
    });
    await ProjectService.updateProject(owner.id, project.id, {
      name: "Core Platform Project v2",
    });

    // 3. Document create + metadata update + autosave suppression check
    const doc = await ArtifactService.createArtifact(owner.id, {
      workspaceId: workspace.id,
      title: "Architecture Spec Doc",
      type: "DOCUMENT",
      projectId: project.id,
    });

    // Ordinary contentSnapshot autosaves must NOT create activity.updated events
    await ArtifactService.updateArtifact(owner.id, doc.id, {
      contentSnapshot: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Autosaved keystroke content 1" }],
          },
        ],
      },
    });
    await ArtifactService.updateArtifact(owner.id, doc.id, {
      contentSnapshot: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Autosaved keystroke content 2" }],
          },
        ],
      },
    });

    const autosaveEvents = await prisma.activityEvent.findMany({
      where: {
        workspaceId: workspace.id,
        artifactId: doc.id,
        action: "artifact.updated",
      },
    });
    expect(autosaveEvents).toHaveLength(0);

    // Meaningful metadata update (title / pin) DOES record artifact.updated
    await ArtifactService.updateArtifact(owner.id, doc.id, {
      title: "Architecture Spec Doc Final",
      isPinned: true,
    });

    // 4. Comment thread create + reply + resolve + reopen + reply delete + thread delete
    const thread = await CommentService.createThread({
      actorUserId: owner.id,
      artifactId: doc.id,
      content: "Confidential comment body that must not appear in activity metadata",
      anchorType: "GENERAL",
    });

    const reply = await CommentService.createReply({
      actorUserId: owner.id,
      threadId: thread.id,
      content: "Confidential reply body that must not appear in activity metadata",
    });

    await CommentService.resolveThread(owner.id, thread.id);
    await CommentService.reopenThread(owner.id, thread.id);
    await CommentService.deleteComment({
      actorUserId: owner.id,
      commentId: reply.id,
    });
    await CommentService.deleteComment({
      actorUserId: owner.id,
      commentId: thread.rootComment!.id,
    });

    // 5. Version checkpoint (AUTOMATIC suppressed, MANUAL recorded) + restore
    await VersionService.createCheckpoint(owner.id, doc.id, {
      source: "AUTOMATIC",
      snapshotData: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Auto checkpoint snapshot" }],
          },
        ],
      },
    });

    const manualVersion = await VersionService.createCheckpoint(
      owner.id,
      doc.id,
      {
        source: "MANUAL",
        title: "Milestone v1",
        snapshotData: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Manual checkpoint snapshot" }],
            },
          ],
        },
      }
    );

    const latestArtifact = await prisma.artifact.findUniqueOrThrow({
      where: { id: doc.id },
    });

    await VersionService.restoreVersion(owner.id, doc.id, manualVersion.id, {
      expectedRevision: latestArtifact.currentRevision,
    });

    // 6. Attachment upload + delete
    const uploaded = await AttachmentService.uploadAttachment(owner.id, doc.id, {
      fileName: "system-diagram.png",
      fileType: "image/png",
      bytes: new Uint8Array(SAMPLE_PNG_BYTES),
    });
    await AttachmentService.deleteAttachment(owner.id, doc.id, uploaded.id);

    // 7. Invitation create + resend + accept + role update + remove member
    const inviteRes = await InvitationService.createInvitation(
      owner.id,
      workspace.id,
      {
        email: invitee.email,
        role: "EDITOR",
      }
    );
    const resentRes = await InvitationService.resendInvitation(
      owner.id,
      inviteRes.invitation.id
    );
    await InvitationService.acceptInvitation(invitee.id, resentRes.rawToken);

    const inviteeMembership = await prisma.workspaceMember.findUniqueOrThrow({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId: invitee.id,
        },
      },
    });

    await WorkspaceService.updateMemberRole(
      owner.id,
      workspace.id,
      inviteeMembership.id,
      "VIEWER"
    );
    await WorkspaceService.removeMember(
      owner.id,
      workspace.id,
      inviteeMembership.id
    );

    // Query full activity feed for owner
    const feed = await ActivityService.listWorkspaceActivity(
      owner.id,
      workspace.id,
      { limit: 50, category: "ALL" }
    );

    const actions = feed.items.map((i) => i.action);
    expect(actions).toContain("workspace.created");
    expect(actions).toContain("workspace.updated");
    expect(actions).toContain("project.created");
    expect(actions).toContain("project.updated");
    expect(actions).toContain("artifact.created.document");
    expect(actions).toContain("artifact.updated");
    expect(actions).toContain("comment.thread_created");
    expect(actions).toContain("comment.reply_created");
    expect(actions).toContain("comment.thread_resolved");
    expect(actions).toContain("comment.thread_reopened");
    expect(actions).toContain("comment.deleted");
    expect(actions).toContain("comment.thread_deleted");
    expect(actions).toContain("artifact.version.created");
    expect(actions).toContain("artifact.version.restored");
    expect(actions).toContain("UPLOADED_ATTACHMENT");
    expect(actions).toContain("DELETED_ATTACHMENT");
    expect(actions).toContain("invitation.created");
    expect(actions).toContain("invitation.resent");
    expect(actions).toContain("invitation.accepted");
    expect(actions).toContain("member.role_updated");
    expect(actions).toContain("member.removed");

    // Verify zero leakage of comment bodies, email addresses, tokens, storage keys, or sha256 in serialized feed
    const serializedFeed = JSON.stringify(feed);
    expect(serializedFeed).not.toContain(
      "Confidential comment body that must not appear"
    );
    expect(serializedFeed).not.toContain(
      "Confidential reply body that must not appear"
    );
    expect(serializedFeed).not.toContain(invitee.email);
    expect(serializedFeed).not.toContain(owner.email);
    expect(serializedFeed).not.toContain(resentRes.rawToken);
    expect(serializedFeed).not.toContain("workspaces/");
    expect(serializedFeed).not.toContain("sha256");
  });

  it("2. Enforces workspace isolation (401 unauthenticated, 404 for outsiders and removed members)", async () => {
    const owner = await createTestUser("iso_owner");
    const outsider = await createTestUser("iso_outsider");
    const formerMember = await createTestUser("iso_former");

    const workspace = await WorkspaceService.createWorkspace(owner.id, {
      name: "Isolated Activity Tenant",
    });
    createdWorkspaceIds.push(workspace.id);

    const membership = await prisma.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: formerMember.id,
        role: "VIEWER",
      },
    });

    await expect(
      ActivityService.listWorkspaceActivity("", workspace.id)
    ).rejects.toThrow(AuthorizationError);

    await expect(
      ActivityService.listWorkspaceActivity(outsider.id, workspace.id)
    ).rejects.toThrow(NotFoundError);

    // Active member can view initially
    const activeFeed = await ActivityService.listWorkspaceActivity(
      formerMember.id,
      workspace.id
    );
    expect(activeFeed.items.length).toBeGreaterThan(0);

    // Remove member -> immediately denied with 404 NotFoundError
    await WorkspaceService.removeMember(owner.id, workspace.id, membership.id);

    await expect(
      ActivityService.listWorkspaceActivity(formerMember.id, workspace.id)
    ).rejects.toThrow(NotFoundError);
  });

  it("3. Enforces artifact-level NONE permission overrides across artifact, comment, version, attachment, and permission events", async () => {
    const owner = await createTestUser("rbac_owner");
    const restrictedMember = await createTestUser("rbac_restricted");
    const allowedViewer = await createTestUser("rbac_viewer");

    const workspace = await WorkspaceService.createWorkspace(owner.id, {
      name: "RBAC Activity Workspace",
    });
    createdWorkspaceIds.push(workspace.id);

    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId: workspace.id, userId: restrictedMember.id, role: "EDITOR" },
        { workspaceId: workspace.id, userId: allowedViewer.id, role: "VIEWER" },
      ],
    });

    await ArtifactService.createArtifact(owner.id, {
      workspaceId: workspace.id,
      title: "Public Team Charter",
      type: "DOCUMENT",
    });

    const secretBoard = await ArtifactService.createArtifact(owner.id, {
      workspaceId: workspace.id,
      title: "Project Stealth M&A Whiteboard",
      type: "WHITEBOARD",
    });

    // Perform actions on secretBoard: comment, manual version, attachment upload, and NONE permission override
    await CommentService.createThread({
      actorUserId: owner.id,
      artifactId: secretBoard.id,
      content: "Stealth board comment",
    });

    await VersionService.createCheckpoint(owner.id, secretBoard.id, {
      source: "MANUAL",
      title: "Stealth Checkpoint v1",
      snapshotData: {
        elements: [
          {
            id: "el_1",
            type: "rectangle",
            x: 10,
            y: 10,
            width: 100,
            height: 80,
            version: 1,
            isDeleted: false,
          },
        ],
      },
    });

    await AttachmentService.uploadAttachment(owner.id, secretBoard.id, {
      fileName: "stealth-term-sheet.png",
      fileType: "image/png",
      bytes: new Uint8Array(SAMPLE_PNG_BYTES),
    });

    await ArtifactService.setArtifactPermission(
      owner.id,
      secretBoard.id,
      restrictedMember.id,
      "NONE"
    );

    // 1. Allowed viewer sees both publicDoc and secretBoard events
    const viewerFeed = await ActivityService.listWorkspaceActivity(
      allowedViewer.id,
      workspace.id,
      { limit: 50 }
    );
    const viewerSerialized = JSON.stringify(viewerFeed);
    expect(viewerSerialized).toContain("Public Team Charter");
    expect(viewerSerialized).toContain("Project Stealth M&A Whiteboard");
    expect(viewerSerialized).toContain("stealth-term-sheet.png");

    // 2. Restricted member with role = NONE on secretBoard MUST NOT see any event, title, filename, or ID for secretBoard
    const restrictedFeed = await ActivityService.listWorkspaceActivity(
      restrictedMember.id,
      workspace.id,
      { limit: 50 }
    );
    const restrictedSerialized = JSON.stringify(restrictedFeed);
    expect(restrictedSerialized).toContain("Public Team Charter");
    expect(restrictedSerialized).not.toContain("Project Stealth M&A Whiteboard");
    expect(restrictedSerialized).not.toContain("stealth-term-sheet.png");
    expect(restrictedSerialized).not.toContain("Stealth Checkpoint v1");
    expect(restrictedSerialized).not.toContain(secretBoard.id);

    // Even when filtering by COMMENT, VERSION, or ATTACHMENT categories, restrictedMember sees 0 events for secretBoard
    for (const category of ["COMMENT", "VERSION", "ATTACHMENT"] as const) {
      const catFeed = await ActivityService.listWorkspaceActivity(
        restrictedMember.id,
        workspace.id,
        { category }
      );
      expect(catFeed.items).toHaveLength(0);
    }
  });

  it("4. Redacts archived artifacts and archived projects safely and cascades hard-deleted artifacts", async () => {
    const owner = await createTestUser("arch_owner");
    const workspace = await WorkspaceService.createWorkspace(owner.id, {
      name: "Archive Redaction Workspace",
    });
    createdWorkspaceIds.push(workspace.id);

    const project = await ProjectService.createProject(owner.id, workspace.id, {
      name: "Classified Archived Project",
    });

    const doc = await ArtifactService.createArtifact(owner.id, {
      workspaceId: workspace.id,
      title: "Classified Archived Document",
      type: "DOCUMENT",
    });

    await AttachmentService.uploadAttachment(owner.id, doc.id, {
      fileName: "classified-budget.png",
      fileType: "image/png",
      bytes: new Uint8Array(SAMPLE_PNG_BYTES),
    });

    // Archive both the document and the project
    await ArtifactService.updateArtifact(owner.id, doc.id, {
      isArchived: true,
    });
    await ProjectService.archiveProject(owner.id, project.id);

    const feedAfterArchive = await ActivityService.listWorkspaceActivity(
      owner.id,
      workspace.id,
      { limit: 50 }
    );

    const serializedAfterArchive = JSON.stringify(feedAfterArchive);
    // Protected titles, filenames, and navigable links for archived entities must be redacted
    expect(serializedAfterArchive).not.toContain("Classified Archived Document");
    expect(serializedAfterArchive).not.toContain("classified-budget.png");
    expect(serializedAfterArchive).not.toContain("Classified Archived Project");
    expect(serializedAfterArchive).not.toContain(`/app/documents/${doc.id}`);
    expect(serializedAfterArchive).not.toContain(`/app/projects/${project.id}`);

    // Summaries still render cleanly without crashing
    const summaries = feedAfterArchive.items.map((i) => i.summary);
    expect(summaries).toContain("archived an artifact");
    expect(summaries).toContain("archived a project");

    // Hard-deleting the artifact cascades and removes all of its ActivityEvent rows
    await prisma.artifact.delete({ where: { id: doc.id } });

    const remainingArtifactEvents = await prisma.activityEvent.count({
      where: { artifactId: doc.id },
    });
    expect(remainingArtifactEvents).toBe(0);
  });

  it("5. Paginates deterministically with keyset cursors (including identical timestamps) and validates query bounds", async () => {
    const owner = await createTestUser("page_owner");
    const workspace = await WorkspaceService.createWorkspace(owner.id, {
      name: "Pagination Workspace",
    });
    createdWorkspaceIds.push(workspace.id);

    const fixedTimestamp = new Date("2026-10-17T12:00:00.000Z");
    for (let i = 1; i <= 5; i++) {
      await prisma.activityEvent.create({
        data: {
          id: `evt_tie_${i}`,
          workspaceId: workspace.id,
          userId: owner.id,
          action: "project.updated",
          entityType: "workspace",
          entityId: workspace.id,
          metadata: {},
          createdAt: fixedTimestamp,
        },
      });
    }

    const page1 = await ActivityService.listWorkspaceActivity(
      owner.id,
      workspace.id,
      { limit: 2, category: "PROJECT" }
    );
    expect(page1.items).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = await ActivityService.listWorkspaceActivity(
      owner.id,
      workspace.id,
      { limit: 2, category: "PROJECT", cursor: page1.nextCursor }
    );
    expect(page2.items).toHaveLength(2);
    expect(page2.hasMore).toBe(true);

    const page3 = await ActivityService.listWorkspaceActivity(
      owner.id,
      workspace.id,
      { limit: 2, category: "PROJECT", cursor: page2.nextCursor }
    );
    expect(page3.items).toHaveLength(1);
    expect(page3.hasMore).toBe(false);
    expect(page3.nextCursor).toBeNull();

    const allIds = [
      ...page1.items.map((i) => i.id),
      ...page2.items.map((i) => i.id),
      ...page3.items.map((i) => i.id),
    ];
    // Deterministic descending ID order for identical timestamps with zero duplicates
    expect(allIds).toEqual([
      "evt_tie_5",
      "evt_tie_4",
      "evt_tie_3",
      "evt_tie_2",
      "evt_tie_1",
    ]);

    // Invalid cursor or out-of-range limit throws ActivityValidationError (400)
    await expect(
      ActivityService.listWorkspaceActivity(owner.id, workspace.id, {
        limit: 999,
      })
    ).rejects.toThrow(ActivityValidationError);

    await expect(
      ActivityService.listWorkspaceActivity(owner.id, workspace.id, {
        cursor: "corrupted-cursor-token",
      })
    ).rejects.toThrow(ActivityValidationError);
  });
});
