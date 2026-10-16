import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { CommentService } from "@/services/comment.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ artifactId: string; threadId: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { threadId } = await params;
    if (!threadId || typeof threadId !== "string" || !threadId.trim()) {
      return NextResponse.json({ error: "Thread ID is required." }, { status: 400 });
    }

    const events = await CommentService.getThreadEvents(session.user.id, threadId);

    return NextResponse.json({ data: events });
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
    console.error("GET /api/artifacts/[artifactId]/comments/threads/[threadId]/events error:", err);
    return NextResponse.json({ error: "Failed to retrieve thread events." }, { status: 500 });
  }
}
