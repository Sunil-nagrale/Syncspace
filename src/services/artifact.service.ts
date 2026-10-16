import { prisma } from "@/lib/prisma";
import {
  AuthorizationService,
  AuthorizationError,
} from "./authorization.service";
import { Artifact, ArtifactType } from "@prisma/client";
import { randomBytes } from "crypto";

export interface CreateArtifactInput {
  workspaceId: string;
  projectId?: string;
  type: ArtifactType;
  title?: string;
  description?: string;
  icon?: string;
  coverImageUrl?: string;
}

export interface UpdateArtifactInput {
  title?: string;
  description?: string;
  icon?: string;
  coverImageUrl?: string;
  isPinned?: boolean;
  isArchived?: boolean;
  projectId?: string | null;
  contentSnapshot?: Record<string, unknown>;
}

export class ArtifactService {
  /**
   * Create a new artifact (document or whiteboard)
   */
  static async createArtifact(
    userId: string,
    input: CreateArtifactInput
  ): Promise<Artifact> {
    if (!userId) {
      throw new AuthorizationError("Authentication required.", 401);
    }

    // Ensure user has editor access to the workspace
    await AuthorizationService.requireWorkspaceAccess(
      userId,
      input.workspaceId,
      "EDITOR"
    );

    // If projectId is provided, verify project exists and belongs to the workspace
    if (input.projectId) {
      const { project } = await AuthorizationService.requireProjectAccess(
        userId,
        input.projectId,
        "EDITOR"
      );

      if (project.workspaceId !== input.workspaceId) {
        throw new AuthorizationError(
          "Project belongs to a different workspace.",
          400
        );
      }
    }

    const liveblocksRoomId = `art_${randomBytes(12).toString("hex")}`;

    const artifact = await prisma.artifact.create({
      data: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        type: input.type,
        title: input.title?.trim() || (input.type === "DOCUMENT" ? "Untitled Document" : "Untitled Whiteboard"),
        description: input.description?.trim(),
        icon: input.icon,
        coverImageUrl: input.coverImageUrl,
        liveblocksRoomId,
        createdById: userId,
        updatedById: userId,
      },
    });

    await prisma.activityEvent.create({
      data: {
        workspaceId: input.workspaceId,
        userId,
        action: `artifact.created.${input.type.toLowerCase()}`,
        entityType: "artifact",
        entityId: artifact.id,
        metadata: { title: artifact.title, type: artifact.type },
      },
    });

