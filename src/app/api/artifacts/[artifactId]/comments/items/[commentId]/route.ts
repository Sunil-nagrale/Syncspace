import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { CommentService } from "@/services/comment.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";
import { updateCommentSchema } from "@/lib/validations/comment";

export async function PATCH(
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

    const parseResult = updateCommentSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0]?.message || "Invalid comment update content." },
        { status: 400 }
      );
    }

    const updated = await CommentService.updateComment({
      actorUserId: session.user.id,
      commentId,
      content: parseResult.data.content,
    });

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
    console.error("PATCH /api/artifacts/[artifactId]/comments/items/[commentId] error:", err);
    return NextResponse.json({ error: "Failed to update comment." }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
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

    const result = await CommentService.deleteComment({
      actorUserId: session.user.id,
      commentId,
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
    console.error("DELETE /api/artifacts/[artifactId]/comments/items/[commentId] error:", err);
    return NextResponse.json({ error: "Failed to delete comment." }, { status: 500 });
  }
}
