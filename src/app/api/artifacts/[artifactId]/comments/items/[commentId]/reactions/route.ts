import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { CommentService } from "@/services/comment.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ artifactId: string; commentId: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { commentId } = await params;
    const body = await req.json();
    const { emoji } = body as { emoji?: string };

    if (!emoji || typeof emoji !== "string" || !emoji.trim()) {
      return NextResponse.json(
        { error: "Valid emoji string is required." },
        { status: 400 }
      );
    }

    const result = await CommentService.toggleReaction({
      actorUserId: session.user.id,
      commentId,
      emoji: emoji.trim(),
    });

    return NextResponse.json({ data: result });
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
