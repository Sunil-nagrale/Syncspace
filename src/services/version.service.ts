import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  AuthorizationService,
  AuthorizationError,
  NotFoundError,
  ConflictError,
} from "./authorization.service";
import { validateSnapshotPayload } from "@/lib/validations/version";
import { extractArtifactSearchText } from "@/lib/validations/search";
import { sanitizeActivityMetadata } from "@/lib/validations/activity";
import { createHash } from "crypto";

export interface ListVersionsOptions {
  limit?: number;
  cursor?: string;
}

export interface CreateCheckpointInput {
  title?: string;
  changeSummary?: string;
  snapshotData?: Record<string, unknown>;
  source?: "AUTOMATIC" | "MANUAL" | "RESTORE_RECOVERY" | "RESTORED";
  restoredFromVersion?: number;
}

export interface RestoreVersionOptions {
  expectedRevision: number;
}

export function computeSnapshotHash(data: unknown): string {
  try {
    const serialized = JSON.stringify(data);
    return createHash("sha256").update(serialized).digest("hex");
  } catch {
    return "";
  }
}

export class VersionService {
  /**
   * List historical versions for an artifact using bounded cursor-based pagination
   */
  static async listVersions(
    userId: string,
    artifactId: string,
    options: ListVersionsOptions = {}
  ) {
    if (!userId) {
      throw new AuthorizationError("Authentication required.", 401);
    }

    // View permission required to list versions
    await AuthorizationService.requireArtifactAccess(
      userId,
      artifactId,
      "VIEW"
    );

    const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);

    const whereClause = {
      artifactId,
    };

    const totalCount = await prisma.artifactVersion.count({
      where: whereClause,
    });

