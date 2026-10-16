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

    // Check specific artifact override first (granular overrides constrain or elevate workspace defaults)
    const override = artifact.permissions[0];
    let effectiveRole: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER" = membership.role;

    if (override) {
      if (override.role === "NONE") {
        throw new AuthorizationError(
          "Access to this artifact has been explicitly revoked.",
          403
        );
      } else if (override.role === "VIEWER") {
        effectiveRole = "VIEWER";
      } else if (override.role === "EDITOR") {
        if (membership.role === "VIEWER") {
          effectiveRole = "EDITOR";
        }
      }
    }

    // Check action against effective role
    if (requiredAction === "ADMIN") {
      if (
        (membership.role !== "OWNER" && membership.role !== "ADMIN") ||
        effectiveRole === "VIEWER"
      ) {
        throw new AuthorizationError(
          "Admin privileges required for this action.",
          403
        );
      }
    }

    if (requiredAction === "EDIT" && effectiveRole === "VIEWER") {
      throw new AuthorizationError(
        "Edit permission required for this artifact.",
        403
      );
    }

    return {
      artifact,
      membership,
      effectiveRole,
    };
  }

  /**
   * Resolves effective access for a Liveblocks collaboration room by its persisted liveblocksRoomId.
   */
  static async requireArtifactRoomAccess(
    userId: string,
    roomId: string,
    expectedType?: "DOCUMENT" | "WHITEBOARD"
  ): Promise<{
    artifact: Artifact;
    membership: WorkspaceMember;
    effectiveRole: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
    canWrite: boolean;
  }> {
    if (!userId) {
      throw new AuthorizationError("Authentication required.", 401);
    }

    const normalizedRoomId = typeof roomId === "string" ? roomId.trim() : "";
    if (!normalizedRoomId) {
      throw new AuthorizationError("Valid room ID is required.", 400);
    }

    const roomArtifact = await prisma.artifact.findUnique({
      where: { liveblocksRoomId: normalizedRoomId },
      select: {
        id: true,
        type: true,
        isArchived: true,
      },
    });

    if (!roomArtifact || roomArtifact.isArchived) {
      throw new NotFoundError("Collaboration room not found.");
    }

    if (expectedType && roomArtifact.type !== expectedType) {
      throw new AuthorizationError(
        `Room does not belong to a ${expectedType} artifact.`,
        403
      );
    }

    const { artifact, membership, effectiveRole } =
      await this.requireArtifactAccess(userId, roomArtifact.id, "VIEW");

    return {
      artifact,
      membership,
      effectiveRole,
      canWrite: effectiveRole !== "VIEWER",
    };
  }
}
