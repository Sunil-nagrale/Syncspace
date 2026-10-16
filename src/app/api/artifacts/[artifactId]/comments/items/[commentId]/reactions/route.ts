import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { CommentService } from "@/services/comment.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";
import { toggleReactionSchema } from "@/lib/validations/comment";

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
    if (!commentId || typeof commentId !== "string" || !commentId.trim()) {
      return NextResponse.json({ error: "Comment ID is required." }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
    }

    const parseResult = toggleReactionSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0]?.message || "Invalid reaction emoji." },
        { status: 400 }
      );
    }

    const { emoji, intent } = parseResult.data;

    const result = await CommentService.toggleReaction({
      actorUserId: session.user.id,
      commentId,
      emoji,
      intent,
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
    console.error("POST /api/artifacts/[artifactId]/comments/items/[commentId]/reactions error:", err);
    return NextResponse.json({ error: "Failed to toggle reaction." }, { status: 500 });
  }
}