    let items;
    if (options.cursor) {
      items = await prisma.artifactVersion.findMany({
        where: whereClause,
        take: limit + 1,
        skip: 1,
        cursor: { id: options.cursor },
        orderBy: { versionNumber: "desc" },
        select: {
          id: true,
          artifactId: true,
          versionNumber: true,
          title: true,
          changeSummary: true,
          source: true,
          restoredFromVersion: true,
          createdById: true,
          createdAt: true,
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              color: true,
            },
          },
        },
      });
    } else {
      items = await prisma.artifactVersion.findMany({
        where: whereClause,
        take: limit + 1,
        orderBy: { versionNumber: "desc" },
        select: {
          id: true,
          artifactId: true,
          versionNumber: true,
          title: true,
          changeSummary: true,
          source: true,
          restoredFromVersion: true,
          createdById: true,
          createdAt: true,
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              color: true,
            },
          },
        },
      });
    }

    const hasMore = items.length > limit;
    const resultItems = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? resultItems[resultItems.length - 1]?.id ?? null : null;

    const artifact = await prisma.artifact.findUnique({
      where: { id: artifactId },
      select: { currentRevision: true },
    });

    return {
      items: resultItems,
      nextCursor,
      totalCount,
      currentRevision: artifact?.currentRevision ?? 1,
    };
  }

  /**
   * Get a specific version for preview including full snapshotData
   */
  static async getVersion(
    userId: string,
    artifactId: string,
    versionId: string
  ) {
    if (!userId) {
      throw new AuthorizationError("Authentication required.", 401);
    }

    await AuthorizationService.requireArtifactAccess(
      userId,
      artifactId,
      "VIEW"
    );

    const version = await prisma.artifactVersion.findUnique({
      where: { id: versionId },
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
      },
    });

    if (!version || version.artifactId !== artifactId) {
      throw new NotFoundError("Artifact version not found.");
    }

    return version;
  }

  /**
   * Create an immutable version checkpoint with monotonic numbering and concurrency retry
   */
  static async createCheckpoint(
    userId: string,
    artifactId: string,
    input: CreateCheckpointInput
  ) {
    if (!userId) {
      throw new AuthorizationError("Authentication required.", 401);
    }

    const { artifact } = await AuthorizationService.requireArtifactAccess(
      userId,
      artifactId,
      "EDIT"
    );

    let snapshotToSave: Record<string, unknown>;

    if (input.snapshotData) {
      const validation = validateSnapshotPayload(artifact.type, input.snapshotData);
      if (!validation.valid) {
        throw new AuthorizationError(validation.error, 400);
      }
      snapshotToSave = validation.data;
    } else if (artifact.currentSnapshot && typeof artifact.currentSnapshot === "object") {
      snapshotToSave = artifact.currentSnapshot as Record<string, unknown>;
    } else {
      throw new AuthorizationError(
        "Cannot create checkpoint: No snapshot content provided or saved for this artifact.",
        400
      );
    }

    const source = input.source ?? "MANUAL";

    // Deduplication check: If source is AUTOMATIC, compare with latest version
    if (source === "AUTOMATIC") {
      const latestVersion = await prisma.artifactVersion.findFirst({
        where: { artifactId },
        orderBy: { versionNumber: "desc" },
      });

      if (latestVersion) {
        const latestHash = computeSnapshotHash(latestVersion.snapshotData);
        const incomingHash = computeSnapshotHash(snapshotToSave);
        if (latestHash && incomingHash && latestHash === incomingHash) {
          return latestVersion;
        }
      }
    }

    const versionTitle = input.title?.trim() || artifact.title;
    const changeSummary =
      input.changeSummary?.trim() ||
      (source === "MANUAL"
        ? "Manual version checkpoint"
        : source === "RESTORE_RECOVERY"
        ? "Pre-restore recovery checkpoint"
        : source === "RESTORED"
        ? `Restored from version ${input.restoredFromVersion ?? "prior"}`
        : "Automatic periodic checkpoint");

    // Monotonic version numbering inside transaction with retry handling
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      attempt++;
      try {
        const created = await prisma.$transaction(async (tx) => {
          // Transactionally lock artifact and re-validate active workspace membership, role, and permission overrides
          const { artifact: lockedArtifact } =
            await AuthorizationService.requireArtifactAccessTx(
              tx,
              userId,
              artifactId,
              "EDIT"
            );

          const maxRecord = await tx.artifactVersion.findFirst({
            where: { artifactId },
            orderBy: { versionNumber: "desc" },
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
            },
          });

          // Deduplication check: If source is AUTOMATIC, compare with latest version
          if (source === "AUTOMATIC" && maxRecord) {
            const latestHash = computeSnapshotHash(maxRecord.snapshotData);
            const incomingHash = computeSnapshotHash(snapshotToSave);
            if (latestHash && incomingHash && latestHash === incomingHash) {
              return {
                newVersion: maxRecord,
                updatedArtifact: { currentRevision: lockedArtifact.currentRevision },
              };
            }
          }

          const nextVersionNumber = (maxRecord?.versionNumber ?? 0) + 1;

          const newVersion = await tx.artifactVersion.create({
            data: {
              artifactId,
              versionNumber: nextVersionNumber,
              title: versionTitle,
              snapshotData: snapshotToSave as unknown as Prisma.InputJsonValue,
              changeSummary,
              source,
              restoredFromVersion: input.restoredFromVersion ?? null,
              createdById: userId,
            },
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
            },
          });

          // Keep currentSnapshot on Artifact in sync
          const updatedArtifact = await tx.artifact.update({
            where: { id: artifactId },
            data: {
              currentSnapshot: snapshotToSave as unknown as Prisma.InputJsonValue,
              searchText: extractArtifactSearchText(lockedArtifact.type, snapshotToSave),
              currentRevision: { increment: 1 },
              updatedById: userId,
            },
          });

          if (source === "MANUAL") {
            await tx.activityEvent.create({
              data: {
                workspaceId: lockedArtifact.workspaceId,
                artifactId,
                userId,
                action: "artifact.version.created",
                entityType: "artifact_version",
                entityId: newVersion.id,
                metadata: sanitizeActivityMetadata({
                  artifactId,
                  versionNumber: newVersion.versionNumber,
                  title: newVersion.title,
                }),
              },
            });
          }

          return { newVersion, updatedArtifact };
        });

        return {
          ...created.newVersion,
          currentRevision: created.updatedArtifact.currentRevision,
        };
      } catch (err: unknown) {
        const isUniqueConstraint =
          err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002";
        if (isUniqueConstraint && attempt < maxRetries) {
          // Concurrency collision on [artifactId, versionNumber], retry with updated max
          continue;
        }
        throw err;
      }
    }

    throw new Error("Failed to create version checkpoint after concurrent attempts.");
  }

  /**
   * Restore a historical version to active state
   * Updates durable state, preserves displaced state, increments revision, and creates a RESTORED entry
   */
  static async restoreVersion(
    userId: string,
    artifactId: string,
    versionId: string,
    options: RestoreVersionOptions
  ) {
    if (!userId) {
      throw new AuthorizationError("Authentication required.", 401);
    }

    if (
      !options ||
      options.expectedRevision === undefined ||
      options.expectedRevision === null ||
      typeof options.expectedRevision !== "number" ||
      !Number.isInteger(options.expectedRevision) ||
      options.expectedRevision <= 0
    ) {
      throw new AuthorizationError(
        "expectedRevision is required and must be a positive integer.",
        400
      );
    }

    // Require EDIT access on the artifact to restore
    await AuthorizationService.requireArtifactAccess(
      userId,
      artifactId,
      "EDIT"
    );

    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      attempt++;
      try {
        const result = await prisma.$transaction(async (tx) => {
          // 1. Transactionally lock artifact, verify active membership, role, and permission overrides
          const { artifact: lockedArtifact } =
            await AuthorizationService.requireArtifactAccessTx(
              tx,
              userId,
              artifactId,
              "EDIT"
            );

          // 2. Atomic optimistic concurrency check: verify currentRevision matches expectedRevision
          if (lockedArtifact.currentRevision !== options.expectedRevision) {
            throw new ConflictError(
              "Conflict: The artifact has been modified since it was loaded. Please refresh version history.",
              lockedArtifact.currentRevision
            );
          }

          // 3. Re-read and validate target version inside this transaction
          const targetVersion = await tx.artifactVersion.findUnique({
            where: { id: versionId },
          });

          if (!targetVersion || targetVersion.artifactId !== artifactId) {
            throw new NotFoundError("Artifact version not found.");
          }

          // 4. Pre-restore safety: check if displaced current state differs from the latest historical version
          const latestVersion = await tx.artifactVersion.findFirst({
            where: { artifactId },
            orderBy: { versionNumber: "desc" },
          });

          let nextVersionNumber = (latestVersion?.versionNumber ?? 0) + 1;

          const currentHash = computeSnapshotHash(lockedArtifact.currentSnapshot);
          const latestVersionHash = computeSnapshotHash(latestVersion?.snapshotData);

          // If currentSnapshot exists and has changes not saved to any version, preserve it
          if (
            lockedArtifact.currentSnapshot &&
            typeof lockedArtifact.currentSnapshot === "object" &&
            currentHash &&
            currentHash !== latestVersionHash
          ) {
            await tx.artifactVersion.create({
              data: {
                artifactId,
                versionNumber: nextVersionNumber,
                title: lockedArtifact.title,
                snapshotData: lockedArtifact.currentSnapshot as unknown as Prisma.InputJsonValue,
                changeSummary: "Pre-restore recovery checkpoint",
                source: "RESTORE_RECOVERY",
                createdById: userId,
              },
            });
            nextVersionNumber++;
          }

          // 5. Restore targetVersion
          const restoredSnapshot = targetVersion.snapshotData as Record<string, unknown>;
          const restoredTitle = targetVersion.title;

          const restoredVersionRecord = await tx.artifactVersion.create({
            data: {
              artifactId,
              versionNumber: nextVersionNumber,
              title: restoredTitle,
              snapshotData: restoredSnapshot as unknown as Prisma.InputJsonValue,
              changeSummary: `Restored from version ${targetVersion.versionNumber} ("${targetVersion.title}")`,
              source: "RESTORED",
              restoredFromVersion: targetVersion.versionNumber,
              createdById: userId,
            },
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
            },
          });

          const updatedArtifact = await tx.artifact.update({
            where: { id: artifactId },
            data: {
              title: restoredTitle,
              currentSnapshot: restoredSnapshot as unknown as Prisma.InputJsonValue,
              searchText: extractArtifactSearchText(lockedArtifact.type, restoredSnapshot),
              currentRevision: { increment: 1 },
              updatedById: userId,
            },
          });

          await tx.activityEvent.create({
            data: {
              workspaceId: lockedArtifact.workspaceId,
              artifactId,
              userId,
              action: "artifact.version.restored",
              entityType: "artifact_version",
              entityId: restoredVersionRecord.id,
              metadata: sanitizeActivityMetadata({
                artifactId,
                restoredFromVersion: targetVersion.versionNumber,
                newVersionNumber: restoredVersionRecord.versionNumber,
              }),
            },
          });

          return {
            restoredVersionRecord,
            updatedArtifact,
            restoredSnapshot,
            restoredTitle,
          };
        });

        return {
          success: true,
          restoredVersion: result.restoredVersionRecord,
          currentRevision: result.updatedArtifact.currentRevision,
          snapshotData: result.restoredSnapshot,
          title: result.restoredTitle,
        };
      } catch (err: unknown) {
        const isUniqueConstraint =
          err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002";
        if (isUniqueConstraint && attempt < maxRetries) {
          continue;
        }
        throw err;
      }
    }

    throw new Error("Failed to complete restoration after concurrent attempts.");
  }
}
