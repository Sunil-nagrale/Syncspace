import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { WorkspaceService } from "@/services/workspace.service";
import { AuthorizationError } from "@/services/authorization.service";

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workspaces = await WorkspaceService.getUserWorkspaces(session.user.id);
    return NextResponse.json({ data: workspaces });
  } catch (err: unknown) {
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
    const workspace = await WorkspaceService.createWorkspace(session.user.id, {
      name: body.name,
      slug: body.slug,
      logoUrl: body.logoUrl,
      createDefaultProject: body.createDefaultProject ?? true,
    });

    return NextResponse.json({ data: workspace }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
