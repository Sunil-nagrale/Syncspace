import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { InvitationService } from "@/services/invitation.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";
import { parseJsonBody } from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { WorkspaceRole } from "@prisma/client";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { workspaceId } = await params;
    const invitations = await InvitationService.listWorkspaceInvitations(
      session.user.id,
      workspaceId
    );

    return NextResponse.json({ data: invitations });
  } catch (err: unknown) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof AuthorizationError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode }
      );
    }
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { workspaceId } = await params;

    const rateResult = checkRateLimit(
      `invitations:${workspaceId}:${session.user.id}`,
      20,
      60_000
    );
    if (!rateResult.success) {
      return rateLimitResponse(rateResult);
    }

    const bodyResult = await parseJsonBody<{
      email?: string;
      role?: WorkspaceRole;
    }>(req);

    if (!bodyResult.success) {
      return NextResponse.json({ error: bodyResult.error }, { status: 400 });
    }

    const body = bodyResult.data;

    if (!body?.email || typeof body.email !== "string") {
      return NextResponse.json(
        { error: "A valid email address is required." },
        { status: 400 }
      );
    }

    const result = await InvitationService.createInvitation(
      session.user.id,
      workspaceId,
      {
        email: body.email,
        role: body.role,
      }
    );

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof AuthorizationError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode }
      );
    }
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
