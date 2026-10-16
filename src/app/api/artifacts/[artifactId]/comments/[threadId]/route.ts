import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { CommentService } from "@/services/comment.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";

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
    const body = await req.json();
    const { action } = body as { action?: "resolve" | "reopen" };

    if (action !== "resolve" && action !== "reopen") {
      return NextResponse.json(
        { error: "Invalid action. Expected 'resolve' or 'reopen'." },
        { status: 400 }
      );
    }

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
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
