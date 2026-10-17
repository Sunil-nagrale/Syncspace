import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { ArtifactService } from "@/services/artifact.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";
import { parseJsonBody } from "@/lib/security";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ artifactId: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { artifactId } = await params;
    const permissions = await ArtifactService.getArtifactPermissions(
      session.user.id,
      artifactId
    );

    return NextResponse.json({ data: permissions });
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

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ artifactId: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { artifactId } = await params;
    const bodyResult = await parseJsonBody<{
      userId?: string;
      role?: "EDITOR" | "VIEWER" | "NONE" | "INHERIT";
    }>(req);

    if (!bodyResult.success) {
      return NextResponse.json({ error: bodyResult.error }, { status: 400 });
    }

    const { userId, role } = bodyResult.data;

    if (
      !userId ||
      !role ||
      !["EDITOR", "VIEWER", "NONE", "INHERIT"].includes(role)
    ) {
      return NextResponse.json(
        {
          error:
            "userId and a valid role (EDITOR | VIEWER | NONE | INHERIT) are required.",
        },
        { status: 400 }
      );
    }

    const updated = await ArtifactService.setArtifactPermission(
      session.user.id,
      artifactId,
      userId,
      role
    );

    return NextResponse.json({ data: updated });
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

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ artifactId: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { artifactId } = await params;
    const url = new URL(req.url);
    let targetUserId = url.searchParams.get("userId");

    if (!targetUserId) {
      try {
        const body = (await req.json()) as { userId?: string };
        targetUserId = body?.userId ?? null;
      } catch {
        // Body is optional if query parameter is used
      }
    }

    if (!targetUserId) {
      return NextResponse.json(
        { error: "userId query parameter or JSON body is required." },
        { status: 400 }
      );
    }

    await ArtifactService.setArtifactPermission(
      session.user.id,
      artifactId,
      targetUserId,
      "INHERIT"
    );

    return NextResponse.json({ success: true });
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
