import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { WorkspaceService } from "@/services/workspace.service";
import { ArtifactService } from "@/services/artifact.service";
import { InvitationService } from "@/services/invitation.service";
import {
  AuthorizationService,
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";
import { createHash } from "crypto";

beforeAll(async () => {
  // Ensure live PostgreSQL database connection
  await prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Phase 7A — Invitations, Sharing and Access Management Database Integration Tests", () => {
  // Helper to create test user
  async function createTestUser(roleSuffix: string) {
    const email = `test.${roleSuffix}.${Date.now()}.${Math.random()
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

  it("verifies full invitation creation, token hashing at rest, and atomic acceptance", async () => {
    // 1. Create owner and workspace
    const owner = await createTestUser("owner");
    const workspace = await WorkspaceService.createWorkspace(owner.id, {
      name: "Invitation Test Space",
      createDefaultProject: true,
    });

    // 2. Create invitee user
    const invitee = await createTestUser("invitee");

    // 3. Owner creates invitation
    const { invitation, rawToken, inviteUrl, emailDelivery } =
      await InvitationService.createInvitation(owner.id, workspace.id, {
        email: invitee.email,
        role: "EDITOR",
      });

    expect(invitation.id).toBeDefined();
    expect(invitation.email).toBe(invitee.email.toLowerCase());
    expect(invitation.role).toBe("EDITOR");
    expect(invitation.status).toBe("PENDING");
    expect(rawToken).toBeDefined();
    expect(inviteUrl).toContain(rawToken);
    expect(emailDelivery.status).toBe("not_configured");

    // 4. Verify token hashing at rest in PostgreSQL
    const storedInvitation = await prisma.invitation.findUnique({
      where: { id: invitation.id },
    });
    expect(storedInvitation).toBeDefined();
    expect(storedInvitation?.token).not.toBe(rawToken);
    const expectedHash = createHash("sha256").update(rawToken).digest("hex");
    expect(storedInvitation?.token).toBe(expectedHash);

    // 5. Validate invitation token via public validation method
    const validation = await InvitationService.validateInvitationToken(rawToken);
    expect(validation.valid).toBe(true);
    expect(validation.code).toBe("VALID");
    expect(validation.invitation?.workspace.id).toBe(workspace.id);

    // 6. Invitee accepts invitation
    const acceptResult = await InvitationService.acceptInvitation(
      invitee.id,
      rawToken
    );
    expect(acceptResult.workspaceId).toBe(workspace.id);
    expect(acceptResult.role).toBe("EDITOR");
    expect(acceptResult.alreadyMember).toBe(false);

    // 7. Verify membership persisted in PostgreSQL
    const membership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId: invitee.id,
        },
      },
    });
    expect(membership).toBeDefined();
    expect(membership?.role).toBe("EDITOR");

    // 8. Verify invitation marked ACCEPTED in PostgreSQL
    const updatedInv = await prisma.invitation.findUnique({
      where: { id: invitation.id },
    });
    expect(updatedInv?.status).toBe("ACCEPTED");

    // 9. Re-accepting is safely rejected
    await expect(
      InvitationService.acceptInvitation(invitee.id, rawToken)
    ).rejects.toThrow("already been accepted");
  });

  it("strictly rejects acceptance when the authenticated user's email does not match", async () => {
    const owner = await createTestUser("owner");
    const workspace = await WorkspaceService.createWorkspace(owner.id, {
      name: "Email Mismatch Space",
    });

    const intendedInviteeEmail = `intended.${Date.now()}@syncspace.dev`;
    const differentUser = await createTestUser("different");

    const { rawToken } = await InvitationService.createInvitation(
      owner.id,
      workspace.id,
      {
        email: intendedInviteeEmail,
        role: "VIEWER",
      }
    );

    // Different user attempts to accept
    await expect(
      InvitationService.acceptInvitation(differentUser.id, rawToken)
    ).rejects.toThrow(/sent to.*different/i);

    // Verify different user did NOT receive membership
    const membership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId: differentUser.id,
        },
      },
    });
    expect(membership).toBeNull();
  });

  it("handles revoked and expired invitations safely", async () => {
    const owner = await createTestUser("owner");
    const workspace = await WorkspaceService.createWorkspace(owner.id, {
      name: "Revocation Space",
    });
    const invitee = await createTestUser("invitee");

    // Create and revoke invitation
    const { invitation, rawToken } = await InvitationService.createInvitation(
      owner.id,
      workspace.id,
      {
        email: invitee.email,
        role: "EDITOR",
      }
    );

    await InvitationService.revokeInvitation(owner.id, invitation.id);

    // Validate token indicates revoked
    const validation = await InvitationService.validateInvitationToken(rawToken);
    expect(validation.valid).toBe(false);
    expect(validation.code).toBe("REVOKED");

    // Attempting to accept throws
    await expect(
      InvitationService.acceptInvitation(invitee.id, rawToken)
    ).rejects.toThrow(/revoked/i);

    // Test expired invitation
    const { invitation: expiredInv, rawToken: expiredToken } =
      await InvitationService.createInvitation(owner.id, workspace.id, {
        email: `expired.${Date.now()}@syncspace.dev`,
        role: "VIEWER",
      });

    // Manually set expiration in the past
    await prisma.invitation.update({
      where: { id: expiredInv.id },
      data: { expiresAt: new Date(Date.now() - 1000 * 60) },
    });

    const expiredValidation =
      await InvitationService.validateInvitationToken(expiredToken);
    expect(expiredValidation.valid).toBe(false);
    expect(expiredValidation.code).toBe("EXPIRED");

    await expect(
      InvitationService.acceptInvitation(invitee.id, expiredToken)
    ).rejects.toThrow(/expired/i);
  });

  it("enforces role restrictions: cannot invite OWNER, and ADMIN cannot invite ADMIN", async () => {
    const owner = await createTestUser("owner");
    const workspace = await WorkspaceService.createWorkspace(owner.id, {
      name: "Role Policy Space",
    });

    // Owner cannot invite an OWNER
    await expect(
      InvitationService.createInvitation(owner.id, workspace.id, {
        email: "future.owner@syncspace.dev",
        role: "OWNER",
      })
    ).rejects.toThrow(/ownership cannot be granted/i);

    // Create an ADMIN member
    const adminUser = await createTestUser("admin");
    await prisma.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: adminUser.id,
        role: "ADMIN",
      },
    });

    // ADMIN cannot invite another ADMIN
    await expect(
      InvitationService.createInvitation(adminUser.id, workspace.id, {
        email: "peer.admin@syncspace.dev",
        role: "ADMIN",
      })
    ).rejects.toThrow(/Administrators cannot invite other administrators/i);

    // ADMIN can invite EDITOR or VIEWER
    const editorInvite = await InvitationService.createInvitation(
      adminUser.id,
      workspace.id,
      {
        email: "editor.invitee@syncspace.dev",
        role: "EDITOR",
      }
    );
    expect(editorInvite.invitation.id).toBeDefined();

    // Regular member (EDITOR) cannot invite anyone
    const regularUser = await createTestUser("regular");
    await prisma.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: regularUser.id,
        role: "EDITOR",
      },
    });

    await expect(
      InvitationService.createInvitation(regularUser.id, workspace.id, {
        email: "someone@syncspace.dev",
        role: "VIEWER",
      })
    ).rejects.toThrow(AuthorizationError);
  });

  it("protects against removing or demoting the last workspace owner", async () => {
    const owner = await createTestUser("single-owner");
    const workspace = await WorkspaceService.createWorkspace(owner.id, {
      name: "Solo Owner Space",
    });

    const ownerMembership = await prisma.workspaceMember.findFirst({
      where: { workspaceId: workspace.id, userId: owner.id },
    });
    expect(ownerMembership).toBeDefined();

    // Attempting to demote the only owner must fail
    await expect(
      WorkspaceService.updateMemberRole(
        owner.id,
        workspace.id,
        ownerMembership!.id,
        "ADMIN"
      )
    ).rejects.toThrow(/Cannot demote the only workspace owner/i);

    // Attempting to remove the only owner must fail
    await expect(
      WorkspaceService.removeMember(owner.id, workspace.id, ownerMembership!.id)
    ).rejects.toThrow(/Cannot remove the only workspace owner/i);

    // Add a second owner
    const secondOwner = await createTestUser("second-owner");
    const secondMembership = await prisma.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: secondOwner.id,
        role: "OWNER",
      },
    });

    // Now demoting one owner succeeds because 2 owners exist
    const demoted = await WorkspaceService.updateMemberRole(
      owner.id,
      workspace.id,
      secondMembership.id,
      "ADMIN"
    );
    expect(demoted.role).toBe("ADMIN");
  });

  it("enforces artifact-level sharing overrides: EDITOR, VIEWER, and NONE precedence", async () => {
    // 1. Setup workspace with Owner and an Editor member
    const owner = await createTestUser("owner");
    const workspace = await WorkspaceService.createWorkspace(owner.id, {
      name: "Artifact Sharing Space",
      createDefaultProject: true,
    });

    const editorMember = await createTestUser("editor");
    await prisma.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: editorMember.id,
        role: "EDITOR",
      },
    });

    // 2. Create artifact
    const artifact = await ArtifactService.createArtifact(owner.id, {
      workspaceId: workspace.id,
      type: "DOCUMENT",
      title: "Confidential Project Spec",
    });

    // 3. By default, editor has EDIT access
    const defaultAccess = await AuthorizationService.requireArtifactAccess(
      editorMember.id,
      artifact.id,
      "EDIT"
    );
    expect(defaultAccess.effectiveRole).toBe("EDITOR");

    // 4. Set explicit VIEWER override on the artifact
    await ArtifactService.setArtifactPermission(
      owner.id,
      artifact.id,
      editorMember.id,
      "VIEWER"
    );

    // Editor can now only VIEW, not EDIT
    const viewerAccess = await AuthorizationService.requireArtifactAccess(
      editorMember.id,
      artifact.id,
      "VIEW"
    );
    expect(viewerAccess.effectiveRole).toBe("VIEWER");

    // EDIT access is denied
    await expect(
      AuthorizationService.requireArtifactAccess(
        editorMember.id,
        artifact.id,
        "EDIT"
      )
    ).rejects.toThrow(/Edit permission required/i);

    // Liveblocks room access check enforces canWrite: false
    const roomAccess = await AuthorizationService.requireArtifactRoomAccess(
      editorMember.id,
      artifact.liveblocksRoomId,
      "DOCUMENT"
    );
    expect(roomAccess.effectiveRole).toBe("VIEWER");
    expect(roomAccess.canWrite).toBe(false);

    // 5. Set explicit NONE override (revocation)
    await ArtifactService.setArtifactPermission(
      owner.id,
      artifact.id,
      editorMember.id,
      "NONE"
    );

    // Even VIEW access is now denied with 403
    await expect(
      AuthorizationService.requireArtifactAccess(
        editorMember.id,
        artifact.id,
        "VIEW"
      )
    ).rejects.toThrow(/explicitly revoked/i);

    await expect(
      AuthorizationService.requireArtifactRoomAccess(
        editorMember.id,
        artifact.liveblocksRoomId,
        "DOCUMENT"
      )
    ).rejects.toThrow(/explicitly revoked/i);

    // 6. Reset override to INHERIT
    await ArtifactService.setArtifactPermission(
      owner.id,
      artifact.id,
      editorMember.id,
      "INHERIT"
    );

    // Restores default EDITOR access
    const restoredAccess = await AuthorizationService.requireArtifactAccess(
      editorMember.id,
      artifact.id,
      "EDIT"
    );
    expect(restoredAccess.effectiveRole).toBe("EDITOR");
  });

  it("verifies member removal revokes workspace and room access and cleans up overrides", async () => {
    const owner = await createTestUser("owner");
    const workspace = await WorkspaceService.createWorkspace(owner.id, {
      name: "Eviction Space",
    });

    const member = await createTestUser("evicted-member");
    const membership = await prisma.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: member.id,
        role: "EDITOR",
      },
    });

    const artifact = await ArtifactService.createArtifact(owner.id, {
      workspaceId: workspace.id,
      type: "WHITEBOARD",
      title: "Architecture Diagram",
    });

    // Add an override
    await ArtifactService.setArtifactPermission(
      owner.id,
      artifact.id,
      member.id,
      "VIEWER"
    );

    // Remove member via WorkspaceService
    await WorkspaceService.removeMember(owner.id, workspace.id, membership.id);

    // 1. Membership is gone
    const checkMember = await prisma.workspaceMember.findUnique({
      where: { id: membership.id },
    });
    expect(checkMember).toBeNull();

    // 2. Artifact override was cleaned up
    const overrides = await prisma.artifactPermission.findMany({
      where: { userId: member.id, artifactId: artifact.id },
    });
    expect(overrides.length).toBe(0);

    // 3. Workspace access is denied
    await expect(
      AuthorizationService.requireWorkspaceAccess(member.id, workspace.id)
    ).rejects.toThrow(NotFoundError);

    // 4. Room access is denied
    await expect(
      AuthorizationService.requireArtifactRoomAccess(
        member.id,
        artifact.liveblocksRoomId,
        "WHITEBOARD"
      )
    ).rejects.toThrow(NotFoundError);
  });
});
