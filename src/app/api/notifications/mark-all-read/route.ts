import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { NotificationService } from "@/services/notification.service";

export async function POST() {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await NotificationService.markAllAsRead(session.user.id);

    return NextResponse.json({
      data: {
        success: true,
        count: result.count,
      },
    });
  } catch (error) {
    console.error("POST /api/notifications/mark-all-read error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
