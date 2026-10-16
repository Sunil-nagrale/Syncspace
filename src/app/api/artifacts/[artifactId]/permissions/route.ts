import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { ArtifactService } from "@/services/artifact.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";

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
    const body = await req.json();
    const { userId, role } = body as {
      userId?: string;
      role?: "EDITOR" | "VIEWER" | "NONE" | "INHERIT";
    };

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
