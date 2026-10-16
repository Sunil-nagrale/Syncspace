import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  AuthorizationService,
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";
import { WorkspaceRole } from "@prisma/client";

const VALID_ROLES: WorkspaceRole[] = ["OWNER", "ADMIN", "EDITOR", "VIEWER"];

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
    await AuthorizationService.requireWorkspaceAccess(
      session.user.id,
      workspaceId,
      "ADMIN"
    );

    const body = await req.json();
    const { userId, email, role } = body as {
      userId?: string;
      email?: string;
      role?: WorkspaceRole;
    };

    const assignedRole: WorkspaceRole =
      role && VALID_ROLES.includes(role) ? role : "VIEWER";

    let targetUserId = userId;
    if (!targetUserId && email) {
      const targetUser = await prisma.user.findUnique({
        where: { email },
      });
      if (!targetUser) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      targetUserId = targetUser.id;
    }

    if (!targetUserId) {
      return NextResponse.json(
        { error: "userId or email is required" },
        { status: 400 }
      );
    }

    const member = await prisma.workspaceMember.upsert({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: targetUserId,
        },
      },
      update: {
        role: assignedRole,
      },
      create: {
        workspaceId,
        userId: targetUserId,
        role: assignedRole,
      },
    });

    await prisma.activityEvent.create({
      data: {
        workspaceId,
        userId: session.user.id,
        action: "member.added",
        entityType: "workspace_member",
        entityId: member.id,
        metadata: { targetUserId, role: assignedRole },
      },
    });

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
