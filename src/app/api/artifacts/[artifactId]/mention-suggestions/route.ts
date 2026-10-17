import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { NotificationService } from "@/services/notification.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";
import { mentionSuggestionsQuerySchema } from "@/lib/validations/notification";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ artifactId: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateResult = checkRateLimit(
      `mentions:${session.user.id}`,
      60,
      60_000
    );
    if (!rateResult.success) {
      return rateLimitResponse(rateResult);
    }

    const { artifactId } = await params;
    if (!artifactId || typeof artifactId !== "string" || !artifactId.trim()) {
      return NextResponse.json(
        { error: "Artifact ID is required." },
        { status: 400 }
      );
    }

    const url = new URL(req.url);
    const parsedQuery = mentionSuggestionsQuerySchema.safeParse({
      q: url.searchParams.get("q") ?? undefined,
    });

    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: parsedQuery.error.issues[0]?.message || "Invalid search query." },
        { status: 400 }
      );
    }

    const suggestions = await NotificationService.getMentionSuggestions({
      actorUserId: session.user.id,
      artifactId,
      query: parsedQuery.data.q,
    });

    return NextResponse.json({ data: suggestions });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error("GET /api/artifacts/[artifactId]/mention-suggestions error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
