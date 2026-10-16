import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { NotificationService } from "@/services/notification.service";
import { listNotificationsQuerySchema } from "@/lib/validations/notification";

export async function GET(req: Request) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const parsedQuery = listNotificationsQuerySchema.safeParse({
      limit: url.searchParams.get("limit") ?? "20",
      cursor: url.searchParams.get("cursor") ?? undefined,
      filter: url.searchParams.get("filter") ?? "all",
    });

    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: parsedQuery.error.issues[0]?.message || "Invalid query parameters." },
        { status: 400 }
      );
    }

    const result = await NotificationService.listNotifications({
      actorUserId: session.user.id,
      limit: parsedQuery.data.limit,
      cursor: parsedQuery.data.cursor,
      filter: parsedQuery.data.filter,
    });

    return NextResponse.json({
      data: result.notifications,
      pagination: {
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        limit: parsedQuery.data.limit,
        unreadCount: result.unreadCount,
      },
    });
  } catch (error) {
    console.error("GET /api/notifications error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