    return artifact;
  }

  /**
   * Get non-archived artifacts in a workspace with optional filters
   */
  static async getWorkspaceArtifacts(
    userId: string,
    workspaceId: string,
    filter?: {
      projectId?: string;
      type?: ArtifactType;
      isArchived?: boolean;
    }
  ): Promise<Artifact[]> {
    await AuthorizationService.requireWorkspaceAccess(
      userId,
      workspaceId,
      "VIEWER"
    );

    return prisma.artifact.findMany({
      where: {
        workspaceId,
        ...(filter?.projectId !== undefined ? { projectId: filter.projectId } : {}),
        ...(filter?.type !== undefined ? { type: filter.type } : {}),
        isArchived: filter?.isArchived ?? false,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            image: true,
            color: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
            color: true,
            icon: true,
          },
        },
      },
      orderBy: [
        { isPinned: "desc" },
        { updatedAt: "desc" },
      ],
    });
  }

  /**
   * Get a single artifact with permission check and relational metadata
   */
  static async getArtifactById(
    userId: string,
    artifactId: string
  ) {
    const { effectiveRole } =
      await AuthorizationService.requireArtifactAccess(
        userId,
        artifactId,
        "VIEW"
      );

    const artifact = await prisma.artifact.findUnique({
      where: { id: artifactId },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            color: true,
          },
        },
        updatedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            color: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
            color: true,
            icon: true,
          },
        },
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: {
            id: true,
            versionNumber: true,
            snapshotData: true,
            createdAt: true,
          },
        },
      },
    });

    if (!artifact || artifact.isArchived) {
      throw new AuthorizationError("Artifact not found.", 404);
    }

    return { artifact, effectiveRole };
  }

  /**
   * Update artifact metadata and optional content snapshot
   */
  static async updateArtifact(
    userId: string,
    artifactId: string,
    input: UpdateArtifactInput
  ): Promise<Artifact> {
    const { artifact } = await AuthorizationService.requireArtifactAccess(
      userId,
      artifactId,
      "EDIT"
    );

    // If reassigning project, ensure target project belongs to the same workspace
    if (input.projectId !== undefined && input.projectId !== null) {
      const { project } = await AuthorizationService.requireProjectAccess(
        userId,
        input.projectId,
        "EDITOR"
      );

      if (project.workspaceId !== artifact.workspaceId) {
        throw new AuthorizationError(
          "Project belongs to a different workspace.",
          400
        );
      }
    }

    const updated = await prisma.artifact.update({
      where: { id: artifactId },
      data: {
        ...(input.title !== undefined && input.title.trim().length > 0
          ? { title: input.title.trim() }
          : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.coverImageUrl !== undefined ? { coverImageUrl: input.coverImageUrl } : {}),
        ...(input.isPinned !== undefined ? { isPinned: input.isPinned } : {}),
        ...(input.isArchived !== undefined ? { isArchived: input.isArchived } : {}),
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        updatedById: userId,
      },
    });

    if (input.contentSnapshot && typeof input.contentSnapshot === "object") {
      const safeSnapshot = JSON.parse(JSON.stringify(input.contentSnapshot));
      await prisma.artifactVersion.upsert({
        where: {
          artifactId_versionNumber: {
            artifactId,
            versionNumber: 1,
          },
        },
        create: {
          artifactId,
          versionNumber: 1,
          title: updated.title,
          snapshotData: safeSnapshot,
          changeSummary: "Latest collaborative document state",
          createdById: userId,
        },
        update: {
          title: updated.title,
          snapshotData: safeSnapshot,
          createdById: userId,
        },
      });
    }

    const metadataSummary: Record<string, unknown> = {};
    if (input.title !== undefined) metadataSummary.title = updated.title;
    if (input.isPinned !== undefined) metadataSummary.isPinned = updated.isPinned;
    if (input.isArchived !== undefined) metadataSummary.isArchived = updated.isArchived;
    if (input.contentSnapshot !== undefined) metadataSummary.hasSnapshot = true;

    await prisma.activityEvent.create({
      data: {
        workspaceId: artifact.workspaceId,
        userId,
        action: "artifact.updated",
        entityType: "artifact",
        entityId: artifactId,
        metadata: JSON.parse(JSON.stringify(metadataSummary)),
      },
    });

    return updated;
  }

  /**
   * Soft archive an artifact
   */
  static async archiveArtifact(
    userId: string,
    artifactId: string
  ): Promise<Artifact> {
    return this.updateArtifact(userId, artifactId, { isArchived: true });
  }

  /**
   * List explicit per-user permission overrides on an artifact
   */
  static async getArtifactPermissions(userId: string, artifactId: string) {
    await AuthorizationService.requireArtifactAccess(userId, artifactId, "VIEW");

    return prisma.artifactPermission.findMany({
      where: { artifactId },
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
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Set or remove an explicit per-user permission override on an artifact (requires ADMIN access)
   */
  static async setArtifactPermission(
    actorUserId: string,
    artifactId: string,
    targetUserId: string,
    role: "EDITOR" | "VIEWER" | "NONE" | "INHERIT"
  ) {
    const { artifact } = await AuthorizationService.requireArtifactAccess(
      actorUserId,
      artifactId,
      "ADMIN"
    );

    // Ensure target user belongs to the workspace
    await AuthorizationService.requireWorkspaceAccess(
      targetUserId,
      artifact.workspaceId,
      "VIEWER"
    );

    if (role === "INHERIT") {
      await prisma.artifactPermission.deleteMany({
        where: {
          artifactId,
          userId: targetUserId,
        },
      });
      return null;
    }

    return prisma.artifactPermission.upsert({
      where: {
        artifactId_userId: {
          artifactId,
          userId: targetUserId,
        },
      },
      create: {
        artifactId,
        userId: targetUserId,
        role,
      },
      update: {
        role,
      },
    });
  }
}
