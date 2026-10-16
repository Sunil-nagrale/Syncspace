import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { CommentService } from "@/services/comment.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";
import {
  createReplySchema,
  listRepliesQuerySchema,
} from "@/lib/validations/comment";

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

    const url = new URL(req.url);
    const queryParams = {
      limit: url.searchParams.get("limit") ?? "20",
      cursor: url.searchParams.get("cursor") ?? undefined,
    };

    const parsedQuery = listRepliesQuerySchema.safeParse(queryParams);
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: parsedQuery.error.issues[0]?.message || "Invalid query parameters." },
        { status: 400 }
      );
    }

    const result = await CommentService.listReplies({
      actorUserId: session.user.id,
      threadId,
      limit: parsedQuery.data.limit,
      cursor: parsedQuery.data.cursor,
    });

    return NextResponse.json({
      data: result.replies,
      pagination: {
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        totalCount: result.totalCount,
        limit: parsedQuery.data.limit ?? 20,
      },
    });
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
    console.error("GET /api/artifacts/[artifactId]/comments/threads/[threadId]/replies error:", err);
    return NextResponse.json({ error: "Failed to retrieve replies." }, { status: 500 });
  }
}

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
    if (!threadId || typeof threadId !== "string" || !threadId.trim()) {
      return NextResponse.json({ error: "Thread ID is required." }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
    }

    const parseResult = createReplySchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0]?.message || "Invalid reply content." },
        { status: 400 }
      );
    }

    const reply = await CommentService.createReply({
      actorUserId: session.user.id,
      threadId,
      content: parseResult.data.content,
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
    console.error("POST /api/artifacts/[artifactId]/comments/threads/[threadId]/replies error:", err);
    return NextResponse.json({ error: "Failed to create reply." }, { status: 500 });
  }
}
