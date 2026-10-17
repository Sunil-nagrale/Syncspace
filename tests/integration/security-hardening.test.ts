import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { WorkspaceService } from "@/services/workspace.service";
import { ArtifactService } from "@/services/artifact.service";
import { LiveblocksAuthService } from "@/services/liveblocks-auth.service";
import {
  AuthorizationService,
  AuthorizationError,
} from "@/services/authorization.service";
import {
  getSafeRedirectUrl,
  isSafeUrlProtocol,
  parseJsonBody,
} from "@/lib/security";
import {
  checkRateLimit,
  rateLimitResponse,
  resetRateLimitsForTests,
} from "@/lib/rate-limit";

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  resetRateLimitsForTests();
});

describe("Phase H — Security & Reliability Hardening Integration Tests", () => {
  async function createTestUser(roleSuffix: string) {
    const email = `sec.${roleSuffix}.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2, 7)}@syncspace.dev`;
    return prisma.user.create({
      data: {
        name: `Sec ${roleSuffix}`,
        email,
        emailVerified: true,
        color: "#6366F1",
      },
    });
  }

  describe("1. Workspace RBAC Privilege Escalation Prevention", () => {
    it("enforces that non-owners cannot assign OWNER or ADMIN roles", async () => {
      const owner = await createTestUser("owner");
      const admin = await createTestUser("admin");
      const targetUser = await createTestUser("target");

      const workspace = await WorkspaceService.createWorkspace(owner.id, {
        name: "Privilege Boundary Space",
      });

      // Owner promotes admin to ADMIN
      await WorkspaceService.addMember(owner.id, workspace.id, {
        userId: admin.id,
        role: "ADMIN",
      });

      // ADMIN tries to assign OWNER role to target user -> MUST FAIL (403)
      await expect(
        WorkspaceService.addMember(admin.id, workspace.id, {
          userId: targetUser.id,
          role: "OWNER",
        })
      ).rejects.toThrow("Only workspace owners can assign the OWNER role.");

      // ADMIN tries to assign ADMIN role to target user -> MUST FAIL (403)
      await expect(
        WorkspaceService.addMember(admin.id, workspace.id, {
          userId: targetUser.id,
          role: "ADMIN",
        })
      ).rejects.toThrow(
        "Administrators cannot assign the ADMIN role. Only the workspace owner can assign administrators."
      );

      // ADMIN CAN assign EDITOR or VIEWER roles
      const addedEditor = await WorkspaceService.addMember(
        admin.id,
        workspace.id,
        {
          userId: targetUser.id,
          role: "EDITOR",
        }
      );
      expect(addedEditor.role).toBe("EDITOR");
      expect(addedEditor.userId).toBe(targetUser.id);
    });

    it("prevents admins from altering or demoting owners or other admins", async () => {
      const owner = await createTestUser("owner");
      const admin1 = await createTestUser("admin1");
      const admin2 = await createTestUser("admin2");

      const workspace = await WorkspaceService.createWorkspace(owner.id, {
        name: "Admin Boundaries Space",
      });

      await WorkspaceService.addMember(owner.id, workspace.id, {
        userId: admin1.id,
        role: "ADMIN",
      });
      await WorkspaceService.addMember(owner.id, workspace.id, {
        userId: admin2.id,
        role: "ADMIN",
      });

      // Admin1 tries to demote Owner to VIEWER -> MUST FAIL (403)
      await expect(
        WorkspaceService.addMember(admin1.id, workspace.id, {
          userId: owner.id,
          role: "VIEWER",
        })
      ).rejects.toThrow("Administrators cannot alter an owner's role.");

      // Admin1 tries to demote Admin2 to VIEWER -> MUST FAIL (403)
      await expect(
        WorkspaceService.addMember(admin1.id, workspace.id, {
          userId: admin2.id,
          role: "VIEWER",
        })
      ).rejects.toThrow(
        "Administrators cannot alter another administrator's role."
      );
    });

    it("prevents demoting the last remaining workspace owner", async () => {
      const owner = await createTestUser("singleowner");
      const workspace = await WorkspaceService.createWorkspace(owner.id, {
        name: "Sole Owner Space",
      });

      await expect(
        WorkspaceService.addMember(owner.id, workspace.id, {
          userId: owner.id,
          role: "ADMIN",
        })
      ).rejects.toThrow("Cannot demote the only workspace owner.");
    });
  });

  describe("2. Open Redirect Prevention", () => {
    it("strictly blocks external URLs, protocol-relative URLs, and script injections", () => {
      expect(getSafeRedirectUrl("https://evil.com")).toBe("/app");
      expect(getSafeRedirectUrl("http://evil.com/phishing")).toBe("/app");
      expect(getSafeRedirectUrl("//evil.com")).toBe("/app");
      expect(getSafeRedirectUrl("//evil.com/path")).toBe("/app");
      expect(getSafeRedirectUrl("/\\evil.com")).toBe("/app");
      expect(getSafeRedirectUrl("javascript:alert(1)")).toBe("/app");
      expect(getSafeRedirectUrl("data:text/html,<script>alert(1)</script>")).toBe(
        "/app"
      );
      expect(getSafeRedirectUrl("")).toBe("/app");
      expect(getSafeRedirectUrl(null)).toBe("/app");
      expect(getSafeRedirectUrl(undefined)).toBe("/app");
    });

    it("allows valid relative internal paths with query parameters and hash fragments", () => {
      expect(getSafeRedirectUrl("/app/invitations/secure-token")).toBe(
        "/app/invitations/secure-token"
      );
      expect(
        getSafeRedirectUrl("/app/documents/art-123?version=4&diff=true#heading-2")
      ).toBe("/app/documents/art-123?version=4&diff=true#heading-2");
      expect(getSafeRedirectUrl("/app/settings")).toBe("/app/settings");
    });
  });

  describe("3. Safe URL Scheme Validation", () => {
    it("permits standard web and mailto protocols while rejecting dangerous schemes", () => {
      expect(isSafeUrlProtocol("https://syncspace.dev")).toBe(true);
      expect(isSafeUrlProtocol("http://localhost:3000/api")).toBe(true);
      expect(isSafeUrlProtocol("mailto:security@syncspace.dev")).toBe(true);

      expect(isSafeUrlProtocol("javascript:alert(document.cookie)")).toBe(false);
      expect(isSafeUrlProtocol("data:text/html;base64,PHNjcmlwdD4=")).toBe(
        false
      );
      expect(isSafeUrlProtocol("vbscript:MsgBox(1)")).toBe(false);
      expect(isSafeUrlProtocol("file:///etc/passwd")).toBe(false);
      expect(isSafeUrlProtocol("")).toBe(false);
    });
  });

  describe("4. Rate Limiting & Abuse Prevention", () => {
    it("enforces sliding window request thresholds and generates standard 429 responses", () => {
      const key = "test-user-rate-limit";
      const limit = 3;
      const windowMs = 5000;

      // Requests 1 to 3 should succeed
      expect(checkRateLimit(key, limit, windowMs).success).toBe(true);
      expect(checkRateLimit(key, limit, windowMs).success).toBe(true);
      const res3 = checkRateLimit(key, limit, windowMs);
      expect(res3.success).toBe(true);
      expect(res3.remaining).toBe(0);

      // Request 4 should be rate limited
      const res4 = checkRateLimit(key, limit, windowMs);
      expect(res4.success).toBe(false);
      expect(res4.remaining).toBe(0);
      expect(res4.resetMs).toBeGreaterThan(0);

      // Verify HTTP 429 response structure
      const httpResponse = rateLimitResponse(res4);
      expect(httpResponse.status).toBe(429);
      expect(httpResponse.headers.get("Retry-After")).toBeDefined();
      expect(httpResponse.headers.get("X-RateLimit-Limit")).toBe("3");
      expect(httpResponse.headers.get("X-RateLimit-Remaining")).toBe("0");
    });
  });

  describe("5. Safe Request Body Parsing", () => {
    it("parses valid JSON payloads safely", async () => {
      const req = new Request("http://localhost/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Testing", count: 42 }),
      });

      const result = await parseJsonBody<{ name: string; count: number }>(req);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Testing");
        expect(result.data.count).toBe(42);
      }
    });

    it("catches malformed JSON payloads and returns structured error instead of throwing", async () => {
      const req = new Request("http://localhost/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ malformed json :::",
      });

      const result = await parseJsonBody(req);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Invalid JSON request body.");
      }
    });
  });

  describe("6. Collaboration Authorization & Real-Time Revocation Resilience", () => {
    it("authorizes collaborative rooms and rejects unauthorized or revoked members", async () => {
      const owner = await createTestUser("room-owner");
      const editor = await createTestUser("room-editor");
      const outsider = await createTestUser("room-outsider");

      const workspace = await WorkspaceService.createWorkspace(owner.id, {
        name: "Collaboration Security Space",
      });

      await WorkspaceService.addMember(owner.id, workspace.id, {
        userId: editor.id,
        role: "EDITOR",
      });

      const doc = await ArtifactService.createArtifact(owner.id, {
        workspaceId: workspace.id,
        type: "DOCUMENT",
        title: "Security Spec",
      });

      // 1. Editor has write permission to room
      const editorAccess = await AuthorizationService.requireArtifactRoomAccess(
        editor.id,
        doc.liveblocksRoomId,
        "DOCUMENT"
      );
      expect(editorAccess.canWrite).toBe(true);
      expect(editorAccess.effectiveRole).toBe("EDITOR");

      // 2. Outsider (non-member) is rejected (403)
      await expect(
        AuthorizationService.requireArtifactRoomAccess(
          outsider.id,
          doc.liveblocksRoomId,
          "DOCUMENT"
        )
      ).rejects.toThrow();

      // 3. Set explicit NONE permission override for editor on this document
      await ArtifactService.setArtifactPermission(
        owner.id,
        doc.id,
        editor.id,
        "NONE"
      );

      // 4. Editor is now immediately blocked from room access (403)
      await expect(
        AuthorizationService.requireArtifactRoomAccess(
          editor.id,
          doc.liveblocksRoomId,
          "DOCUMENT"
        )
      ).rejects.toThrow("Access to this artifact has been explicitly revoked.");

      // 5. Mismatched artifact type (e.g. requesting DOCUMENT room as WHITEBOARD) is rejected (403)
      await expect(
        AuthorizationService.requireArtifactRoomAccess(
          owner.id,
          doc.liveblocksRoomId,
          "WHITEBOARD"
        )
      ).rejects.toThrow("Room does not belong to a WHITEBOARD artifact.");
    });
  });
});
