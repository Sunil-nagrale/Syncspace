import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { CommentService } from "@/services/comment.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";
import {
  listThreadsQuerySchema,
  createThreadSchema,
} from "@/lib/validations/comment";

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
    if (!artifactId || typeof artifactId !== "string" || !artifactId.trim()) {
      return NextResponse.json({ error: "Artifact ID is required." }, { status: 400 });
    }

    const url = new URL(req.url);
    const queryParams = {
      status: url.searchParams.get("status") ?? "open",
      limit: url.searchParams.get("limit") ?? "20",
      cursor: url.searchParams.get("cursor") ?? undefined,
    };

    const parsedQuery = listThreadsQuerySchema.safeParse(queryParams);
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: parsedQuery.error.issues[0]?.message || "Invalid query parameters." },
        { status: 400 }
      );
    }

    const threads = await CommentService.listThreads(
      session.user.id,
      artifactId,
      {
        status: parsedQuery.data.status,
        limit: parsedQuery.data.limit,
        cursor: parsedQuery.data.cursor,
      }
    );

    return NextResponse.json({
      data: threads,
      pagination: {
        nextCursor: threads.nextCursor,
        hasMore: threads.hasMore,
        limit: parsedQuery.data.limit ?? 20,
        openCount: threads.openCount,
        resolvedCount: threads.resolvedCount,
        totalCount: threads.totalCount,
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
    console.error("GET /api/artifacts/[artifactId]/comments error:", err);
    return NextResponse.json({ error: "Failed to retrieve discussions." }, { status: 500 });
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
    if (!artifactId || typeof artifactId !== "string" || !artifactId.trim()) {
      return NextResponse.json({ error: "Artifact ID is required." }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
    }

    const parseResult = createThreadSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0]?.message || "Invalid comment thread input." },
        { status: 400 }
      );
    }

    const thread = await CommentService.createThread({
      actorUserId: session.user.id,
      artifactId,
      content: parseResult.data.content,
      anchorType: parseResult.data.anchorType,
      anchorData: parseResult.data.anchorData,
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
    console.error("POST /api/artifacts/[artifactId]/comments error:", err);
    return NextResponse.json({ error: "Failed to create comment thread." }, { status: 500 });
  }
}
