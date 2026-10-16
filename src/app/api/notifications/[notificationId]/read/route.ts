import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { NotificationService } from "@/services/notification.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";

export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ notificationId: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { notificationId } = await params;
    if (!notificationId || typeof notificationId !== "string" || !notificationId.trim()) {
      return NextResponse.json(
        { error: "Notification ID is required." },
        { status: 400 }
      );
    }

    const updated = await NotificationService.markAsRead({
      actorUserId: session.user.id,
      notificationId,
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    console.error("PATCH /api/notifications/[notificationId]/read error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
