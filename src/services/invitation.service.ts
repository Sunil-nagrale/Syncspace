import { prisma } from "@/lib/prisma";
import {
  AuthorizationService,
  AuthorizationError,
  NotFoundError,
} from "./authorization.service";
import { sanitizeActivityMetadata } from "@/lib/validations/activity";
import { Invitation, WorkspaceRole, InvitationStatus } from "@prisma/client";
import { randomBytes, createHash } from "crypto";

export interface CreateInvitationInput {
  email: string;
  role?: WorkspaceRole;
}

export interface InvitationValidationResult {
  valid: boolean;
  code: "VALID" | "INVALID" | "EXPIRED" | "REVOKED" | "ACCEPTED";
  message: string;
  invitation?: {
    id: string;
    email: string;
    role: WorkspaceRole;
    status: InvitationStatus;
    expiresAt: Date;
    workspace: {
      id: string;
      name: string;
      slug: string;
      logoUrl: string | null;
    };
    invitedBy: {
      id: string;
      name: string;
      email: string;
    };
  };
}

export interface CreateInvitationResult {
  invitation: Invitation;
  rawToken: string;
  inviteUrl: string;
  emailDelivery: {
    status: "not_configured";
    message: string;
  };
}

export class InvitationService {
  /**
   * Hashes a raw bearer token with SHA-256 for safe storage at rest.
   */
  static hashToken(rawToken: string): string {
    return createHash("sha256").update(rawToken.trim()).digest("hex");
  }

  /**
   * Generates a cryptographically strong unpredictable token and its SHA-256 hash.
   */
  static generateSecureToken(): { rawToken: string; tokenHash: string } {
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = this.hashToken(rawToken);
    return { rawToken, tokenHash };
  }

  /**
   * Normalizes an email address for uniform comparisons.
   */
  static normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Resolves the application base URL for building invite links.
   */
  static getBaseUrl(): string {
    return (
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.BETTER_AUTH_URL ||
      "http://localhost:3000"
    ).replace(/\/$/, "");
  }

