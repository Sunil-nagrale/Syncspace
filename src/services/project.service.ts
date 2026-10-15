import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "./authorization.service";
import { Project } from "@prisma/client";

export interface CreateProjectInput {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  isArchived?: boolean;
}

export class ProjectService {
  /**
   * Create a new project within a workspace
   */
  static async createProject(
    userId: string,
    workspaceId: string,
    input: CreateProjectInput
  ): Promise<Project> {
    if (!input.name || input.name.trim().length === 0) {
      throw new Error("Project name is required.");
    }

    // Require at least EDITOR role to create projects
    await AuthorizationService.requireWorkspaceAccess(
      userId,
      workspaceId,
      "EDITOR"
    );

    const project = await prisma.project.create({
      data: {
        workspaceId,
        name: input.name.trim(),
        description: input.description?.trim(),
        icon: input.icon,
        color: input.color || "#6366F1",
        createdById: userId,
      },
    });

    await prisma.activityEvent.create({
      data: {
        workspaceId,
        userId,
        action: "project.created",
        entityType: "project",
        entityId: project.id,
        metadata: { name: project.name },
      },
    });

    return project;
  }

  /**
   * List non-archived projects in a workspace
   */
  static async getWorkspaceProjects(
    userId: string,
    workspaceId: string,
    includeArchived: boolean = false
  ): Promise<Project[]> {
    await AuthorizationService.requireWorkspaceAccess(
      userId,
      workspaceId,
      "VIEWER"
    );

    return prisma.project.findMany({
      where: {
        workspaceId,
        ...(includeArchived ? {} : { isArchived: false }),
      },
      include: {
        _count: {
          select: {
            artifacts: { where: { isArchived: false } },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  /**
   * Get a single project by ID with security checks
   */
  static async getProjectById(
    userId: string,
    projectId: string
  ): Promise<Project> {
    const { project } = await AuthorizationService.requireProjectAccess(
      userId,
      projectId,
      "VIEWER"
    );

    return project;
  }

  /**
   * Update an existing project
   */
  static async updateProject(
    userId: string,
    projectId: string,
    input: UpdateProjectInput
  ): Promise<Project> {
    const { project } = await AuthorizationService.requireProjectAccess(
      userId,
      projectId,
      "EDITOR"
    );

    const updated = await prisma.project.update({
      where: { id: projectId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.isArchived !== undefined ? { isArchived: input.isArchived } : {}),
      },
    });

    await prisma.activityEvent.create({
      data: {
        workspaceId: project.workspaceId,
        userId,
        action: "project.updated",
        entityType: "project",
        entityId: projectId,
        metadata: JSON.parse(JSON.stringify(input)),
      },
    });

    return updated;
  }

  /**
   * Archive a project
   */
  static async archiveProject(
    userId: string,
    projectId: string
  ): Promise<Project> {
    await AuthorizationService.requireProjectAccess(
      userId,
      projectId,
      "ADMIN"
    );

    return prisma.project.update({
      where: { id: projectId },
      data: { isArchived: true },
    });
  }
}
