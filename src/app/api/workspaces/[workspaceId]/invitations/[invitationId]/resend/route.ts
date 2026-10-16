import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { InvitationService } from "@/services/invitation.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ workspaceId: string; invitationId: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { invitationId } = await params;
    const result = await InvitationService.resendInvitation(
      session.user.id,
      invitationId
    );

    return NextResponse.json({ data: result });
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
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
