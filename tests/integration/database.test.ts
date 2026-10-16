import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { WorkspaceService } from "@/services/workspace.service";
import { ProjectService } from "@/services/project.service";
import { ArtifactService } from "@/services/artifact.service";
import {
  AuthorizationService,
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";

beforeAll(async () => {
  // Verify real PostgreSQL connection is established; fail honestly if unreachable
  await prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Real PostgreSQL Database Integration Tests", () => {
  it("verifies live PostgreSQL connectivity with low latency", async () => {
    const start = Date.now();
    const result = await prisma.$queryRaw<
      Array<{ connected: number }>
    >`SELECT 1 as connected`;
    const latency = Date.now() - start;

    expect(result).toBeDefined();
    expect(result.length).toBe(1);
    expect(result[0].connected).toBe(1);
    expect(latency).toBeLessThan(2000);
  });

  it("persists user and account records in PostgreSQL with relational integrity", async () => {
    const testEmail = `test.user.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2, 7)}@syncspace.dev`;

    // 1. Create user in PostgreSQL
    const user = await prisma.user.create({
      data: {
        name: "Integration Test User",
        email: testEmail,
        emailVerified: true,
        color: "#6366F1",
      },
    });

    expect(user.id).toBeDefined();
    expect(user.email).toBe(testEmail);
    expect(user.color).toBe("#6366F1");

    // 2. Create associated credential account in PostgreSQL
    const account = await prisma.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: "hashed_test_password_syncspace",
      },
    });

    expect(account.id).toBeDefined();
    expect(account.userId).toBe(user.id);
    expect(account.providerId).toBe("credential");

    // 3. Query user with accounts included from PostgreSQL
    const fetchedUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { accounts: true },
    });

    expect(fetchedUser).not.toBeNull();
    expect(fetchedUser?.id).toBe(user.id);
    expect(fetchedUser?.name).toBe("Integration Test User");
    expect(fetchedUser?.accounts).toHaveLength(1);
    expect(fetchedUser?.accounts[0].providerId).toBe("credential");

    // 4. Verify cascade deletion when user is removed
    await prisma.user.delete({ where: { id: user.id } });

    const orphanedAccount = await prisma.account.findUnique({
      where: { id: account.id },
    });
    expect(orphanedAccount).toBeNull();
  });

  it("verifies Better Auth registration, login, duplicate rejection, invalid credentials, session retrieval, and logout against PostgreSQL", async () => {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);
    const email = `auth.test.${timestamp}.${rand}@syncspace.dev`;
    const password = "SecurePassword123!";
    let createdUserId: string | undefined;

    try {
      // 1. Register a new user via Better Auth handler
      const signUpRes = await auth.handler(
        new Request("http://localhost:3000/api/auth/sign-up/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Auth Integration User",
            email,
            password,
          }),
        })
      );

      expect(signUpRes.status).toBe(200);
      const signUpData = await signUpRes.json();
      expect(signUpData.user).toBeDefined();
      expect(signUpData.user.email).toBe(email);
      createdUserId = signUpData.user.id;

      // 2. Verify user, credential account, and session persist in PostgreSQL
      const dbUser = await prisma.user.findUnique({
        where: { id: createdUserId },
        include: { accounts: true, sessions: true },
      });
      expect(dbUser).not.toBeNull();
      expect(dbUser?.accounts.length).toBe(1);
      expect(dbUser?.accounts[0].providerId).toBe("credential");
      expect(dbUser?.accounts[0].password).toBeTruthy();
      expect(dbUser?.sessions.length).toBeGreaterThanOrEqual(1);

      // 3. Reject duplicate registration with same email
      const dupRes = await auth.handler(
        new Request("http://localhost:3000/api/auth/sign-up/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Duplicate User",
            email,
            password: "AnotherPassword123!",
          }),
        })
      );
      expect(dupRes.status).toBeGreaterThanOrEqual(400);

      // 4. Reject login with invalid password
      const badLoginRes = await auth.handler(
        new Request("http://localhost:3000/api/auth/sign-in/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password: "WrongPassword999!",
          }),
        })
      );
      expect(badLoginRes.status).toBeGreaterThanOrEqual(400);

      // 5. Log in with valid credentials and capture session cookie
      const loginRes = await auth.handler(
        new Request("http://localhost:3000/api/auth/sign-in/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
          }),
        })
      );
      expect(loginRes.status).toBe(200);
      const setCookie = loginRes.headers.get("set-cookie");
      expect(setCookie).toBeTruthy();
      const cookieHeader = setCookie!
        .split(",")
        .map((c) => c.split(";")[0].trim())
        .join("; ");

      // 6. Retrieve authenticated session using session cookie
      const sessionRes = await auth.handler(
        new Request("http://localhost:3000/api/auth/get-session", {
          method: "GET",
          headers: { cookie: cookieHeader },
        })
      );
      expect(sessionRes.status).toBe(200);
      const sessionData = await sessionRes.json();
      expect(sessionData?.user?.id).toBe(createdUserId);
      expect(sessionData?.session?.token).toBeTruthy();

      // 7. Logout invalidates the session in PostgreSQL
      const logoutRes = await auth.handler(
        new Request("http://localhost:3000/api/auth/sign-out", {
          method: "POST",
          headers: {
            cookie: cookieHeader,
            origin: "http://localhost:3000",
          },
        })
      );
      expect(logoutRes.status).toBe(200);

      // 8. Former session cookie cannot retrieve an active session after logout
      const afterLogoutRes = await auth.handler(
        new Request("http://localhost:3000/api/auth/get-session", {
          method: "GET",
          headers: { cookie: cookieHeader },
        })
      );
      const afterLogoutData = await afterLogoutRes.json();
      expect(afterLogoutData).toBeNull();
    } finally {
      if (createdUserId) {
        await prisma.user.delete({ where: { id: createdUserId } });
      }
    }
  });

  it("creates workspace, project, document and whiteboard artifacts, enforces IDOR isolation, and enforces VIEWER role restrictions", async () => {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);

    // 1. Create User A (Owner) and User B (Outsider -> then Viewer) in PostgreSQL
    const userA = await prisma.user.create({
      data: {
        name: "User Alpha",
        email: `alpha.${timestamp}.${rand}@syncspace.dev`,
      },
    });

    const userB = await prisma.user.create({
      data: {
        name: "User Beta",
        email: `beta.${timestamp}.${rand}@syncspace.dev`,
      },
    });

    try {
      // 2. User A creates a workspace
      const workspaceA = await WorkspaceService.createWorkspace(userA.id, {
        name: `Alpha Corp ${timestamp}`,
      });

      expect(workspaceA.id).toBeDefined();
      expect(workspaceA.currentUserRole).toBe("OWNER");

      // Verify owner membership record in PostgreSQL
      const membership = await prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: workspaceA.id,
            userId: userA.id,
          },
        },
      });
      expect(membership).not.toBeNull();
      expect(membership?.role).toBe("OWNER");

      // 3. User A creates a project, a document artifact, and a whiteboard artifact
      const projectA = await ProjectService.createProject(
        userA.id,
        workspaceA.id,
        {
          name: "Alpha Roadmap",
          description: "Confidential roadmap for Alpha Corp",
        }
      );

      expect(projectA.id).toBeDefined();
      expect(projectA.workspaceId).toBe(workspaceA.id);

      const docA = await ArtifactService.createArtifact(userA.id, {
        workspaceId: workspaceA.id,
        projectId: projectA.id,
        type: "DOCUMENT",
        title: "Confidential Alpha Architecture",
      });

      const boardA = await ArtifactService.createArtifact(userA.id, {
        workspaceId: workspaceA.id,
        projectId: projectA.id,
        type: "WHITEBOARD",
        title: "Alpha System Topology Whiteboard",
      });

      expect(docA.id).toBeDefined();
      expect(docA.type).toBe("DOCUMENT");
      expect(boardA.id).toBeDefined();
      expect(boardA.type).toBe("WHITEBOARD");

      // 4. Multi-tenant IDOR Security Checks (User B is NOT a member of Workspace A):
      await expect(
        AuthorizationService.requireWorkspaceAccess(
          userB.id,
          workspaceA.id,
          "VIEWER"
        )
      ).rejects.toThrow(NotFoundError);

      await expect(
        AuthorizationService.requireProjectAccess(
          userB.id,
          projectA.id,
          "VIEWER"
        )
      ).rejects.toThrow(NotFoundError);

      await expect(
        AuthorizationService.requireArtifactAccess(userB.id, docA.id, "VIEW")
      ).rejects.toThrow(NotFoundError);

      await expect(
        AuthorizationService.requireArtifactAccess(userB.id, boardA.id, "VIEW")
      ).rejects.toThrow(NotFoundError);

      await expect(
        ProjectService.getWorkspaceProjects(userB.id, workspaceA.id)
      ).rejects.toThrow(NotFoundError);

      await expect(
        ArtifactService.getWorkspaceArtifacts(userB.id, workspaceA.id)
      ).rejects.toThrow(NotFoundError);

      // Unauthorized mutations by non-member User B fail with NotFoundError
      await expect(
        WorkspaceService.updateWorkspace(userB.id, workspaceA.id, {
          name: "Hacked Workspace",
        })
      ).rejects.toThrow(NotFoundError);

      await expect(
        ProjectService.createProject(userB.id, workspaceA.id, {
          name: "Unauthorized Project",
        })
      ).rejects.toThrow(NotFoundError);

      await expect(
        ArtifactService.updateArtifact(userB.id, docA.id, {
          title: "Tampered Doc",
        })
      ).rejects.toThrow(NotFoundError);

      // 5. Grant User B VIEWER role in Workspace A and verify viewer role restrictions
      await prisma.workspaceMember.create({
        data: {
          workspaceId: workspaceA.id,
          userId: userB.id,
          role: "VIEWER",
        },
      });

      // Viewer CAN read workspace, projects, and artifacts
      const viewerProjects = await ProjectService.getWorkspaceProjects(
        userB.id,
        workspaceA.id
      );
      expect(viewerProjects.some((p) => p.id === projectA.id)).toBe(true);

      const viewerDoc = await ArtifactService.getArtifactById(
        userB.id,
        docA.id
      );
      expect(viewerDoc.artifact.id).toBe(docA.id);
      expect(viewerDoc.effectiveRole).toBe("VIEWER");

      const viewerBoard = await ArtifactService.getArtifactById(
        userB.id,
        boardA.id
      );
      expect(viewerBoard.artifact.id).toBe(boardA.id);
      expect(viewerBoard.effectiveRole).toBe("VIEWER");

      // Viewer CANNOT create projects, update projects, archive projects, create/update/archive artifacts, or update workspace
      await expect(
        ProjectService.createProject(userB.id, workspaceA.id, {
          name: "Viewer Forbidden Project",
        })
      ).rejects.toThrow(AuthorizationError);

      await expect(
        ProjectService.updateProject(userB.id, projectA.id, {
          name: "Viewer Rename Attempt",
        })
      ).rejects.toThrow(AuthorizationError);

      await expect(
        ProjectService.archiveProject(userB.id, projectA.id)
      ).rejects.toThrow(AuthorizationError);

      await expect(
        ArtifactService.createArtifact(userB.id, {
          workspaceId: workspaceA.id,
          type: "DOCUMENT",
          title: "Viewer Forbidden Document",
        })
      ).rejects.toThrow(AuthorizationError);

      await expect(
        ArtifactService.updateArtifact(userB.id, docA.id, {
          title: "Viewer Edit Attempt",
        })
      ).rejects.toThrow(AuthorizationError);

      await expect(
        ArtifactService.archiveArtifact(userB.id, boardA.id)
      ).rejects.toThrow(AuthorizationError);

      await expect(
        WorkspaceService.updateWorkspace(userB.id, workspaceA.id, {
          name: "Viewer Workspace Rename",
        })
      ).rejects.toThrow(AuthorizationError);
    } finally {
      // 6. Clean up test records in PostgreSQL
      const workspaces = await prisma.workspace.findMany({
        where: { createdById: userA.id },
      });
      for (const ws of workspaces) {
        await prisma.workspace.delete({ where: { id: ws.id } });
      }

      await prisma.user.deleteMany({
        where: { id: { in: [userA.id, userB.id] } },
      });
    }
  });
});