  /**
   * Creates a new workspace invitation with role-based policies and token hashing.
   */
  static async createInvitation(
    actorUserId: string,
    workspaceId: string,
    input: CreateInvitationInput
  ): Promise<CreateInvitationResult> {
    if (!actorUserId) {
      throw new AuthorizationError("Authentication required.", 401);
    }

    // Require at least ADMIN role in the target workspace
    const actorMembership = await AuthorizationService.requireWorkspaceAccess(
      actorUserId,
      workspaceId,
      "ADMIN"
    );

    const email = this.normalizeEmail(input.email);
    if (!email || !email.includes("@")) {
      throw new Error("A valid recipient email address is required.");
    }

    const requestedRole: WorkspaceRole = input.role ?? "EDITOR";

    // Rule: Invitations can NEVER grant OWNER status
    if (requestedRole === "OWNER") {
      throw new AuthorizationError(
        "Workspace ownership cannot be granted through invitations.",
        400
      );
    }

    // Rule: ADMINs can only invite EDITORS or VIEWERS. Only OWNER can invite an ADMIN.
    if (actorMembership.role === "ADMIN" && requestedRole === "ADMIN") {
      throw new AuthorizationError(
        "Administrators cannot invite other administrators. Only the workspace owner can invite an administrator.",
        403
      );
    }

    // Check if target user is already an active member of this workspace
    const targetUser = await prisma.user.findUnique({
      where: { email },
    });

    if (targetUser) {
      const existingMembership = await prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId,
            userId: targetUser.id,
          },
        },
      });

      if (existingMembership) {
        throw new AuthorizationError(
          "This user is already an active member of this workspace.",
          400
        );
      }
    }

    // Generate cryptographic token and hash
    const { rawToken, tokenHash } = this.generateSecureToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7-day expiration

    const invitation = await prisma.$transaction(async (tx) => {
      // Revoke any previous pending invitation for this workspace + email
      await tx.invitation.updateMany({
        where: {
          workspaceId,
          email,
          status: "PENDING",
        },
        data: {
          status: "REVOKED",
        },
      });

      const created = await tx.invitation.create({
        data: {
          workspaceId,
          email,
          role: requestedRole,
          token: tokenHash,
          invitedById: actorUserId,
          status: "PENDING",
          expiresAt,
        },
      });

      // Record audit event without exposing recipient email or bearer token
      await tx.activityEvent.create({
        data: {
          workspaceId,
          userId: actorUserId,
          action: "invitation.created",
          entityType: "invitation",
          entityId: created.id,
          metadata: sanitizeActivityMetadata({
            role: requestedRole,
          }),
        },
      });

      return created;
    });

    const inviteUrl = `${this.getBaseUrl()}/app/invitations/${rawToken}`;

    return {
      invitation,
      rawToken,
      inviteUrl,
      emailDelivery: {
        status: "not_configured",
        message:
          "Email delivery is not configured. Please copy and share the invitation link directly with the invitee.",
      },
    };
  }

  /**
   * Validates an invitation using its raw token (hashes rawToken to query DB).
   */
  static async validateInvitationToken(
    rawToken: string
  ): Promise<InvitationValidationResult> {
    if (!rawToken || typeof rawToken !== "string" || rawToken.trim().length === 0) {
      return {
        valid: false,
        code: "INVALID",
        message: "No invitation token provided.",
      };
    }

    const tokenHash = this.hashToken(rawToken);

    const invitation = await prisma.invitation.findUnique({
      where: { token: tokenHash },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
          },
        },
        invitedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!invitation) {
      return {
        valid: false,
        code: "INVALID",
        message: "This invitation link is invalid or does not exist.",
      };
    }

    if (invitation.status === "REVOKED") {
      return {
        valid: false,
        code: "REVOKED",
        message: "This invitation has been revoked by a workspace administrator.",
      };
    }

    if (invitation.status === "ACCEPTED") {
      return {
        valid: false,
        code: "ACCEPTED",
        message: "This invitation has already been accepted.",
      };
    }

    if (invitation.status === "EXPIRED" || invitation.expiresAt < new Date()) {
      if (invitation.status !== "EXPIRED") {
        await prisma.invitation.update({
          where: { id: invitation.id },
          data: { status: "EXPIRED" },
        });
      }
      return {
        valid: false,
        code: "EXPIRED",
        message: "This invitation has expired. Please ask for a new invitation.",
      };
    }

    return {
      valid: true,
      code: "VALID",
      message: "Invitation is valid.",
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        workspace: invitation.workspace,
        invitedBy: invitation.invitedBy,
      },
    };
  }

  /**
   * Accepts an invitation inside an isolated atomic transaction.
   * Enforces that the authenticated user's email strictly matches the invitation email.
   */
  static async acceptInvitation(
    actorUserId: string,
    rawToken: string
  ): Promise<{
    workspaceId: string;
    workspaceSlug: string;
    role: WorkspaceRole;
    alreadyMember: boolean;
  }> {
    if (!actorUserId) {
      throw new AuthorizationError("Authentication required to accept an invitation.", 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: actorUserId },
    });

    if (!user) {
      throw new NotFoundError("Authenticated user account not found.");
    }

    const tokenHash = this.hashToken(rawToken);

    return prisma.$transaction(async (tx) => {
      // Re-read invitation within transaction to prevent race conditions
      const invitation = await tx.invitation.findUnique({
        where: { token: tokenHash },
        include: {
          workspace: {
            select: {
              id: true,
              slug: true,
              name: true,
            },
          },
        },
      });

      if (!invitation) {
        throw new NotFoundError("Invitation not found or invalid token.");
      }

      if (invitation.status === "REVOKED") {
        throw new AuthorizationError(
          "This invitation has been revoked by an administrator.",
          400
        );
      }

      if (invitation.status === "ACCEPTED") {
        throw new AuthorizationError(
          "This invitation has already been accepted.",
          400
        );
      }

      if (invitation.status === "EXPIRED" || invitation.expiresAt < new Date()) {
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { status: "EXPIRED" },
        });
        throw new AuthorizationError("This invitation has expired.", 400);
      }

      // Enforce strict email matching between invitation and session user
      const normalizedInvEmail = this.normalizeEmail(invitation.email);
      const normalizedUserEmail = this.normalizeEmail(user.email);

      if (normalizedInvEmail !== normalizedUserEmail) {
        throw new AuthorizationError(
          `This invitation was sent to ${invitation.email}. You are currently signed in as ${user.email}. Please sign in with the invited email address to accept.`,
          403
        );
      }

      // Check if user is already a member
      const existingMember = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: invitation.workspaceId,
            userId: actorUserId,
          },
        },
      });

      if (existingMember) {
        // Mark invitation as accepted without creating duplicate membership or altering existing role
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { status: "ACCEPTED" },
        });

        return {
          workspaceId: invitation.workspaceId,
          workspaceSlug: invitation.workspace.slug,
          role: existingMember.role,
          alreadyMember: true,
        };
      }

      // Atomically create membership and mark invitation as accepted
      await tx.workspaceMember.create({
        data: {
          workspaceId: invitation.workspaceId,
          userId: actorUserId,
          role: invitation.role,
        },
      });

      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: "ACCEPTED" },
      });

      // Log activity event
      await tx.activityEvent.create({
        data: {
          workspaceId: invitation.workspaceId,
          userId: actorUserId,
          action: "invitation.accepted",
          entityType: "workspace_member",
          entityId: invitation.workspaceId,
          metadata: sanitizeActivityMetadata({
            role: invitation.role,
          }),
        },
      });

      return {
        workspaceId: invitation.workspaceId,
        workspaceSlug: invitation.workspace.slug,
        role: invitation.role,
        alreadyMember: false,
      };
    });
  }

  /**
   * Declines an invitation by marking it as REVOKED.
   */
  static async declineInvitation(
    actorUserId: string,
    rawToken: string
  ): Promise<{ success: boolean }> {
    if (!actorUserId) {
      throw new AuthorizationError("Authentication required.", 401);
    }

    const tokenHash = this.hashToken(rawToken);
    const invitation = await prisma.invitation.findUnique({
      where: { token: tokenHash },
    });

    if (!invitation) {
      throw new NotFoundError("Invitation not found.");
    }

    if (invitation.status === "PENDING") {
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: "REVOKED" },
      });
    }

    return { success: true };
  }

  /**
   * Revokes an existing invitation (requires ADMIN in workspace).
   */
  static async revokeInvitation(
    actorUserId: string,
    invitationId: string
  ): Promise<Invitation> {
    const invitation = await prisma.invitation.findUnique({
      where: { id: invitationId },
    });

    if (!invitation) {
      throw new NotFoundError("Invitation not found.");
    }

    await AuthorizationService.requireWorkspaceAccess(
      actorUserId,
      invitation.workspaceId,
      "ADMIN"
    );

    return prisma.$transaction(async (tx) => {
      const updated = await tx.invitation.update({
        where: { id: invitationId },
        data: { status: "REVOKED" },
      });

      await tx.activityEvent.create({
        data: {
          workspaceId: invitation.workspaceId,
          userId: actorUserId,
          action: "invitation.revoked",
          entityType: "invitation",
          entityId: invitation.id,
          metadata: sanitizeActivityMetadata({
            role: invitation.role,
          }),
        },
      });

      return updated;
    });
  }

  /**
   * Resends / regenerates an invitation with a fresh cryptographic token and 7-day expiration.
   */
  static async resendInvitation(
    actorUserId: string,
    invitationId: string
  ): Promise<CreateInvitationResult> {
    const invitation = await prisma.invitation.findUnique({
      where: { id: invitationId },
    });

    if (!invitation) {
      throw new NotFoundError("Invitation not found.");
    }

    await AuthorizationService.requireWorkspaceAccess(
      actorUserId,
      invitation.workspaceId,
      "ADMIN"
    );

    const { rawToken, tokenHash } = this.generateSecureToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const updated = await prisma.$transaction(async (tx) => {
      const record = await tx.invitation.update({
        where: { id: invitationId },
        data: {
          token: tokenHash,
          status: "PENDING",
          expiresAt,
        },
      });

      await tx.activityEvent.create({
        data: {
          workspaceId: invitation.workspaceId,
          userId: actorUserId,
          action: "invitation.resent",
          entityType: "invitation",
          entityId: invitation.id,
          metadata: sanitizeActivityMetadata({
            role: invitation.role,
          }),
        },
      });

      return record;
    });

    const inviteUrl = `${this.getBaseUrl()}/app/invitations/${rawToken}`;

    return {
      invitation: updated,
      rawToken,
      inviteUrl,
      emailDelivery: {
        status: "not_configured",
        message:
          "Email delivery is not configured. Please copy and share the invitation link directly with the invitee.",
      },
    };
  }

  /**
   * Lists all invitations for a workspace (requires ADMIN in workspace).
   */
  static async listWorkspaceInvitations(
    actorUserId: string,
    workspaceId: string
  ) {
    await AuthorizationService.requireWorkspaceAccess(
      actorUserId,
      workspaceId,
      "ADMIN"
    );

    return prisma.invitation.findMany({
      where: { workspaceId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        invitedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
