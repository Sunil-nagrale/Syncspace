import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { WorkspaceService } from "@/services/workspace.service";
import { ArtifactService } from "@/services/artifact.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";
import {
  LiveblocksAuthService,
  LiveblocksConfigurationError,
  type LiveblocksClientLike,
  type LiveblocksSessionLike,
} from "@/services/liveblocks-auth.service";

function createTestLiveblocksClient() {
  const calls: Array<{
    userId: string;
    userInfo?: Record<string, string | undefined>;
    roomId: string;
    permissions: readonly ("*:write" | "*:read")[];
  }> = [];

  const client: LiveblocksClientLike = {
    prepareSession(userId, options) {
      let allowedRoom = "";
      let allowedPerms: readonly ("*:write" | "*:read")[] = [];

      const session: LiveblocksSessionLike = {
        FULL_ACCESS: ["*:write"] as const,
        READ_ACCESS: ["*:read"] as const,
        allow(roomIdOrPattern, permissions) {
          allowedRoom = roomIdOrPattern;
          allowedPerms = permissions;
          return this;
        },
        async authorize() {
          calls.push({
            userId,
            userInfo: options?.userInfo,
            roomId: allowedRoom,
            permissions: allowedPerms,
          });
          return {
            status: 200,
            body: JSON.stringify({
              token: `test_lb_token_${userId}_${allowedRoom}`,
              roomId: allowedRoom,
              permissions: allowedPerms,
            }),
          };
        },
      };

      return session;
    },
  };

  return { client, calls };
}

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Liveblocks Room Authorization & Artifact Permission Overrides (PostgreSQL Integration)", () => {
  it("enforces authentication, room lookup, artifact type check, RBAC scopes, and per-artifact permission overrides (EDITOR, VIEWER, NONE)", async () => {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);

    // 1. Create Owner, Admin, Editor, Viewer, and Outsider users in PostgreSQL
    const [owner, admin, editor, viewer, outsider] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Doc Owner",
          email: `lb.owner.${timestamp}.${rand}@syncspace.dev`,
          color: "#6366F1",
        },
      }),
      prisma.user.create({
        data: {
          name: "Doc Admin",
          email: `lb.admin.${timestamp}.${rand}@syncspace.dev`,
          color: "#8B5CF6",
        },
      }),
      prisma.user.create({
        data: {
          name: "Doc Editor",
          email: `lb.editor.${timestamp}.${rand}@syncspace.dev`,
          color: "#10B981",
        },
      }),
      prisma.user.create({
        data: {
          name: "Doc Viewer",
          email: `lb.viewer.${timestamp}.${rand}@syncspace.dev`,
          color: "#F59E0B",
        },
      }),
      prisma.user.create({
        data: {
          name: "Doc Outsider",
          email: `lb.outsider.${timestamp}.${rand}@syncspace.dev`,
          color: "#F43F5E",
        },
      }),
    ]);

    try {
      // 2. Owner creates a workspace and adds Admin, Editor, and Viewer
      const workspace = await WorkspaceService.createWorkspace(owner.id, {
        name: `Liveblocks Spec Team ${rand}`,
      });

      await prisma.workspaceMember.createMany({
        data: [
          { workspaceId: workspace.id, userId: admin.id, role: "ADMIN" },
          { workspaceId: workspace.id, userId: editor.id, role: "EDITOR" },
          { workspaceId: workspace.id, userId: viewer.id, role: "VIEWER" },
        ],
      });

      // 3. Create a DOCUMENT artifact and a WHITEBOARD artifact in PostgreSQL
      const docArtifact = await ArtifactService.createArtifact(owner.id, {
        workspaceId: workspace.id,
        type: "DOCUMENT",
        title: "Distributed Yjs Architecture",
      });

      const boardArtifact = await ArtifactService.createArtifact(owner.id, {
        workspaceId: workspace.id,
        type: "WHITEBOARD",
        title: "Network Topology Canvas",
      });

      const { client, calls } = createTestLiveblocksClient();

      // 4. Reject unauthenticated request (401)
      await expect(
        LiveblocksAuthService.authorizeDocumentRoom({
          user: null,
          roomId: docArtifact.liveblocksRoomId,
          liveblocksClient: client,
        })
      ).rejects.toThrow(AuthorizationError);

      // 5. Reject missing or malformed roomId (400)
      await expect(
        LiveblocksAuthService.authorizeDocumentRoom({
          user: owner,
          roomId: "   ",
          liveblocksClient: client,
        })
      ).rejects.toThrow(AuthorizationError);

      // 6. Reject nonexistent roomId (NotFoundError)
      await expect(
        LiveblocksAuthService.authorizeDocumentRoom({
          user: owner,
          roomId: "art_nonexistent_room_999999",
          liveblocksClient: client,
        })
      ).rejects.toThrow(NotFoundError);

      // 7. Reject WHITEBOARD roomId on the document room auth endpoint (403)
      await expect(
        LiveblocksAuthService.authorizeDocumentRoom({
          user: owner,
          roomId: boardArtifact.liveblocksRoomId,
          liveblocksClient: client,
        })
      ).rejects.toThrow(AuthorizationError);

      // 7b. Reject DOCUMENT roomId on the whiteboard room auth endpoint (403)
      await expect(
        LiveblocksAuthService.authorizeWhiteboardRoom({
          user: owner,
          roomId: docArtifact.liveblocksRoomId,
          liveblocksClient: client,
        })
      ).rejects.toThrow(AuthorizationError);

      // 7c. Authorized EDITOR receives write access on WHITEBOARD room
      const whiteboardEditorAuth =
        await LiveblocksAuthService.authorizeWhiteboardRoom({
          user: editor,
          roomId: boardArtifact.liveblocksRoomId,
          liveblocksClient: client,
        });
      expect(whiteboardEditorAuth.status).toBe(200);
      expect(whiteboardEditorAuth.effectiveRole).toBe("EDITOR");
      expect(whiteboardEditorAuth.canWrite).toBe(true);
      expect(whiteboardEditorAuth.artifactType).toBe("WHITEBOARD");
      expect(whiteboardEditorAuth.permissions).toEqual(["*:write"]);

      // 8. Reject unauthorized outsider user (NotFoundError / IDOR protection)
      await expect(
        LiveblocksAuthService.authorizeDocumentRoom({
          user: outsider,
          roomId: docArtifact.liveblocksRoomId,
          liveblocksClient: client,
        })
      ).rejects.toThrow(NotFoundError);

      // 9. Authorized EDITOR receives write access (FULL_ACCESS: ["*:write"])
      const editorAuth = await LiveblocksAuthService.authorizeDocumentRoom({
        user: editor,
        roomId: docArtifact.liveblocksRoomId,
        liveblocksClient: client,
      });
      expect(editorAuth.status).toBe(200);
      expect(editorAuth.effectiveRole).toBe("EDITOR");
      expect(editorAuth.canWrite).toBe(true);
      expect(editorAuth.permissions).toEqual(["*:write"]);

      // 10. Authorized VIEWER receives strictly read-only access (READ_ACCESS: ["*:read"])
      const viewerAuth = await LiveblocksAuthService.authorizeDocumentRoom({
        user: viewer,
        roomId: docArtifact.liveblocksRoomId,
        liveblocksClient: client,
      });
      expect(viewerAuth.status).toBe(200);
      expect(viewerAuth.effectiveRole).toBe("VIEWER");
      expect(viewerAuth.canWrite).toBe(false);
      expect(viewerAuth.permissions).toEqual(["*:read"]);

      // 11. Artifact-level permission override: upgrade workspace VIEWER to artifact EDITOR
      await ArtifactService.setArtifactPermission(
        owner.id,
        docArtifact.id,
        viewer.id,
        "EDITOR"
      );

      const upgradedViewerAuth =
        await LiveblocksAuthService.authorizeDocumentRoom({
          user: viewer,
          roomId: docArtifact.liveblocksRoomId,
          liveblocksClient: client,
        });
      expect(upgradedViewerAuth.effectiveRole).toBe("EDITOR");
      expect(upgradedViewerAuth.canWrite).toBe(true);
      expect(upgradedViewerAuth.permissions).toEqual(["*:write"]);

      // 12. Artifact-level permission override: constrain workspace ADMIN to artifact VIEWER
      await ArtifactService.setArtifactPermission(
        owner.id,
        docArtifact.id,
        admin.id,
        "VIEWER"
      );

      const constrainedAdminAuth =
        await LiveblocksAuthService.authorizeDocumentRoom({
          user: admin,
          roomId: docArtifact.liveblocksRoomId,
          liveblocksClient: client,
        });
      expect(constrainedAdminAuth.effectiveRole).toBe("VIEWER");
      expect(constrainedAdminAuth.canWrite).toBe(false);
      expect(constrainedAdminAuth.permissions).toEqual(["*:read"]);

      // Constrained ADMIN also cannot mutate the artifact in PostgreSQL
      await expect(
        ArtifactService.updateArtifact(admin.id, docArtifact.id, {
          title: "Unauthorized Admin Title Edit",
        })
      ).rejects.toThrow(AuthorizationError);

      // 13. Artifact-level permission override: revoke access (NONE) for EDITOR
      await ArtifactService.setArtifactPermission(
        owner.id,
        docArtifact.id,
        editor.id,
        "NONE"
      );

      await expect(
        LiveblocksAuthService.authorizeDocumentRoom({
          user: editor,
          roomId: docArtifact.liveblocksRoomId,
          liveblocksClient: client,
        })
      ).rejects.toThrow(AuthorizationError);

      await expect(
        ArtifactService.getArtifactById(editor.id, docArtifact.id)
      ).rejects.toThrow(AuthorizationError);

      // 14. Missing or placeholder secret key throws LiveblocksConfigurationError (503)
      await expect(
        LiveblocksAuthService.authorizeDocumentRoom({
          user: owner,
          roomId: docArtifact.liveblocksRoomId,
          secretKey: "sk_dev_placeholder_liveblocks_secret_key",
        })
      ).rejects.toThrow(LiveblocksConfigurationError);

      expect(calls.length).toBe(5);
    } finally {
      await prisma.user.deleteMany({
        where: {
          id: {
            in: [owner.id, admin.id, editor.id, viewer.id, outsider.id],
          },
        },
      });
    }
  });
});
