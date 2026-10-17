import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { WorkspaceService } from "@/services/workspace.service";
import {
  AuthorizationService,
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
    await AuthorizationService.requireWorkspaceAccess(
      session.user.id,
      workspaceId,
      "VIEWER"
    );

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            color: true,
          },
        },
      },
      orderBy: { joinedAt: "asc" },
    });

    return NextResponse.json({ data: members });
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
      `members:${workspaceId}:${session.user.id}`,
      30,
      60_000
    );
    if (!rateResult.success) {
      return rateLimitResponse(rateResult);
    }

    const bodyResult = await parseJsonBody<{
      userId?: string;
      email?: string;
      role?: WorkspaceRole;
    }>(req);

    if (!bodyResult.success) {
      return NextResponse.json({ error: bodyResult.error }, { status: 400 });
    }

    const member = await WorkspaceService.addMember(
      session.user.id,
      workspaceId,
      bodyResult.data
    );

    return NextResponse.json({ data: member }, { status: 201 });
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
