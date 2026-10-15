import { prisma } from "@/lib/prisma";
import {
  AuthorizationService,
  AuthorizationError,
  NotFoundError,
} from "./authorization.service";
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
          metadata: { name: workspace.name, slug: workspace.slug },
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

    const updated = await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        ...(data.name ? { name: data.name.trim() } : {}),
        ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl } : {}),
      },
    });

    await prisma.activityEvent.create({
      data: {
        workspaceId,
        userId,
        action: "workspace.updated",
        entityType: "workspace",
        entityId: workspaceId,
        metadata: data,
      },
    });

    return updated;
  }
}
