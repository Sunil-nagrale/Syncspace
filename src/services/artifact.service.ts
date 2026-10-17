import { prisma } from "@/lib/prisma";
import {
  AuthorizationService,
  AuthorizationError,
} from "./authorization.service";
import { computeSnapshotHash } from "./version.service";
import { extractArtifactSearchText } from "@/lib/validations/search";
import { sanitizeActivityMetadata } from "@/lib/validations/activity";
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

    const artifact = await prisma.$transaction(async (tx) => {
      const created = await tx.artifact.create({
        data: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          type: input.type,
          title:
            input.title?.trim() ||
            (input.type === "DOCUMENT"
              ? "Untitled Document"
              : "Untitled Whiteboard"),
          description: input.description?.trim(),
          icon: input.icon,
          coverImageUrl: input.coverImageUrl,
          liveblocksRoomId,
          createdById: userId,
          updatedById: userId,
        },
      });

      await tx.activityEvent.create({
        data: {
          workspaceId: input.workspaceId,
          artifactId: created.id,
          userId,
          action: `artifact.created.${input.type.toLowerCase()}`,
          entityType: "artifact",
          entityId: created.id,
          metadata: sanitizeActivityMetadata({
            artifactId: created.id,
            title: created.title,
            type: created.type,
          }),
        },
      });

      return created;
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
        permissions: {
          none: {
            userId,
            role: "NONE",
          },
        },
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

    const hasSnapshot = input.contentSnapshot && typeof input.contentSnapshot === "object";
    const safeSnapshot = hasSnapshot ? JSON.parse(JSON.stringify(input.contentSnapshot)) : undefined;
    const extractedSearchText =
      safeSnapshot !== undefined
        ? extractArtifactSearchText(artifact.type, safeSnapshot)
        : undefined;

    const hasMetadataMutation =
      (input.title !== undefined &&
        input.title.trim().length > 0 &&
        input.title.trim() !== artifact.title) ||
      (input.description !== undefined &&
        input.description.trim() !== (artifact.description ?? "")) ||
      (input.icon !== undefined && input.icon !== artifact.icon) ||
      (input.coverImageUrl !== undefined &&
        input.coverImageUrl !== artifact.coverImageUrl) ||
      (input.isPinned !== undefined && input.isPinned !== artifact.isPinned) ||
      (input.isArchived !== undefined &&
        input.isArchived !== artifact.isArchived) ||
      (input.projectId !== undefined && input.projectId !== artifact.projectId);

    let updated: Artifact | undefined;

    if (safeSnapshot !== undefined) {
      const maxRetries = 3;
      let attempt = 0;

      while (attempt < maxRetries) {
        attempt++;
        try {
          updated = await prisma.$transaction(async (tx) => {
            await AuthorizationService.requireArtifactAccessTx(
              tx,
              userId,
              artifactId,
              "EDIT"
            );

            const updatedArt = await tx.artifact.update({
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
                currentSnapshot: safeSnapshot,
                searchText: extractedSearchText ?? "",
                currentRevision: { increment: 1 },
                updatedById: userId,
              },
            });

            // Automatic checkpoint creation policy:
            // 1. Initial snapshot: if no versions exist, create baseline version 1
            const latestVer = await tx.artifactVersion.findFirst({
              where: { artifactId },
              orderBy: { versionNumber: "desc" },
              select: { id: true, versionNumber: true, snapshotData: true, createdAt: true },
            });

            if (!latestVer) {
              await tx.artifactVersion.create({
                data: {
                  artifactId,
                  versionNumber: 1,
                  title: updatedArt.title,
                  snapshotData: safeSnapshot,
                  changeSummary: "Initial snapshot",
                  source: "AUTOMATIC",
                  createdById: userId,
                },
              });
            } else {
              // 2. Periodic autosave checkpoint: if time > 5 minutes AND content has changed
              const FIVE_MINUTES_MS = 5 * 60 * 1000;
              const isTimeElapsed = Date.now() - latestVer.createdAt.getTime() > FIVE_MINUTES_MS;

              if (isTimeElapsed) {
                const latestHash = computeSnapshotHash(latestVer.snapshotData);
                const currentHash = computeSnapshotHash(safeSnapshot);

                // Deduplicate unchanged snapshots
                if (latestHash !== currentHash) {
                  const nextVersionNumber = latestVer.versionNumber + 1;
                  await tx.artifactVersion.create({
                    data: {
                      artifactId,
                      versionNumber: nextVersionNumber,
                      title: updatedArt.title,
                      snapshotData: safeSnapshot,
                      changeSummary: "Periodic autosave checkpoint",
                      source: "AUTOMATIC",
                      createdById: userId,
                    },
                  });
                }
              }
            }

            if (hasMetadataMutation) {
              const isArchiving = input.isArchived === true;
              await tx.activityEvent.create({
                data: {
                  workspaceId: artifact.workspaceId,
                  artifactId,
                  userId,
                  action: isArchiving ? "artifact.archived" : "artifact.updated",
                  entityType: "artifact",
                  entityId: artifactId,
                  metadata: sanitizeActivityMetadata(
                    isArchiving
                      ? {
                          artifactId,
                          type: updatedArt.type,
                          isArchived: true,
                        }
                      : {
                          artifactId,
                          title: updatedArt.title,
                          type: updatedArt.type,
                          ...(input.isPinned !== undefined
                            ? { isPinned: updatedArt.isPinned }
                            : {}),
                        }
                  ),
                },
              });
            }

            return updatedArt;
          });
          break; // Succeeded
        } catch (err: unknown) {
          const isUniqueConstraint =
            err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002";
          if (isUniqueConstraint && attempt < maxRetries) {
            continue;
          }
          throw err;
        }
      }

      if (!updated) {
        throw new Error("Failed to persist snapshot after concurrent attempts.");
      }
    } else {
      updated = await prisma.$transaction(async (tx) => {
        await AuthorizationService.requireArtifactAccessTx(
          tx,
          userId,
          artifactId,
          "EDIT"
        );

        const updatedArt = await tx.artifact.update({
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

        const isArchiving = input.isArchived === true;
        await tx.activityEvent.create({
          data: {
            workspaceId: artifact.workspaceId,
            artifactId,
            userId,
            action: isArchiving ? "artifact.archived" : "artifact.updated",
            entityType: "artifact",
            entityId: artifactId,
            metadata: sanitizeActivityMetadata(
              isArchiving
                ? {
                    artifactId,
                    type: updatedArt.type,
                    isArchived: true,
                  }
                : {
                    artifactId,
                    title: updatedArt.title,
                    type: updatedArt.type,
                    ...(input.isPinned !== undefined
                      ? { isPinned: updatedArt.isPinned }
                      : {}),
                  }
            ),
          },
        });

        return updatedArt;
      });
    }

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

    return prisma.$transaction(async (tx) => {
      // Re-validate admin access and acquire row-level lock on artifact so permission mutations serialize with restore/checkpoint/update
      await AuthorizationService.requireArtifactAccessTx(
        tx,
        actorUserId,
        artifactId,
        "ADMIN"
      );

      if (role === "INHERIT") {
        await tx.artifactPermission.deleteMany({
          where: {
            artifactId,
            userId: targetUserId,
          },
        });

        await tx.activityEvent.create({
          data: {
            workspaceId: artifact.workspaceId,
            artifactId,
            userId: actorUserId,
            action: "artifact.permission_updated",
            entityType: "artifact",
            entityId: artifactId,
            metadata: sanitizeActivityMetadata({
              artifactId,
              targetUserId,
              role: "INHERIT",
            }),
          },
        });

        return null;
      }

      const permission = await tx.artifactPermission.upsert({
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

      await tx.activityEvent.create({
        data: {
          workspaceId: artifact.workspaceId,
          artifactId,
          userId: actorUserId,
          action: "artifact.permission_updated",
          entityType: "artifact",
          entityId: artifactId,
          metadata: sanitizeActivityMetadata({
            artifactId,
            targetUserId,
            role,
          }),
        },
      });

      return permission;
    });
  }
}
