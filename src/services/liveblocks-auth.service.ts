import { Liveblocks } from "@liveblocks/node";
import {
  AuthorizationService,
  AuthorizationError,
} from "./authorization.service";

export class LiveblocksConfigurationError extends Error {
  public readonly statusCode = 503;
  public readonly code = "LIVEBLOCKS_SECRET_KEY_NOT_CONFIGURED";

  constructor(
    message: string = "Liveblocks server secret key (LIVEBLOCKS_SECRET_KEY) is missing or set to a placeholder. Obtain a valid sk_... secret key from https://liveblocks.io/dashboard/apikeys to enable live room token minting."
  ) {
    super(message);
    this.name = "LiveblocksConfigurationError";
  }
}

export interface AuthenticatedCollaborator {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  color?: string | null;
}

export interface LiveblocksSessionLike {
  readonly FULL_ACCESS: readonly ["*:write"];
  readonly READ_ACCESS: readonly ["*:read"];
  allow(
    roomIdOrPattern: string,
    permissions: readonly ("*:write" | "*:read")[]
  ): this;
  authorize(): Promise<{ status: number; body: string; error?: Error }>;
}

export interface LiveblocksClientLike {
  prepareSession(
    userId: string,
    options?: {
      userInfo?: Record<string, string | undefined>;
    }
  ): LiveblocksSessionLike;
}

const COLLABORATOR_PALETTE = [
  "#F43F5E",
  "#F97316",
  "#F59E0B",
  "#10B981",
  "#14B8A6",
  "#3B82F6",
  "#8B5CF6",
  "#D946EF",
];

export function getDeterministicUserColor(
  userId: string,
  explicitColor?: string | null
): string {
  if (explicitColor && /^#[0-9A-Fa-f]{6}$/.test(explicitColor)) {
    return explicitColor;
  }
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return COLLABORATOR_PALETTE[hash % COLLABORATOR_PALETTE.length];
}

export function isLiveblocksSecretKeyConfigured(
  ...args: [string | undefined] | []
): boolean {
  const secretKey =
    args.length === 0 ? process.env.LIVEBLOCKS_SECRET_KEY : args[0];
  if (!secretKey || typeof secretKey !== "string") {
    return false;
  }
  const trimmed = secretKey.trim();
  if (!trimmed.startsWith("sk_")) {
    return false;
  }
  if (
    trimmed.toLowerCase().includes("placeholder") ||
    trimmed === "sk_dev_placeholder_liveblocks_secret_key"
  ) {
    return false;
  }
  return trimmed.length > 10;
}

export function resolveLiveblocksPermissions(
  effectiveRole: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER"
): readonly ["*:write"] | readonly ["*:read"] {
  if (effectiveRole === "VIEWER") {
    return ["*:read"] as const;
  }
  return ["*:write"] as const;
}

export class LiveblocksAuthService {
  /**
   * Authenticates and authorizes a user for a specific Liveblocks collaboration room
   * backed by a PostgreSQL Artifact record, enforcing artifact type checks.
   */
  static async authorizeArtifactRoom(params: {
    user: AuthenticatedCollaborator | null | undefined;
    roomId: unknown;
    expectedType?: "DOCUMENT" | "WHITEBOARD";
    liveblocksClient?: LiveblocksClientLike;
    secretKey?: string;
  }): Promise<{
    status: number;
    body: string;
    artifactId: string;
    roomId: string;
    artifactType: "DOCUMENT" | "WHITEBOARD";
    effectiveRole: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
    canWrite: boolean;
    permissions: readonly ("*:write" | "*:read")[];
  }> {
    const { user, roomId, expectedType, liveblocksClient, secretKey } = params;

    if (!user?.id) {
      throw new AuthorizationError("Authentication required.", 401);
    }

    if (typeof roomId !== "string" || !roomId.trim()) {
      throw new AuthorizationError(
        "A valid Liveblocks room ID is required.",
        400
      );
    }

    const normalizedRoomId = roomId.trim();

    // Verify room exists in PostgreSQL, belongs to a non-archived artifact of expectedType,
    // and resolve effective workspace + artifact-override permissions.
    const { artifact, effectiveRole, canWrite } =
      await AuthorizationService.requireArtifactRoomAccess(
        user.id,
        normalizedRoomId,
        expectedType
      );

    const permissions = resolveLiveblocksPermissions(effectiveRole);

    // Ensure Liveblocks secret key is configured before minting a room token
    let client: LiveblocksClientLike | undefined = liveblocksClient;
    if (!client) {
      const resolvedKey = secretKey ?? process.env.LIVEBLOCKS_SECRET_KEY;
      if (!isLiveblocksSecretKeyConfigured(resolvedKey)) {
        throw new LiveblocksConfigurationError();
      }
      client = new Liveblocks({
        secret: resolvedKey!.trim(),
      }) as unknown as LiveblocksClientLike;
    }

    const collaboratorColor = getDeterministicUserColor(user.id, user.color);

    const session = client.prepareSession(user.id, {
      userInfo: {
        name: user.name || user.email || "Collaborator",
        email: user.email,
        color: collaboratorColor,
        avatar: user.image || undefined,
        role: effectiveRole,
      },
    });

    session.allow(
      artifact.liveblocksRoomId,
      canWrite ? session.FULL_ACCESS : session.READ_ACCESS
    );

    let authResponse: Awaited<ReturnType<typeof session.authorize>> | null = null;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        authResponse = await session.authorize();
        if (!authResponse.error && authResponse.status < 400) {
          break;
        }
        lastError = authResponse.error;
      } catch (err) {
        lastError = err;
        if (attempt === 3) break;
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }

    if (!authResponse || authResponse.error || authResponse.status >= 400) {
      const errMsg =
        authResponse?.error?.message ||
        (lastError instanceof Error ? lastError.message : undefined) ||
        `Liveblocks room token minting failed with status ${authResponse?.status ?? 500}.`;
      throw new Error(errMsg);
    }

    return {
      status: authResponse.status,
      body: authResponse.body,
      artifactId: artifact.id,
      roomId: artifact.liveblocksRoomId,
      artifactType: artifact.type as "DOCUMENT" | "WHITEBOARD",
      effectiveRole,
      canWrite,
      permissions,
    };
  }

  /**
   * Authenticates and authorizes a user for a specific Liveblocks document room.
   */
  static async authorizeDocumentRoom(params: {
    user: AuthenticatedCollaborator | null | undefined;
    roomId: unknown;
    liveblocksClient?: LiveblocksClientLike;
    secretKey?: string;
  }) {
    return this.authorizeArtifactRoom({
      ...params,
      expectedType: "DOCUMENT",
    });
  }

  /**
   * Authenticates and authorizes a user for a specific Liveblocks whiteboard room.
   */
  static async authorizeWhiteboardRoom(params: {
    user: AuthenticatedCollaborator | null | undefined;
    roomId: unknown;
    liveblocksClient?: LiveblocksClientLike;
    secretKey?: string;
  }) {
    return this.authorizeArtifactRoom({
      ...params,
      expectedType: "WHITEBOARD",
    });
  }
}
