import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { InvitationService } from "@/services/invitation.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required to accept an invitation." },
        { status: 401 }
      );
    }

    const { token } = await params;
    const result = await InvitationService.acceptInvitation(
      session.user.id,
      token
    );

    return NextResponse.json({ data: result }, { status: 200 });
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
