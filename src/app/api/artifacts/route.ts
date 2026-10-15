import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { ArtifactService } from "@/services/artifact.service";
import { AuthorizationError, NotFoundError } from "@/services/authorization.service";
import { ArtifactType } from "@prisma/client";

export async function GET(req: Request) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get("workspaceId");
    const projectId = searchParams.get("projectId") || undefined;
    const type = (searchParams.get("type") as ArtifactType) || undefined;

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const artifacts = await ArtifactService.getWorkspaceArtifacts(
      session.user.id,
      workspaceId,
      { projectId, type }
    );

    return NextResponse.json({ data: artifacts });
  } catch (err: unknown) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { workspaceId, projectId, type, title, description, icon, coverImageUrl } = body;

    if (!workspaceId || !type) {
      return NextResponse.json(
        { error: "workspaceId and type (DOCUMENT | WHITEBOARD) are required" },
        { status: 400 }
      );
    }

    const artifact = await ArtifactService.createArtifact(
      session.user.id,
      {
        workspaceId,
        projectId,
        type,
        title,
        description,
        icon,
        coverImageUrl,
      }
    );

    return NextResponse.json({ data: artifact }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
