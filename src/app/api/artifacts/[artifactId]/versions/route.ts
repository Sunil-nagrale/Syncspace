import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { VersionService } from "@/services/version.service";
import {
  AuthorizationError,
  NotFoundError,
  ConflictError,
} from "@/services/authorization.service";
import {
  listVersionsQuerySchema,
  createVersionSchema,
} from "@/lib/validations/version";

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

    const queryParse = listVersionsQuerySchema.safeParse({
      limit: url.searchParams.get("limit") || undefined,
      cursor: url.searchParams.get("cursor") || undefined,
    });

    if (!queryParse.success) {
      return NextResponse.json(
        { error: "Invalid query parameters.", details: queryParse.error.format() },
        { status: 400 }
      );
    }

    const result = await VersionService.listVersions(
      session.user.id,
      artifactId,
      queryParse.data
    );

    return NextResponse.json({
      data: result.items,
      nextCursor: result.nextCursor,
      totalCount: result.totalCount,
      currentRevision: result.currentRevision,
    });
  } catch (err: unknown) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
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
    const body = await req.json().catch(() => ({}));

    const parsed = createVersionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid checkpoint payload.", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const version = await VersionService.createCheckpoint(
      session.user.id,
      artifactId,
      {
        title: parsed.data.title,
        changeSummary: parsed.data.changeSummary,
        snapshotData: parsed.data.snapshotData,
        source: "MANUAL",
      }
    );

    return NextResponse.json({ data: version }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    if (err instanceof ConflictError) {
      return NextResponse.json(
        { error: err.message, currentRevision: err.currentRevision },
        { status: 409 }
      );
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
