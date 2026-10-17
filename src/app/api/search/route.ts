import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getServerSession } from "@/lib/session";
import { SearchService } from "@/services/search.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";
import { SearchValidationError } from "@/lib/validations/search";

export async function GET(req: Request) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);

    const rawParams: Record<string, unknown> = {
      q: searchParams.has("q") ? searchParams.get("q") ?? "" : undefined,
      workspaceId: searchParams.has("workspaceId")
        ? searchParams.get("workspaceId") ?? ""
        : undefined,
      projectId: searchParams.has("projectId")
        ? searchParams.get("projectId") ?? ""
        : undefined,
      type: searchParams.has("type")
        ? searchParams.get("type") ?? ""
        : undefined,
      limit: searchParams.has("limit")
        ? searchParams.get("limit") ?? ""
        : undefined,
      cursor: searchParams.has("cursor")
        ? searchParams.get("cursor") ?? ""
        : undefined,
      includeRecent: searchParams.has("includeRecent")
        ? searchParams.get("includeRecent") ?? ""
        : undefined,
    };

    const result = await SearchService.search(session.user.id, rawParams);

    return NextResponse.json(
      { data: result },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
        },
      }
    );
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      const firstIssue = err.issues[0];
      return NextResponse.json(
        { error: firstIssue?.message || "Invalid search parameters." },
        { status: 400 }
      );
    }
    if (err instanceof SearchValidationError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode }
      );
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof AuthorizationError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode }
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
