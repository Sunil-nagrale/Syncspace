import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { ActivityService } from "@/services/activity.service";
import { ActivityValidationError } from "@/lib/validations/activity";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

/**
 * GET /api/workspaces/[workspaceId]/activity
 * Query params:
 *   - limit?: number (1..50, default 15)
 *   - cursor?: string (base64url encoded keyset cursor)
 *   - category?: "ALL" | "ARTIFACT" | "PROJECT" | "COMMENT" | "VERSION" | "ATTACHMENT" | "MEMBER"
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    const { workspaceId } = await context.params;
    const { searchParams } = new URL(request.url);

    const limitParam = searchParams.get("limit");
    const cursorParam = searchParams.get("cursor");
    const categoryParam = searchParams.get("category");

    const result = await ActivityService.listWorkspaceActivity(
      session.user.id,
      workspaceId,
      {
        limit: limitParam !== null ? limitParam : undefined,
        cursor: cursorParam !== null ? cursorParam : undefined,
        category: categoryParam !== null ? categoryParam : undefined,
      }
    );

    return NextResponse.json(result, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    if (error instanceof ActivityValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode, headers: NO_STORE_HEADERS }
      );
    }

    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode, headers: NO_STORE_HEADERS }
      );
    }

    if (error instanceof NotFoundError) {
      return NextResponse.json(
        { error: error.message },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    console.error("[GET /api/workspaces/[workspaceId]/activity] Error:", error);
    return NextResponse.json(
      { error: "Failed to load workspace activity feed." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
