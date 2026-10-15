import { describe, it, expect, vi } from "vitest";
import {
  AuthorizationService,
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";
import { WorkspaceService } from "@/services/workspace.service";
import { WorkspaceRole } from "@prisma/client";

describe("AuthorizationService — RBAC & Role Hierarchy", () => {
  it("enforces OWNER has the highest privilege rank", () => {
    expect(AuthorizationService.hasMinimumRole("OWNER", "OWNER")).toBe(true);
    expect(AuthorizationService.hasMinimumRole("OWNER", "ADMIN")).toBe(true);
    expect(AuthorizationService.hasMinimumRole("OWNER", "EDITOR")).toBe(true);
    expect(AuthorizationService.hasMinimumRole("OWNER", "VIEWER")).toBe(true);
  });

  it("enforces ADMIN can manage artifacts and projects but cannot exceed OWNER", () => {
    expect(AuthorizationService.hasMinimumRole("ADMIN", "OWNER")).toBe(false);
    expect(AuthorizationService.hasMinimumRole("ADMIN", "ADMIN")).toBe(true);
    expect(AuthorizationService.hasMinimumRole("ADMIN", "EDITOR")).toBe(true);
    expect(AuthorizationService.hasMinimumRole("ADMIN", "VIEWER")).toBe(true);
  });

  it("enforces EDITOR can create/edit content but not perform ADMIN tasks", () => {
    expect(AuthorizationService.hasMinimumRole("EDITOR", "OWNER")).toBe(false);
    expect(AuthorizationService.hasMinimumRole("EDITOR", "ADMIN")).toBe(false);
    expect(AuthorizationService.hasMinimumRole("EDITOR", "EDITOR")).toBe(true);
    expect(AuthorizationService.hasMinimumRole("EDITOR", "VIEWER")).toBe(true);
  });

  it("enforces VIEWER is strictly read-only", () => {
    expect(AuthorizationService.hasMinimumRole("VIEWER", "OWNER")).toBe(false);
    expect(AuthorizationService.hasMinimumRole("VIEWER", "ADMIN")).toBe(false);
    expect(AuthorizationService.hasMinimumRole("VIEWER", "EDITOR")).toBe(false);
    expect(AuthorizationService.hasMinimumRole("VIEWER", "VIEWER")).toBe(true);
  });

  it("rejects unauthenticated access attempts with 401 AuthorizationError", async () => {
    await expect(
      AuthorizationService.requireWorkspaceAccess("", "workspace-123", "VIEWER")
    ).rejects.toThrow(AuthorizationError);

    await expect(
      AuthorizationService.requireProjectAccess("", "project-123", "VIEWER")
    ).rejects.toThrow(AuthorizationError);

    await expect(
      AuthorizationService.requireArtifactAccess("", "artifact-123", "VIEW")
    ).rejects.toThrow(AuthorizationError);
  });

  it("formats Custom Exceptions correctly", () => {
    const authErr = new AuthorizationError("Denied", 403);
    expect(authErr.name).toBe("AuthorizationError");
    expect(authErr.statusCode).toBe(403);
    expect(authErr.message).toBe("Denied");

    const notFoundErr = new NotFoundError("Missing item");
    expect(notFoundErr.name).toBe("NotFoundError");
    expect(notFoundErr.statusCode).toBe(404);
    expect(notFoundErr.message).toBe("Missing item");
  });
});

describe("WorkspaceService — Slugification and Multi-Tenancy", () => {
  it("converts workspace names to URL-safe kebab-case slugs", () => {
    expect(WorkspaceService.slugify("Acme Engineering Team")).toBe("acme-engineering-team");
    expect(WorkspaceService.slugify("SyncSpace — Core 2026!")).toBe("syncspace-core-2026");
    expect(WorkspaceService.slugify("   Mobile & Web App   ")).toBe("mobile-web-app");
    expect(WorkspaceService.slugify("Special-Chars__And Spaces")).toBe("special-chars-and-spaces");
  });

  it("handles empty or symbol-only inputs safely", () => {
    expect(WorkspaceService.slugify("")).toBe("");
    expect(WorkspaceService.slugify("!!! @@@ ###")).toBe("");
  });
});
