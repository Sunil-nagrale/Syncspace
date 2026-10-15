import { prisma } from "@/lib/prisma";
import {
  WorkspaceRole,
  WorkspaceMember,
  Artifact,
  Project,
} from "@prisma/client";

export class AuthorizationError extends Error {
  constructor(
    message: string = "You do not have permission to perform this action.",
    public statusCode: number = 403
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class NotFoundError extends Error {
  constructor(
    message: string = "The requested resource was not found.",
    public statusCode: number = 404
  ) {
    super(message);
    this.name = "NotFoundError";
  }
}

const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  EDITOR: 2,
  VIEWER: 1,
};

export class AuthorizationService {
  /**
   * Check if a role satisfies the required minimum role level.
   */
  static hasMinimumRole(userRole: WorkspaceRole, requiredRole: WorkspaceRole): boolean {
    return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
  }

  /**
   * Get the active membership for a user in a specific workspace.
   */
  static async getWorkspaceMembership(
    userId: string,
    workspaceId: string
  ): Promise<WorkspaceMember | null> {
    if (!userId || !workspaceId) return null;

    return prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId,
        },
      },
    });
  }

  /**
   * Enforces that a user is a member of the workspace with at least the required role.
   * Prevents IDOR and cross-tenant leakage.
   */
  static async requireWorkspaceAccess(
    userId: string,
    workspaceId: string,
    minRole: WorkspaceRole = "VIEWER"
  ): Promise<WorkspaceMember> {
    if (!userId) {
      throw new AuthorizationError("Authentication required.", 401);
    }

    const membership = await this.getWorkspaceMembership(userId, workspaceId);

    if (!membership) {
      // Return 404 to avoid leaking workspace existence to unauthorized users (IDOR prevention)
      throw new NotFoundError("Workspace not found or access denied.");
    }

    if (!this.hasMinimumRole(membership.role, minRole)) {
      throw new AuthorizationError(
        `Insufficient permissions. Requires at least '${minRole}' role, but your role is '${membership.role}'.`
      );
    }

    return membership;
  }

  /**
   * Enforces project-level access within a workspace.
   */
  static async requireProjectAccess(
    userId: string,
    projectId: string,
    minRole: WorkspaceRole = "VIEWER"
  ): Promise<{ project: Project; membership: WorkspaceMember }> {
    if (!userId) {
      throw new AuthorizationError("Authentication required.", 401);
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project || project.isArchived) {
      throw new NotFoundError("Project not found.");
    }

    const membership = await this.requireWorkspaceAccess(
      userId,
      project.workspaceId,
      minRole
    );

    return { project, membership };
  }

  /**
   * Resolves effective artifact permission considering workspace role and granular overrides.
   */
  static async requireArtifactAccess(
    userId: string,
    artifactId: string,
    requiredAction: "VIEW" | "EDIT" | "ADMIN" = "VIEW"
  ): Promise<{
    artifact: Artifact;
    membership: WorkspaceMember;
    effectiveRole: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
  }> {
    if (!userId) {
      throw new AuthorizationError("Authentication required.", 401);
    }

    const artifact = await prisma.artifact.findUnique({
      where: { id: artifactId },
      include: {
        permissions: {
          where: { userId },
        },
      },
    });

    if (!artifact || artifact.isArchived) {
      throw new NotFoundError("Artifact not found.");
    }

    // First ensure user belongs to the artifact's workspace
    const membership = await this.requireWorkspaceAccess(
      userId,
      artifact.workspaceId,
      "VIEWER"
    );

    // Workspace OWNER or ADMIN always have full privileges
    if (membership.role === "OWNER" || membership.role === "ADMIN") {
      return {
        artifact,
        membership,
        effectiveRole: membership.role,
      };
    }

    // Check specific artifact override
    const override = artifact.permissions[0];
    let effectiveRole: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER" = membership.role;

    if (override) {
      if (override.role === "NONE") {
        throw new AuthorizationError("Access to this artifact has been explicitly revoked.");
      } else if (override.role === "EDITOR") {
        effectiveRole = "EDITOR";
      } else if (override.role === "VIEWER") {
        effectiveRole = "VIEWER";
      }
    }

    // Check action against effective role
    if (requiredAction === "ADMIN") {
      // Only workspace OWNER or ADMIN can administer artifacts
      throw new AuthorizationError("Admin privileges required for this action.");
    }

    if (requiredAction === "EDIT" && effectiveRole === "VIEWER") {
      throw new AuthorizationError("Edit permission required for this artifact.");
    }

    return {
      artifact,
      membership,
      effectiveRole,
    };
  }
}
