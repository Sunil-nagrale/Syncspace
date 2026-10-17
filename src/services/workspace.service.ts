import { prisma } from "@/lib/prisma";
import {
  AuthorizationService,
  AuthorizationError,
  NotFoundError,
} from "./authorization.service";
import { sanitizeActivityMetadata } from "@/lib/validations/activity";
import { Workspace, WorkspaceRole } from "@prisma/client";
import { randomBytes } from "crypto";

export interface CreateWorkspaceInput {
  name: string;
  slug?: string;
  logoUrl?: string;
  createDefaultProject?: boolean;
}

export interface WorkspaceWithRole extends Workspace {
  currentUserRole: WorkspaceRole;
  _count?: {
    members: number;
    projects: number;
    artifacts: number;
  };
}

export class WorkspaceService {
  /**
   * Slugify a string for URL-safe identifiers
   */
  static slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  /**
   * Create a new workspace and automatically set the creator as OWNER
   */
  static async createWorkspace(
    userId: string,
    input: CreateWorkspaceInput
  ): Promise<WorkspaceWithRole> {
    if (!userId) {
      throw new AuthorizationError("Authentication required.", 401);
    }

    if (!input.name || input.name.trim().length === 0) {
      throw new Error("Workspace name is required.");
    }

    let baseSlug = input.slug
      ? this.slugify(input.slug)
      : this.slugify(input.name);

    if (!baseSlug) {
      baseSlug = "workspace";
    }

    // Check slug uniqueness; append random suffix if collision occurs
    let finalSlug = baseSlug;
    const existing = await prisma.workspace.findUnique({
      where: { slug: finalSlug },
    });

    if (existing) {
      finalSlug = `${baseSlug}-${randomBytes(3).toString("hex")}`;
    }

    // Transaction to create workspace, owner membership, and optional starter project
    const result = await prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name: input.name.trim(),
          slug: finalSlug,
          logoUrl: input.logoUrl,
          createdById: userId,
        },
      });

      const member = await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId,
          role: "OWNER",
        },
      });

      // Log activity event
      await tx.activityEvent.create({
        data: {
          workspaceId: workspace.id,
          userId,
          action: "workspace.created",
          entityType: "workspace",
          entityId: workspace.id,
          metadata: sanitizeActivityMetadata({ name: workspace.name }),
        },
      });

      if (input.createDefaultProject) {
        await tx.project.create({
          data: {
            workspaceId: workspace.id,
            name: "General",
            description: "Default workspace project",
            createdById: userId,
            icon: "Folder",
            color: "#6366F1",
          },
        });
      }

      return { workspace, member };
    });

    return {
      ...result.workspace,
      currentUserRole: "OWNER",
    };
  }

  /**
   * List all workspaces for a given user
   */
  static async getUserWorkspaces(userId: string): Promise<WorkspaceWithRole[]> {
    if (!userId) return [];

    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      include: {
        workspace: {
          include: {
            _count: {
              select: {
                members: true,
                projects: { where: { isArchived: false } },
                artifacts: { where: { isArchived: false } },
              },
            },
          },
        },
      },
      orderBy: {
        joinedAt: "asc",
      },
    });

    return memberships.map((m) => ({
      ...m.workspace,
      currentUserRole: m.role,
    }));
  }

  /**
   * Get a workspace by slug with access control check
   */
  static async getWorkspaceBySlug(
    userId: string,
    slug: string
  ): Promise<WorkspaceWithRole> {
    const workspace = await prisma.workspace.findUnique({
      where: { slug },
      include: {
        _count: {
          select: {
            members: true,
            projects: { where: { isArchived: false } },
            artifacts: { where: { isArchived: false } },
          },
        },
      },
    });

    if (!workspace) {
      throw new NotFoundError("Workspace not found.");
    }

    const membership = await AuthorizationService.requireWorkspaceAccess(
      userId,
      workspace.id,
      "VIEWER"
    );

    return {
      ...workspace,
      currentUserRole: membership.role,
    };
  }

  /**
   * Update workspace details (requires ADMIN or OWNER)
   */
  static async updateWorkspace(
    userId: string,
    workspaceId: string,
    data: { name?: string; logoUrl?: string }
  ): Promise<Workspace> {
    await AuthorizationService.requireWorkspaceAccess(userId, workspaceId, "ADMIN");

    return prisma.$transaction(async (tx) => {
      const updated = await tx.workspace.update({
        where: { id: workspaceId },
        data: {
          ...(data.name ? { name: data.name.trim() } : {}),
          ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl } : {}),
        },
      });

      await tx.activityEvent.create({
        data: {
          workspaceId,
          userId,
          action: "workspace.updated",
          entityType: "workspace",
          entityId: workspaceId,
          metadata: sanitizeActivityMetadata({
            name: updated.name,
          }),
        },
      });

      return updated;
    });
  }

  /**
   * List all members of a workspace (requires VIEWER access)
   */
  static async getWorkspaceMembers(userId: string, workspaceId: string) {
    await AuthorizationService.requireWorkspaceAccess(userId, workspaceId, "VIEWER");

    return prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            color: true,
          },
        },
      },
      orderBy: { joinedAt: "asc" },
    });
  }

  /**
   * Update a member's role in the workspace.
   * Enforces role boundaries and protects against removing or demoting the last owner.
   */
  static async updateMemberRole(
    actorUserId: string,
    workspaceId: string,
    memberId: string,
    newRole: WorkspaceRole
  ) {
    const actorMembership = await AuthorizationService.requireWorkspaceAccess(
      actorUserId,
      workspaceId,
      "ADMIN"
    );

    const targetMember = await prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    if (!targetMember) {
      throw new NotFoundError("Member not found in this workspace.");
    }

    // Rule: Non-owners cannot promote anyone to OWNER
    if (newRole === "OWNER" && actorMembership.role !== "OWNER") {
      throw new AuthorizationError(
        "Only workspace owners can promote members to the OWNER role.",
        403
      );
    }

    // Rule: Admins cannot change the role of an OWNER or another ADMIN
    if (actorMembership.role === "ADMIN") {
      if (targetMember.role === "OWNER") {
        throw new AuthorizationError(
          "Administrators cannot alter an owner's role.",
          403
        );
      }
      if (targetMember.role === "ADMIN" && targetMember.userId !== actorUserId) {
        throw new AuthorizationError(
          "Administrators cannot alter another administrator's role.",
          403
        );
      }
    }

    // Rule: Protect against demoting the last remaining OWNER
    if (targetMember.role === "OWNER" && newRole !== "OWNER") {
      const ownerCount = await prisma.workspaceMember.count({
        where: { workspaceId, role: "OWNER" },
      });

      if (ownerCount <= 1) {
        throw new AuthorizationError(
          "Cannot demote the only workspace owner. Assign another owner before demoting this account.",
          400
        );
      }
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.workspaceMember.update({
        where: { id: memberId },
        data: { role: newRole },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              color: true,
            },
          },
        },
      });

      await tx.activityEvent.create({
        data: {
          workspaceId,
          userId: actorUserId,
          action: "member.role_updated",
          entityType: "workspace_member",
          entityId: memberId,
          metadata: sanitizeActivityMetadata({
            targetUserId: targetMember.userId,
            previousRole: targetMember.role,
            newRole,
          }),
        },
      });

      return updated;
    });
  }

  /**
   * Remove a member from a workspace.
   * Enforces role boundaries, protects the last owner, and cleans up artifact overrides.
   */
  static async removeMember(
    actorUserId: string,
    workspaceId: string,
    memberId: string
  ) {
    const actorMembership = await AuthorizationService.requireWorkspaceAccess(
      actorUserId,
      workspaceId,
      "ADMIN"
    );

    const targetMember = await prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    if (!targetMember) {
      throw new NotFoundError("Member not found in this workspace.");
    }

    // Rule: Protect against removing the last remaining OWNER
    if (targetMember.role === "OWNER") {
      if (actorMembership.role !== "OWNER") {
        throw new AuthorizationError(
          "Only workspace owners can remove another owner.",
          403
        );
      }

      const ownerCount = await prisma.workspaceMember.count({
        where: { workspaceId, role: "OWNER" },
      });

      if (ownerCount <= 1) {
        throw new AuthorizationError(
          "Cannot remove the only workspace owner. Transfer ownership or delete the workspace.",
          400
        );
      }
    }

    // Rule: Admins cannot remove other ADMINs
    if (
      actorMembership.role === "ADMIN" &&
      targetMember.role === "ADMIN" &&
      targetMember.userId !== actorUserId
    ) {
      throw new AuthorizationError(
        "Administrators cannot remove other administrators. Only the owner can remove administrators.",
        403
      );
    }

    // Remove member and all their artifact permission overrides in an atomic transaction
    await prisma.$transaction(async (tx) => {
      // Clean up explicit artifact permission overrides in this workspace
      await tx.artifactPermission.deleteMany({
        where: {
          userId: targetMember.userId,
          artifact: { workspaceId },
        },
      });

      // Delete workspace membership
      await tx.workspaceMember.delete({
        where: { id: memberId },
      });

      // Log activity event without exposing email addresses
      await tx.activityEvent.create({
        data: {
          workspaceId,
          userId: actorUserId,
          action: "member.removed",
          entityType: "workspace_member",
          entityId: memberId,
          metadata: sanitizeActivityMetadata({
            targetUserId: targetMember.userId,
            removedUserRole: targetMember.role,
          }),
        },
      });
    });

    return { success: true };
  }
}
