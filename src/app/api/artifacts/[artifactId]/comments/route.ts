import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { CommentService } from "@/services/comment.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ artifactId: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { artifactId } = await params;
    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status");
    const status =
      statusParam === "open" || statusParam === "resolved"
        ? statusParam
        : "all";

    const threads = await CommentService.listThreads(
      session.user.id,
      artifactId,
      { status }
    );

    return NextResponse.json({ data: threads });
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

export async function POST(
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
    const { content, anchorType, anchorData } = body as {
      content?: string;
      anchorType?: string;
      anchorData?: unknown;
    };

    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json(
        { error: "Content is required." },
        { status: 400 }
      );
    }

    const thread = await CommentService.createThread({
      actorUserId: session.user.id,
      artifactId,
      content,
      anchorType: anchorType ?? "GENERAL",
      anchorData,
    });

    return NextResponse.json({ data: thread }, { status: 201 });
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
