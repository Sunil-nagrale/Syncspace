import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { NotificationService } from "@/services/notification.service";

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const unreadCount = await NotificationService.getUnreadCount(session.user.id);

    return NextResponse.json({
      data: {
        unreadCount,
      },
    });
  } catch (error) {
    console.error("GET /api/notifications/unread-count error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
