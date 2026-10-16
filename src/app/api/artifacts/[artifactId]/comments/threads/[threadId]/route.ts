import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { CommentService } from "@/services/comment.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";
import { threadActionSchema } from "@/lib/validations/comment";

export async function PATCH(
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

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
    }

    const parseResult = threadActionSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0]?.message || "Invalid action." },
        { status: 400 }
      );
    }

    const { action } = parseResult.data;

    const thread =
      action === "resolve"
        ? await CommentService.resolveThread(session.user.id, threadId)
        : await CommentService.reopenThread(session.user.id, threadId);

    return NextResponse.json({ data: thread });
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
    console.error("PATCH /api/artifacts/[artifactId]/comments/threads/[threadId] error:", err);
    return NextResponse.json({ error: "Failed to update thread status." }, { status: 500 });
  }
}
