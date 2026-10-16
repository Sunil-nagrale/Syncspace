import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { CommentService } from "@/services/comment.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";

export async function POST(
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
    const { content } = body as { content?: string };

    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json(
        { error: "Content is required." },
        { status: 400 }
      );
    }

    const reply = await CommentService.createReply({
      actorUserId: session.user.id,
      threadId,
      content,
    });

    return NextResponse.json({ data: reply }, { status: 201 });
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
